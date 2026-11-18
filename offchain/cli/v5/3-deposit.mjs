/**
 * Step 3 — DepositCollateral through the pool (permissionless, no admin).
 *
 * Locks exactly COLLATERAL_DENOMINATION at the collateral script with
 * DepositDatumV5 { commitment, timestamp, unlock_to } and, in the same tx,
 * spends the pool with DepositCollateral: an append proof (verified on-chain)
 * inserts the commitment into group_root at group_next_index. The pool value
 * is unchanged. The secret + amount stay off-chain (private witnesses).
 *
 * unlock_to: where the collateral is paid on unlock — UNLOCK_TO_ADDRESS from
 * .env if set (a fresh key address is better for privacy), else this wallet.
 */
import crypto from "crypto";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  loadScripts, fetchPool, poolAmount, pickCollateral,
  poolDatumFrom, depositDatum, computeCommitment, generateCommitmentAppendProof,
  R_DepositCollateral, COLLATERAL_DENOMINATION, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await provider.fetchAddressUTxOs(addr);
const S = loadScripts();
const dep = loadReceipt("deployment.json");

const pool = loadReceipt("pool.json");
const { commitments } = loadReceipt("commitments.json");
const { utxo: poolUtxo, lovelace: poolBalance } = await fetchPool(provider, S);
if (commitments.length !== pool.group_next_index) throw new Error("commitments.json out of sync with group_next_index");

const secret = BigInt("0x" + crypto.randomBytes(16).toString("hex"));
const commitment = computeCommitment(COLLATERAL_DENOMINATION, secret);
const { proofData, oldRoot, newRoot, index } = await generateCommitmentAppendProof({
  commitment, commitmentsBefore: commitments,
});
if (oldRoot.toString() !== String(pool.group_root)) throw new Error("local commitment tree != pool group_root");

const unlockTo = env.UNLOCK_TO_ADDRESS || addr;
const now = Date.now();
const contDatum = poolDatumFrom(pool, {
  group_root: newRoot, group_next_index: index + 1, last_updated: now,
});
const collateralUtxo = pickCollateral(utxos);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .spendingPlutusScriptV3()
  .txIn(poolUtxo.input.txHash, poolUtxo.input.outputIndex, poolUtxo.output.amount, S.POOL_ADDRESS)
  .txInScript(S.POOL_CBOR)
  .txInInlineDatumPresent()
  .txInRedeemerValue(R_DepositCollateral(commitment, proofData), "JSON")
  .readOnlyTxInReference(dep.vkeys.txHash, dep.vkeys.appendIdx)
  .txOut(S.POOL_ADDRESS, poolAmount(S, poolBalance))
  .txOutInlineDatumValue(contDatum, "JSON")
  .txOut(S.COLLATERAL_ADDRESS, [{ unit: "lovelace", quantity: String(COLLATERAL_DENOMINATION) }])
  .txOutInlineDatumValue(depositDatum(commitment, now, unlockTo), "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("pool.json", {
  ...pool, txHash, outputIndex: 0, poolBalance,
  group_root: newRoot.toString(), group_next_index: index + 1, last_updated: now,
});
saveReceipt("deposit.json", {
  txHash, outputIndex: 1, address: S.COLLATERAL_ADDRESS,
  collateralAmount: Number(COLLATERAL_DENOMINATION), secret: secret.toString(),
  commitment: commitment.toString(), index, timestamp: now, unlockTo,
});
saveReceipt("commitments.json", { commitments: [...commitments, commitment.toString()] });
console.log("DEPOSIT submitted (append proof, on-chain verify). txHash:", txHash, "| index", index);
console.log(scanLink(txHash));
process.exit(0);
