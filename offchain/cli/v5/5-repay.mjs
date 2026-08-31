/**
 * Step 5 — RepayAnonymous: re-attest membership + the loan nullifier, pay
 * principal + interest, and remove the loan from open_loans (settling it, which
 * is what later permits unlock). On-chain groth_verify over [group_root,
 * nullifier, principal, ratio, ext]; repay_amount enforced by pool accounting.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, generateBorrowProof, R_Repay,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const { commitments } = loadReceipt("commitments.json");
const borrow = loadReceipt("borrow.json");

const loan = pool.open_loans.find((l) => l.nullifier === borrow.nullifier);
if (!loan) throw new Error("loan nullifier not in open_loans");
const principal = Number(loan.principal);
const interest = Math.floor((principal * pool.interest_rate) / 10000);
const repay = principal + interest;
console.log("principal:", principal / 1e6, "ADA | interest:", interest / 1e6, "| due:", repay / 1e6);

const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

const { proofData, nullifier } = await generateBorrowProof({
  commitments, index: deposit.index, secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount, loanAmount: principal, ratio: pool.collateral_ratio,
});

const now = Date.now();
const openLoans = pool.open_loans.filter((l) => l.nullifier !== borrow.nullifier);
const newBorrowed = pool.total_borrowed - principal;
const contDatum = poolDatum({
  total_deposited: pool.total_deposited, total_borrowed: newBorrowed,
  interest_rate: pool.interest_rate, collateral_ratio: pool.collateral_ratio,
  vkey_ref_tx: pool.vkey_ref_tx, vkey_ref_idx: pool.vkey_ref_idx,
  unlock_vkey_ref_tx: pool.unlock_vkey_ref_tx, unlock_vkey_ref_idx: pool.unlock_vkey_ref_idx,
  group_root: BigInt(pool.group_root), external_nullifier: BigInt(pool.external_nullifier),
  open_loans: openLoans, admin: pool.admin, last_updated: now,
});

const collateralUtxo = utxos.find((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000) || utxos[0];

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Repay(proofData, repay, nullifier), "JSON")
  .readOnlyTxInReference(pool.vkey_ref_tx, pool.vkey_ref_idx)
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(poolBalance + repay) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", {
  ...pool, txHash, outputIndex: 0, poolBalance: poolBalance + repay,
  total_borrowed: newBorrowed, open_loans: openLoans, last_updated: now,
});
saveReceipt("repay.json", { txHash, repayAda: repay, interest, nullifier: nullifier.toString() });
console.log("REPAY submitted (principal + interest, nullifier settled). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
