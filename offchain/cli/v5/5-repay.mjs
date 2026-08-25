/**
 * Step 5 — RepayAnonymous, authorized by a real Groth16 proof verified ON-CHAIN.
 *
 * - Generates a Groth16 proof for [commitment, repay_amount, collateral_ratio].
 * - Spends the (post-borrow) pool UTxO with RepayAnonymous{deposit_ref, proof, repay_amount}.
 * - References the deposit UTxO (commitment) + VKey UTxO.
 * - Continues the pool at index 0: value += repay_amount, total_borrowed -= repay_amount.
 *
 * The pool validator calls groth_verify(vkey, proof, [commitment, repay_amount, ratio]) on-chain.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, outputReference, generateProof,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const REPAY_ADA = 10_000_000; // repay the 10 ADA principal (interest omitted for the cycle demo)

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const borrow = loadReceipt("borrow.json");
const deposit = loadReceipt("deposit.json");
const vkey = loadReceipt("vkey.json");

// Pure-ADA wallet UTxO for Cardano script collateral.
const collateralUtxo = utxos.find(
  (u) => u.output.amount.length === 1 && u.output.amount[0].unit === "lovelace" &&
         Number(u.output.amount[0].quantity) >= 5_000_000,
) || utxos[0];

// The pool UTxO to spend is the continued pool from the borrow tx (#0).
const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find(
  (u) => u.input.txHash === borrow.txHash && u.input.outputIndex === borrow.poolOutputIndex,
);
if (!poolUtxo) throw new Error(`post-borrow pool UTxO ${borrow.txHash}#${borrow.poolOutputIndex} not found (confirmed yet?)`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);
console.log("pool balance:", poolBalance / 1e6, "ADA | total_borrowed:", borrow.newTotalBorrowed);

const commitment = BigInt(deposit.commitment);
console.log("generating repay proof for", REPAY_ADA);
const { proofData, publicSignals, proofGenMs } = await generateProof(
  commitment, REPAY_ADA, borrow.collateralRatio, BigInt(deposit.secret), deposit.collateralAmount,
);
console.log("proof generated in", proofGenMs, "ms | publicSignals:", publicSignals);

const { conStr, integer } = await import("@meshsdk/core");
// RepayAnonymous = conStr 2 [OutputReference(deposit_ref), Proof, repay_amount]
const repayRedeemer = conStr(2, [
  outputReference(deposit.txHash, deposit.outputIndex),
  proofData,
  integer(REPAY_ADA),
]);

const newTotalBorrowed = Math.max(0, borrow.newTotalBorrowed - REPAY_ADA);
const newPoolBalance = poolBalance + REPAY_ADA;
const contDatum = poolDatum({
  total_deposited: borrow.poolAda,
  total_borrowed: newTotalBorrowed,
  interest_rate: borrow.interestRate,
  collateral_ratio: borrow.collateralRatio,
  vkey_ref_tx: borrow.vkeyRefTx,
  vkey_ref_idx: borrow.vkeyRefIdx,
  last_updated: Date.now(),
});

const tx = makeTxBuilder(provider, { autoEvaluate: false });
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  // groth_verify budget: isolated cost ~43k mem / ~2.27B cpu; headroom for the
  // full spend, still far under Plutus V3 limits (17.5M / 10B). Tightened from the
  // earlier near-max setting to reduce the ExUnit-priced fee.
  .txInRedeemerValue(repayRedeemer, "JSON", { mem: 900000, steps: 4000000000 })
  .readOnlyTxInReference(deposit.txHash, deposit.outputIndex)
  .readOnlyTxInReference(vkey.txHash, vkey.outputIndex)
  // continuing pool output at index 0: value increased by repay_amount
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(newPoolBalance) }])
  .txOutInlineDatumValue(contDatum, "JSON")
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
  repayAda: REPAY_ADA, newPoolBalance, newTotalBorrowed, publicSignals, proofGenMs,
};
const file = saveReceipt("repay.json", receipt);
console.log("REPAY submitted. txHash:", txHash);
console.log("on-chain groth_verify authorized this repayment.");
console.log("receipt:", file);
console.log(scanLink(txHash));
process.exit(0);
