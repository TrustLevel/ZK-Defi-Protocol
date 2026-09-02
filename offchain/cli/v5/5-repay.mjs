/**
 * Step 5 — RepayAnonymous: re-attest membership + the loan nullifier, pay
 * principal + interest, remove the loan from open_loans, AND self-insert the
 * repayment nullifier R into repaid_root via a zero-knowledge append proof — all
 * PERMISSIONLESS (no admin signature). The append proof binds old_root = current
 * repaid_root, new_root = out.repaid_root, leaf = R, index = next_index, so the
 * borrower grows the settlement set themselves and can later unlock with no admin
 * step. On-chain: groth_verify for both the membership proof and the append proof.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatumFrom, generateBorrowProof, generateAppendProof, R_Repay, LOAN_DENOMINATION,
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
const repaid = loadReceipt("repaid.json");

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
// Self-append R into repaid_root at next_index (permissionless, ZK-attested).
const repaidBefore = repaid.repaidNullifiers;
if (repaidBefore.length !== pool.next_index) throw new Error(`repaid.json size ${repaidBefore.length} != pool.next_index ${pool.next_index}`);
const { proofData: appendProofData, R, newRoot } = await generateAppendProof({
  secret: BigInt(deposit.secret), repaidBefore, index: pool.next_index,
});
console.log("append proof ok | repaid_root", BigInt(pool.repaid_root).toString().slice(0, 12) + "... ->", newRoot.toString().slice(0, 12) + "... | index", pool.next_index);

const now = Date.now();
const openLoans = pool.open_loans.filter((n) => n !== borrow.nullifier);
const newBorrowed = pool.total_borrowed - principal;
const newNextIndex = pool.next_index + 1;
const contDatum = poolDatumFrom(pool, {
  total_borrowed: newBorrowed, open_loans: openLoans,
  repaid_root: newRoot, next_index: newNextIndex, last_updated: now,
});

const collateralUtxo = utxos.find((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000) || utxos[0];

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Repay(proofData, repay, nullifier, R, appendProofData), "JSON")
  .readOnlyTxInReference(pool.vkey_ref_tx, pool.vkey_ref_idx)
  .readOnlyTxInReference(pool.append_vkey_ref_tx, pool.append_vkey_ref_idx)
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(poolBalance + repay) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", {
  ...pool, txHash, outputIndex: 0, poolBalance: poolBalance + repay,
  total_borrowed: newBorrowed, open_loans: openLoans,
  repaid_root: newRoot.toString(), next_index: newNextIndex, last_updated: now,
});
// R is now in repaid_root on-chain; record it (and its index) for the unlock proof.
const repaidIndex = pool.next_index;
repaid.repaidNullifiers.push(R.toString());
saveReceipt("repaid.json", repaid);
saveReceipt("repay.json", {
  txHash, repayAda: repay, interest,
  nullifier: nullifier.toString(), repay_nullifier: R.toString(),
  repaid_index: repaidIndex,
});
console.log("REPAY submitted (principal + interest; loan settled; R self-appended to repaid_root, no admin). txHash:", txHash);
console.log("  R (repay nullifier):", R.toString().slice(0, 16) + "... | repaid-set size", repaid.repaidNullifiers.length);
console.log(scanLink(txHash));
process.exit(0);
