/** Poll Blockfrost until a tx is confirmed (appears on-chain). */
import { loadEnv, makeProvider } from "./common.mjs";

const txHash = process.argv[2];
if (!txHash) throw new Error("usage: node wait.mjs <txHash>");

const env = loadEnv();
const provider = makeProvider(env);

const maxTries = 60; // ~5 min at 5s
for (let i = 0; i < maxTries; i++) {
  try {
    const info = await provider.fetchTxInfo(txHash);
    if (info && info.block) {
      console.log(`confirmed in block ${info.block} (try ${i + 1}). fee: ${info.fees ?? "?"}`);
      process.exit(0);
    }
  } catch (_e) { /* not yet indexed */ }
  await new Promise((r) => setTimeout(r, 5000));
}
console.error("timed out waiting for", txHash);
process.exit(1);
