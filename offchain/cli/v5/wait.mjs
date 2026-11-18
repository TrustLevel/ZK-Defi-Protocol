/**
 * Poll Blockfrost until a tx is confirmed (appears on-chain) AND its outputs are
 * indexed — address UTxO queries lag behind tx confirmation, and the next step
 * must see the new pool UTxO, not the spent one. Blockfrost's tx evaluator lags
 * the address index by a further few seconds, so it then settles SETTLE_MS before
 * returning (otherwise the next script tx can fail evaluation with
 * `extraRedeemers`).
 */
import { loadEnv, makeProvider } from "./common.mjs";

const txHash = process.argv[2];
if (!txHash) throw new Error("usage: node wait.mjs <txHash>");

const env = loadEnv();
const provider = makeProvider(env);

const maxTries = 60; // ~5 min at 5s
const SETTLE_MS = 30_000;
for (let i = 0; i < maxTries; i++) {
  try {
    const info = await provider.fetchTxInfo(txHash);
    if (info && info.block) {
      const outs = await provider.fetchUTxOs(txHash);
      if (outs && outs.length) {
        console.log(`confirmed in block ${info.block} (try ${i + 1}). fee: ${info.fees ?? "?"} — settling ${SETTLE_MS / 1000}s`);
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        process.exit(0);
      }
    }
  } catch (_e) { /* not yet indexed */ }
  await new Promise((r) => setTimeout(r, 5000));
}
console.error("timed out waiting for", txHash);
process.exit(1);
