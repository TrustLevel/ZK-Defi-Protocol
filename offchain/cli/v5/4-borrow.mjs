/**
 * Step 4 — BorrowAnonymous via a Merkle MEMBERSHIP proof verified ON-CHAIN.
 * No collateral UTxO is referenced (deposit<->borrow unlinkable). The loan
 * nullifier is recorded in the pool's open_loans. The pool validator calls
 * groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext]) on-chain.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, generateBorrowProof, R_Borrow,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const LOAN_ADA = 10_000_000;

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const { commitments } = loadReceipt("commitments.json");

const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found (confirmed?)`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);
console.log("pool balance:", poolBalance / 1e6, "ADA | open_loans:", pool.open_loans.length);

const { proofData, nullifier, root } = await generateBorrowProof({
  commitments, index: deposit.index, secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount, loanAmount: LOAN_ADA, ratio: pool.collateral_ratio,
});
if (root.toString() !== String(pool.group_root)) throw new Error("membership root != published pool group_root");
console.log("membership proof ok | nullifier", nullifier.toString().slice(0, 16) + "...");

const now = Date.now();
const newLoan = { nullifier: nullifier.toString(), principal: LOAN_ADA, start: now };
const openLoans = [newLoan, ...pool.open_loans];
const newBorrowed = pool.total_borrowed + LOAN_ADA;
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
  .txInRedeemerValue(R_Borrow(proofData, LOAN_ADA, nullifier), "JSON")
  .readOnlyTxInReference(pool.vkey_ref_tx, pool.vkey_ref_idx)
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(poolBalance - LOAN_ADA) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  .txOut(addr, [{ unit: "lovelace", quantity: String(LOAN_ADA) }])
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", {
  ...pool, txHash, outputIndex: 0, poolBalance: poolBalance - LOAN_ADA,
  total_borrowed: newBorrowed, open_loans: openLoans, last_updated: now,
});
saveReceipt("borrow.json", { txHash, loanAda: LOAN_ADA, nullifier: nullifier.toString() });
console.log("BORROW submitted (membership, on-chain groth_verify). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
