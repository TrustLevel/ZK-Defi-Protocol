/**
 * Step 5 — RepayAnonymous: re-attest membership + the loan nullifier, pay
 * principal + interest, and remove the loan from open_loans. Permissionless (no
 * admin signature). Also computes the repayment nullifier R and carries it in the
 * redeemer (repay_nullifier) + appends it to receipts/repaid.json, so the admin
 * can insert R into repaid_root via 5b-insert-repaid — which is what later lets
 * the owner prove settlement (in ZK) at unlock. repaid_root is UNCHANGED here.
 * On-chain groth_verify over [group_root, nullifier, principal, ratio, ext];
 * repay_amount enforced by pool accounting.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatumFrom, generateBorrowProof, computeRepayNullifier, R_Repay, LOAN_DENOMINATION,
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

if (!pool.open_loans.includes(borrow.nullifier)) throw new Error("loan nullifier not in open_loans");
const principal = Number(LOAN_DENOMINATION);
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
// Repayment nullifier R (private witness at unlock; carried publicly here).
const R = computeRepayNullifier(BigInt(deposit.secret));

const now = Date.now();
const openLoans = pool.open_loans.filter((n) => n !== borrow.nullifier);
const newBorrowed = pool.total_borrowed - principal;
const contDatum = poolDatumFrom(pool, { total_borrowed: newBorrowed, open_loans: openLoans, last_updated: now });

const collateralUtxo = utxos.find((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000) || utxos[0];

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Repay(proofData, repay, nullifier, R), "JSON")
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
// Append R to the append-only repaid-set so the admin can insert it (5b) and the
// owner can later prove settlement membership at unlock.
const repaid = loadReceipt("repaid.json");
if (!repaid.repaidNullifiers.includes(R.toString())) repaid.repaidNullifiers.push(R.toString());
saveReceipt("repaid.json", repaid);
saveReceipt("repay.json", {
  txHash, repayAda: repay, interest,
  nullifier: nullifier.toString(), repay_nullifier: R.toString(),
  repaid_index: repaid.repaidNullifiers.indexOf(R.toString()),
});
console.log("REPAY submitted (principal + interest; loan nullifier removed; R recorded). txHash:", txHash);
console.log("  R (repay nullifier):", R.toString().slice(0, 16) + "... | repaid-set size", repaid.repaidNullifiers.length);
console.log(scanLink(txHash));
process.exit(0);
