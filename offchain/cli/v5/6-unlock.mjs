/**
 * Step 6 — UnlockDeposit, authorized by a real Groth16 proof verified ON-CHAIN.
 *
 * Completes the M3 "collateral verification" component: after the anonymous
 * loan has been repaid, the depositor unlocks their collateral UTxO from the
 * collateral_v5 validator by proving knowledge of the secret behind the
 * commitment — with NO admin/owner signature, only a zk-SNARK.
 *
 * - Generates a BLS12-381 Groth16 proof for public signals
 *     [commitment, collateral_amount, unlock_ratio=100]
 *   where, with loan_amount == collateral_amount and ratio == 100, the circuit's
 *   sufficiency constraint (collateral*100 >= loan*ratio) holds with equality,
 *   so the proof attests ONLY knowledge of the secret behind the commitment.
 * - Spends the deposit UTxO at collateral_v5 with redeemer
 *     UnlockDeposit{proof, vkey_ref} = conStr(2, [Proof, OutputReference]).
 * - References the VKey UTxO (read-only) — the verification key the on-chain
 *   groth_verify reads via get_vkey(tx, vkey_ref).
 * - Pays the freed collateral back to the admin wallet.
 *
 * The collateral validator calls
 *   groth_verify(vkey, proof, [commitment, collateral_amount, 100])
 * on-chain — no extra_signatories. This is real on-chain ZK collateral unlock.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  outputReference, generateProof,
  COLLATERAL_ADDRESS, COLLATERAL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const UNLOCK_RATIO = 100; // must equal collateral_v5.ak `unlock_ratio`

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const deposit = loadReceipt("deposit.json");
const vkey = loadReceipt("vkey.json");

// Pure-ADA wallet UTxO for Cardano script collateral.
const collateralUtxo = utxos.find(
  (u) => u.output.amount.length === 1 && u.output.amount[0].unit === "lovelace" &&
         Number(u.output.amount[0].quantity) >= 5_000_000,
) || utxos[0];

// Resolve the deposit UTxO on-chain (the input we are unlocking).
const depUtxos = await provider.fetchAddressUTxOs(COLLATERAL_ADDRESS);
const depUtxo = depUtxos.find(
  (u) => u.input.txHash === deposit.txHash && u.input.outputIndex === deposit.outputIndex,
);
if (!depUtxo) throw new Error(`deposit UTxO ${deposit.txHash}#${deposit.outputIndex} not found on-chain (already unlocked?)`);
const depBalance = Number(depUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);
console.log("deposit balance:", depBalance / 1e6, "ADA at", COLLATERAL_ADDRESS);

// Ownership proof: public signals [commitment, collateral_amount, 100].
// generateProof(commitment, amount, ratio, secret, collateralAmount)
// -> circuit input loan_amount=collateral_amount, collateral_ratio=100.
const commitment = BigInt(deposit.commitment);
console.log("generating unlock (ownership) proof for commitment", commitment.toString().slice(0, 16) + "...");
const { proofData, publicSignals, proofGenMs } = await generateProof(
  commitment,
  deposit.collateralAmount,   // loan_amount public signal == collateral_amount
  UNLOCK_RATIO,               // collateral_ratio public signal == 100
  BigInt(deposit.secret),
  deposit.collateralAmount,
);
console.log("proof generated in", proofGenMs, "ms | publicSignals:", publicSignals);

const { conStr } = await import("@meshsdk/core");
// UnlockDeposit = conStr 2 [Proof, OutputReference(vkey_ref)]
const unlockRedeemer = conStr(2, [
  proofData,
  outputReference(vkey.txHash, vkey.outputIndex),
]);

const tx = makeTxBuilder(provider, { autoEvaluate: false });
const unsigned = await tx
  .setNetwork("preprod")
  // spend the deposit UTxO with the UnlockDeposit redeemer
  .spendingPlutusScriptV3()
  .txIn(depUtxo.input.txHash, depUtxo.input.outputIndex, depUtxo.output.amount, COLLATERAL_ADDRESS)
  .txInScript(COLLATERAL_CBOR)
  .txInInlineDatumPresent()
  // groth_verify over BLS12-381 is heavy — set explicit ExUnits near the preprod max.
  .txInRedeemerValue(unlockRedeemer, "JSON", { mem: 14000000, steps: 10000000000 })
  // read-only reference: the VKey UTxO (verification key)
  .readOnlyTxInReference(vkey.txHash, vkey.outputIndex)
  // freed collateral paid back to admin (UnlockDeposit has no continuity constraint)
  .txOut(addr, [{ unit: "lovelace", quantity: String(depBalance) }])
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
  txHash, spentDeposit: `${deposit.txHash}#${deposit.outputIndex}`,
  address: COLLATERAL_ADDRESS, unlockedAda: depBalance,
  vkeyRefTx: vkey.txHash, vkeyRefIdx: vkey.outputIndex,
  unlockRatio: UNLOCK_RATIO, publicSignals, proofGenMs,
};
const file = saveReceipt("unlock.json", receipt);
console.log("UNLOCK submitted. txHash:", txHash);
console.log("on-chain groth_verify authorized this collateral unlock (no signature).");
console.log("receipt:", file);
console.log(scanLink(txHash));
process.exit(0);
