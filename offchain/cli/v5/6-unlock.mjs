/**
 * Step 6 — UnlockDeposit: spend the specific deposit with a SETTLEMENT proof — a
 * single ZK proof binding to the deposit commitment AND proving Merkle membership
 * of the PRIVATE repayment nullifier R in the pool's repaid_root (read via a pool
 * reference input). No signature. The redeemer carries NO borrow-shared value, so
 * borrow<->unlock is unlinkable (Leak-2 closed). A valid proof exists only after
 * the loan was repaid and R was inserted into repaid_root (step 5).
 *
 * The pool reference input is the UTxO carrying the pool NFT (the validator
 * trusts nothing else), and the collateral is paid to the deposit's unlock_to
 * address in an output tagged with the spent deposit's reference — a copied
 * proof cannot redirect the funds.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  loadScripts, fetchPool, pickCollateral, outputReference,
  generateSettlementProof, R_Unlock, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);
const S = loadScripts();
const dep = loadReceipt("deployment.json");

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const { repaidNullifiers } = loadReceipt("repaid.json");
const repay = loadReceipt("repay.json");

// Resolve the deposit UTxO being unlocked.
const depUtxos = await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS);
const depUtxo = depUtxos.find((u) => u.input.txHash === deposit.txHash && u.input.outputIndex === deposit.outputIndex);
if (!depUtxo) throw new Error(`deposit UTxO ${deposit.txHash}#${deposit.outputIndex} not found (already unlocked?)`);
const depBalance = Number(depUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

// The pool reference input: the current pool UTxO, i.e. the one with the NFT.
const { utxo: poolUtxo } = await fetchPool(provider, S);

// Membership witness index of this deposit's R in the append-only repaid-set.
const repaidIndex = repay.repaid_index ?? 0;
const { proofData, root } = await generateSettlementProof({
  commitment: BigInt(deposit.commitment), secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount, repaidNullifiers, index: repaidIndex,
});
if (root.toString() !== String(pool.repaid_root)) {
  throw new Error(`settlement membership root != pool repaid_root (repay first?)`);
}
console.log("settlement proof ok | repaid_root membership verified (no borrow-shared value revealed)");

const collateralUtxo = pickCollateral(utxos);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(depUtxo.input.txHash, depUtxo.input.outputIndex, depUtxo.output.amount, S.COLLATERAL_ADDRESS)
  .txInScript(S.COLLATERAL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Unlock(proofData, poolUtxo.input.txHash, poolUtxo.input.outputIndex), "JSON")
  // reference inputs: the pool (NFT-bearing; repaid_root) and the settlement vkey
  .readOnlyTxInReference(poolUtxo.input.txHash, poolUtxo.input.outputIndex)
  .readOnlyTxInReference(dep.vkeys.txHash, dep.vkeys.settlementIdx)
  // payout: full collateral to unlock_to, tagged with the spent deposit's reference
  .txOut(deposit.unlockTo, [{ unit: "lovelace", quantity: String(depBalance) }])
  .txOutInlineDatumValue(outputReference(deposit.txHash, deposit.outputIndex), "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("unlock.json", { txHash, spentDeposit: `${deposit.txHash}#${deposit.outputIndex}`, unlockedAda: depBalance, unlockTo: deposit.unlockTo });
console.log("UNLOCK submitted (settlement proof, ZK membership, no signature, no borrow-shared value). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
