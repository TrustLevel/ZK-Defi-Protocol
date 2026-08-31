/**
 * Step 3b — SetGroupRoot: the admin spends the pool and publishes the updated
 * Merkle root of the commitment set so new deposits become valid membership
 * witnesses for borrowing. Separate, retriable step (fresh UTxO fetch).
 */
import { deserializeAddress } from "@meshsdk/core";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, merkleRoot, R_SetGroupRoot,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const { pubKeyHash } = deserializeAddress(addr);

const pool = loadReceipt("pool.json");
const { commitments } = loadReceipt("commitments.json");

const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

const newRoot = merkleRoot(commitments);
const now = Date.now();
const contDatum = poolDatum({
  total_deposited: pool.total_deposited, total_borrowed: pool.total_borrowed,
  interest_rate: pool.interest_rate, collateral_ratio: pool.collateral_ratio,
  vkey_ref_tx: pool.vkey_ref_tx, vkey_ref_idx: pool.vkey_ref_idx,
  unlock_vkey_ref_tx: pool.unlock_vkey_ref_tx, unlock_vkey_ref_idx: pool.unlock_vkey_ref_idx,
  group_root: newRoot, external_nullifier: BigInt(pool.external_nullifier),
  loan_denomination: BigInt(pool.loan_denomination),
  open_loans: pool.open_loans, admin: pool.admin, last_updated: now,
});

const utxos = await provider.fetchAddressUTxOs(addr);
const pureAda = utxos.filter((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000);
const collateralUtxo = pureAda[0] || utxos[0];
// don't let coin selection reuse the collateral UTxO as a normal input
const spendable = utxos.filter((u) => !(u.input.txHash === collateralUtxo.input.txHash && u.input.outputIndex === collateralUtxo.input.outputIndex));

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_SetGroupRoot(newRoot), "JSON")
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(poolBalance) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  .requiredSignerHash(pubKeyHash)
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(spendable)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", { ...pool, txHash, outputIndex: 0, poolBalance, group_root: newRoot.toString(), last_updated: now });
console.log("Group root published. txHash:", txHash, "#0 | root", newRoot.toString().slice(0, 16) + "...");
console.log(scanLink(txHash));
process.exit(0);
