/**
 * Step 4 — BorrowAnonymous, authorized by a real Groth16 proof verified ON-CHAIN.
 *
 * - Generates a BLS12-381 Groth16 proof for public signals
 *     [commitment, loan_amount, collateral_ratio=125]
 *   where commitment is read from the deposited collateral UTxO's datum.
 * - Spends the pool UTxO with redeemer BorrowAnonymous{collateral_ref, proof, loan_amount}.
 * - References the collateral UTxO (read-only) and the VKey UTxO (read-only).
 * - Continues the pool at index 0: value -= loan_amount, datum.total_borrowed += loan_amount.
 * - Pays the loan out to the admin wallet.
 *
 * The pool validator calls groth_verify(vkey, proof, [commitment, loan_amount, ratio])
 * on-chain — this is the Milestone 3 proof of real on-chain ZK verification.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, outputReference, generateProof,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const LOAN_ADA = 10_000_000; // 10 ADA loan (20 ADA collat @125% => 2e9 >= 1.25e9 ✓)

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
// Fetch fresh on-chain wallet UTxOs (avoids stale getUtxos() snapshots after
// back-to-back setup txs).
const utxos = await provider.fetchAddressUTxOs(addr);

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const vkey = loadReceipt("vkey.json");

// A pure-ADA wallet UTxO to use as Cardano script collateral (must be >= ~5 ADA).
const collateralUtxo = utxos.find(
  (u) => u.output.amount.length === 1 && u.output.amount[0].unit === "lovelace" &&
         Number(u.output.amount[0].quantity) >= 5_000_000,
) || utxos[0];

// Resolve the pool UTxO on-chain (its value/datum is the trusted input).
const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find(
  (u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex,
);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found on-chain (confirmed yet?)`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);
console.log("pool balance:", poolBalance / 1e6, "ADA | total_borrowed:", pool.totalBorrowed);

// Proof for [commitment, loan_amount, ratio]. commitment/secret/amount from deposit receipt.
const commitment = BigInt(deposit.commitment);
console.log("generating proof for loan", LOAN_ADA, "commitment", commitment.toString().slice(0, 16) + "...");
const { proofData, publicSignals, proofGenMs } = await generateProof(
  commitment, LOAN_ADA, pool.collateralRatio, BigInt(deposit.secret), deposit.collateralAmount,
);
console.log("proof generated in", proofGenMs, "ms | publicSignals:", publicSignals);

// Redeemer: BorrowAnonymous = conStr 1 [OutputReference(collateral_ref), Proof, loan_amount]
const { conStr, integer } = await import("@meshsdk/core");
const borrowRedeemer = conStr(1, [
  outputReference(deposit.txHash, deposit.outputIndex),
  proofData,
  integer(LOAN_ADA),
]);

// Continuing pool datum: total_borrowed += loan_amount, value -= loan_amount.
const newTotalBorrowed = pool.totalBorrowed + LOAN_ADA;
const newPoolBalance = poolBalance - LOAN_ADA;
const contDatum = poolDatum({
  total_deposited: pool.poolAda,
  total_borrowed: newTotalBorrowed,
  interest_rate: pool.interestRate,
  collateral_ratio: pool.collateralRatio,
  vkey_ref_tx: pool.vkeyRefTx,
  vkey_ref_idx: pool.vkeyRefIdx,
  last_updated: Date.now(),
});

const tx = makeTxBuilder(provider, { autoEvaluate: false });
const unsigned = await tx
  .setNetwork("preprod")
  // spend the pool UTxO with the borrow redeemer
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  // groth_verify over BLS12-381 is heavy but bounded: the isolated aiken test
  // measures mem ~43k / cpu ~2.27B for the verification itself. Budget with ample
  // headroom for the full spend (datum/redeemer decode + input/output scans) while
  // staying well under Plutus V3 limits (17.5M mem / 10B cpu) — this tightened
  // budget lowers the ExUnit-priced fee vs. the earlier near-max setting.
  .txInRedeemerValue(borrowRedeemer, "JSON", { mem: 900000, steps: 4000000000 })
  // read-only references: collateral (for commitment) + vkey (for verification key)
  .readOnlyTxInReference(deposit.txHash, deposit.outputIndex)
  .readOnlyTxInReference(vkey.txHash, vkey.outputIndex)
  // continuing pool output at index 0 (validator finds first output at pool address)
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(newPoolBalance) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  // loan paid out to admin
  .txOut(addr, [{ unit: "lovelace", quantity: String(LOAN_ADA) }])
  // Cardano script collateral (covers ExUnits if the script fails phase-2)
  .txInCollateral(
    collateralUtxo.input.txHash, collateralUtxo.input.outputIndex,
    collateralUtxo.output.amount, addr,
  )
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = {
  txHash, poolOutputIndex: 0, address: POOL_ADDRESS,
  loanAda: LOAN_ADA, newPoolBalance, newTotalBorrowed,
  vkeyRefTx: pool.vkeyRefTx, vkeyRefIdx: pool.vkeyRefIdx,
  collateralRatio: pool.collateralRatio, interestRate: pool.interestRate,
  poolAda: pool.poolAda, lastUpdated: contDatum.fields[5].int,
  publicSignals, proofGenMs,
};
const file = saveReceipt("borrow.json", receipt);
console.log("BORROW submitted. txHash:", txHash);
console.log("on-chain groth_verify authorized this loan.");
console.log("receipt:", file);
console.log(scanLink(txHash));
process.exit(0);
