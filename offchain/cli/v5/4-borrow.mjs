/**
 * Step 4 — BorrowAnonymous via a Merkle MEMBERSHIP proof verified ON-CHAIN.
 * No collateral UTxO is referenced (deposit<->borrow unlinkable). The loan
 * nullifier is recorded in open_loans AND, for good, in used_nullifiers (one
 * loan per deposit). The proof is bound to the payout key: the validator runs
 * groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext, recipient])
 * and requires the loan to be paid to that key, tagged with the nullifier — a
 * proof copied from the mempool cannot redirect the loan.
 *
 * Payout: RECIPIENT_ADDRESS from .env if set (a fresh key address is better
 * for privacy), else this wallet.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  loadScripts, fetchPool, poolAmount, pickCollateral, paymentKeyHash,
  poolDatumFrom, generateBorrowProof, R_Borrow, LOAN_DENOMINATION,
  integer, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const LOAN_ADA = Number(LOAN_DENOMINATION); // loans are fixed-denomination

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);
const S = loadScripts();
const dep = loadReceipt("deployment.json");

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const { commitments } = loadReceipt("commitments.json");
const { utxo: poolUtxo, lovelace: poolBalance } = await fetchPool(provider, S);
console.log("pool balance:", poolBalance / 1e6, "ADA | open_loans:", pool.open_loans.length);

const recipientAddr = env.RECIPIENT_ADDRESS || addr;
const recipientPkh = paymentKeyHash(recipientAddr);
const { proofData, nullifier, root } = await generateBorrowProof({
  commitments, index: deposit.index, secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount, loanAmount: LOAN_ADA, ratio: pool.collateral_ratio,
  recipientPkh,
});
if (root.toString() !== String(pool.group_root)) throw new Error("membership root != pool group_root");
if ((pool.used_nullifiers || []).includes(nullifier.toString())) throw new Error("this deposit already backed a loan (nullifier used)");
console.log("membership proof ok | nullifier", nullifier.toString().slice(0, 16) + "... | recipient", recipientPkh.slice(0, 16) + "...");

const now = Date.now();
const openLoans = [nullifier.toString(), ...pool.open_loans];
const usedNullifiers = [nullifier.toString(), ...(pool.used_nullifiers || [])];
const newBorrowed = pool.total_borrowed + LOAN_ADA;
const contDatum = poolDatumFrom(pool, {
  total_borrowed: newBorrowed, open_loans: openLoans, used_nullifiers: usedNullifiers, last_updated: now,
});
const collateralUtxo = pickCollateral(utxos);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, S.POOL_ADDRESS)
  .txInScript(S.POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Borrow(proofData, LOAN_ADA, nullifier, recipientPkh), "JSON")
  .readOnlyTxInReference(dep.vkeys.txHash, dep.vkeys.borrowIdx)
  .txOut(S.POOL_ADDRESS, poolAmount(S, poolBalance - LOAN_ADA))
  .txOutInlineDatumValue(contDatum, "JSON")
  .txOut(recipientAddr, [{ unit: "lovelace", quantity: String(LOAN_ADA) }])
  .txOutInlineDatumValue(integer(nullifier.toString()), "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", {
  ...pool, txHash, outputIndex: 0, poolBalance: poolBalance - LOAN_ADA,
  total_borrowed: newBorrowed, open_loans: openLoans, used_nullifiers: usedNullifiers, last_updated: now,
});
saveReceipt("borrow.json", { txHash, loanAda: LOAN_ADA, nullifier: nullifier.toString(), recipientPkh, recipientAddr });
console.log("BORROW submitted (membership, on-chain groth_verify, recipient-bound). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
