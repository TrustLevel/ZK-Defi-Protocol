/**
 * Step 6 — UnlockDeposit: spend the specific deposit with a commitment-bound ZK
 * proof, gated on the loan nullifier being SETTLED (absent from the pool's
 * open_loans, read via a pool reference input). No signature. This is the
 * privacy-preserving, repayment-gated collateral unlock.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  generateUnlockProof, R_Unlock,
  COLLATERAL_ADDRESS, COLLATERAL_CBOR, POOL_ADDRESS, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);

const pool = loadReceipt("pool.json");
const deposit = loadReceipt("deposit.json");

// Resolve the deposit UTxO being unlocked.
const depUtxos = await provider.fetchAddressUTxOs(COLLATERAL_ADDRESS);
const depUtxo = depUtxos.find((u) => u.input.txHash === deposit.txHash && u.input.outputIndex === deposit.outputIndex);
if (!depUtxo) throw new Error(`deposit UTxO ${deposit.txHash}#${deposit.outputIndex} not found (already unlocked?)`);
const depBalance = Number(depUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

// The pool reference input must be the current pool UTxO (post-repay: nullifier gone).
const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found`);

const { proofData, nullifier } = await generateUnlockProof({
  commitment: BigInt(deposit.commitment), secret: BigInt(deposit.secret),
  collateralAmount: deposit.collateralAmount,
});
const settled = !pool.open_loans.some((l) => l.nullifier === nullifier.toString());
console.log("unlock proof ok | nullifier settled in pool?", settled);

const collateralUtxo = utxos.find((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000) || utxos[0];

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(depUtxo.input.txHash, depUtxo.input.outputIndex, depUtxo.output.amount, COLLATERAL_ADDRESS)
  .txInScript(COLLATERAL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_Unlock(proofData, pool.txHash, pool.outputIndex, nullifier), "JSON")
  // reference inputs: the pool (for open_loans + unlock vkey_ref) and the unlock vkey
  .readOnlyTxInReference(pool.txHash, pool.outputIndex)
  .readOnlyTxInReference(pool.unlock_vkey_ref_tx, pool.unlock_vkey_ref_idx)
  .txOut(addr, [{ unit: "lovelace", quantity: String(depBalance) }])
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("unlock.json", { txHash, spentDeposit: `${deposit.txHash}#${deposit.outputIndex}`, unlockedAda: depBalance, nullifier: nullifier.toString() });
console.log("UNLOCK submitted (commitment-bound proof, repayment-gated, no signature). txHash:", txHash);
console.log(scanLink(txHash));
process.exit(0);
