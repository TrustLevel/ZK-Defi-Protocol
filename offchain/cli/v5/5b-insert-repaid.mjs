/**
 * Step 5b — SetRoots (insert R): the admin spends the pool and publishes the
 * updated append-only repaid-set root (repaid_root = merkleRoot(repaidNullifiers))
 * so the repayment nullifier R recorded at step 5 becomes a valid membership
 * witness for the settlement (unlock) proof. group_root is carried through
 * UNCHANGED. This is the admin-curated maintenance step (mirrors group_root's
 * posture); on-chain incremental Merkle append is deferred to M4. Admin-signed.
 */
import { deserializeAddress } from "@meshsdk/core";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatumFrom, merkleRoot, R_SetRoots,
  POOL_ADDRESS, POOL_CBOR, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const { pubKeyHash } = deserializeAddress(addr);

const pool = loadReceipt("pool.json");
const { repaidNullifiers } = loadReceipt("repaid.json");

const poolUtxos = await provider.fetchAddressUTxOs(POOL_ADDRESS);
const poolUtxo = poolUtxos.find((u) => u.input.txHash === pool.txHash && u.input.outputIndex === pool.outputIndex);
if (!poolUtxo) throw new Error(`pool UTxO ${pool.txHash}#${pool.outputIndex} not found`);
const poolBalance = Number(poolUtxo.output.amount.find((a) => a.unit === "lovelace").quantity);

const groupRoot = BigInt(pool.group_root); // unchanged in this step
const newRepaidRoot = merkleRoot(repaidNullifiers);
const now = Date.now();
const contDatum = poolDatumFrom(pool, { group_root: groupRoot, repaid_root: newRepaidRoot, last_updated: now });

const utxos = await provider.fetchAddressUTxOs(addr);
const pureAda = utxos.filter((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000);
const collateralUtxo = pureAda[0] || utxos[0];
const spendable = utxos.filter((u) => !(u.input.txHash === collateralUtxo.input.txHash && u.input.outputIndex === collateralUtxo.input.outputIndex));

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, POOL_ADDRESS)
  .txInScript(POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_SetRoots(groupRoot, newRepaidRoot), "JSON")
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(poolBalance) }])
  .txOutInlineDatumValue(contDatum, "JSON")
  .requiredSignerHash(pubKeyHash)
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(spendable)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", { ...pool, txHash, outputIndex: 0, poolBalance, repaid_root: newRepaidRoot.toString(), last_updated: now });
console.log("Repaid root published (R inserted). txHash:", txHash, "#0 | repaid_root", newRepaidRoot.toString().slice(0, 16) + "...");
console.log("  repaid-set size:", repaidNullifiers.length);
console.log(scanLink(txHash));
process.exit(0);
