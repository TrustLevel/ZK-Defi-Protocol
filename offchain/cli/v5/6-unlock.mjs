/**
 * Step 6 — UnlockDeposit: spend the specific deposit with a SETTLEMENT proof — a
 * single ZK proof binding to the deposit commitment AND proving Merkle membership
 * of the PRIVATE repayment nullifier R in the pool's repaid_root (read via a pool
 * reference input). No signature. The redeemer carries NO borrow-shared value, so
 * borrow<->unlock is unlinkable (Leak-2 closed). A valid proof exists only after
 * the loan was repaid and R was inserted into repaid_root (steps 5 + 5b).
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  generateSettlementProof, R_Unlock,
  COLLATERAL_ADDRESS, COLLATERAL_CBOR, POOL_ADDRESS, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");
const { repaidNullifiers } = loadReceipt("repaid.json");
const repay = loadReceipt("repay.json");

// Resolve the deposit UTxO being unlocked.
const depUtxos = await provider.fetchAddressUTxOs(COLLATERAL_ADDRESS);
const depUtxo = depUtxos.find((u) => u.input.txHash === deposit.txHash && u.input.outputIndex === deposit.outputIndex);
if (!depUtxo) throw new Error(`deposit UTxO ${deposit.txHash}#${deposit.outputIndex} not found (already unlocked?)`);
const depBalance = Number(depUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

// The pool reference input must be the current pool UTxO (post-5b: repaid_root ∋ R).
const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found`);

// Membership witness index of this deposit's R in the append-only repaid-set.
const repaidIndex = repay.repaid_index ?? 0;
const { proofData, root } = await generateSettlementProof({
  commitment: BigInt(deposit.commitment), secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount, repaidNullifiers, index: repaidIndex,
});
if (root.toString() !== String(pool.repaid_root)) {
  throw new Error(`settlement membership root != published repaid_root (insert R via 5b first?)`);
}
console.log("settlement proof ok | repaid_root membership verified (no borrow-shared value revealed)");

const collateralUtxo = utxos.find((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000) || utxos[0];

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(depUtxo.input.txHash, depUtxo.input.outputIndex, depUtxo.output.amount, COLLATERAL_ADDRESS)
  .txInScript(COLLATERAL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Unlock(proofData, pool.txHash, pool.outputIndex), "JSON")
  // reference inputs: the pool (for repaid_root + settlement vkey_ref) and the settlement vkey
  .readOnlyTxInReference(pool.txHash, pool.outputIndex)
  .readOnlyTxInReference(pool.settlement_vkey_ref_tx, pool.settlement_vkey_ref_idx)
  .txOut(addr, [{ unit: "lovelace", quantity: String(depBalance) }])
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("unlock.json", { txHash, spentDeposit: `${deposit.txHash}#${deposit.outputIndex}`, unlockedAda: depBalance });
console.log("UNLOCK submitted (settlement proof, ZK membership, no signature, no borrow-shared value). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
