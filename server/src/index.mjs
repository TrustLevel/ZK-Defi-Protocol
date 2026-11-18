/**
 * M4 backend entry point.
 *
 * Environment:
 *   PREPROD_BLOCKFROST_API_KEY  required
 *   RELAYER_SEED_ENV            name of the variable holding the relayer's mnemonic
 *                               (default RELAYER_WALLET_SEED); without it the relay
 *                               routes are off
 *   HOST, PORT                  default 127.0.0.1:3001 (a reverse proxy faces the internet)
 *   REPO_ROOT                   where contracts/, circuits/ and packages/ live (default ../)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { buildApp } from "./app.mjs";
import { createChainService } from "./chain-service.mjs";
import { createRelayer } from "./relayer.mjs";
import { createTxRunner } from "./tx-runner.mjs";

const ROOT = path.resolve(process.env.REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const key = process.env.PREPROD_BLOCKFROST_API_KEY;
if (!key) throw new Error("PREPROD_BLOCKFROST_API_KEY is required");

const deployment = read("packages/protocol/deployments/preprod-m4.json");
const S = deriveScripts(read("contracts/plutus.json"), deployment.seed, deployment.vkeys);
const provider = new BlockfrostProvider(key);
const bf = async (p) => {
  const r = await fetch("https://cardano-preprod.blockfrost.io/api/v0" + p, { headers: { project_id: key } });
  if (!r.ok) throw new Error(`Blockfrost ${r.status} ${p}`);
  return r.json();
};
const chain = createChainService({ provider, bf, S });
// The node refusing a transaction is the client's error (400), with the node's
// reason; Blockfrost errors carry it in their body, not in `message`.
const rejected = (code) => (e) => {
  const reason = e?.message ?? (typeof e === "string" ? e : JSON.stringify(e));
  throw Object.assign(new Error(String(reason).slice(0, 1000)), { statusCode: 400, code });
};
// A transaction's outputs never change, so they are cached once fetched.
const utxoCache = new Map();
let costModels = { at: 0, value: null };
const txService = {
  costModels: async () => {
    if (Date.now() - costModels.at > 10 * 60_000) costModels = { at: Date.now(), value: await provider.fetchCostModels() };
    return costModels.value;
  },
  evaluate: (tx) => provider.evaluateTx(tx).catch(rejected("evaluation_failed")),
  submit: (tx) => provider.submitTx(tx).catch(rejected("rejected")),
  utxos: async (txHash) => {
    if (!utxoCache.has(txHash)) {
      const outs = await provider.fetchUTxOs(txHash);
      if (!outs.length) return outs; // not indexed yet: do not cache
      if (utxoCache.size > 5000) utxoCache.clear();
      utxoCache.set(txHash, outs);
    }
    return utxoCache.get(txHash);
  },
};

let relayer = null;
const seed = process.env[process.env.RELAYER_SEED_ENV || "RELAYER_WALLET_SEED"];
if (seed) {
  const wallet = new MeshWallet({ networkId: 0, fetcher: provider, submitter: provider, key: { type: "mnemonic", words: seed.split(/\s+/) } });
  await wallet.init();
  const runner = await createTxRunner({ provider, S, deployment, wallet });
  relayer = createRelayer({
    chain, runner,
    vkeys: { borrow: read("circuits/keys/verification_key_semaphore.json"), settlement: read("circuits/keys/verification_key_settlement.json") },
  });
  console.log(`relayer on, paying from ${runner.address.slice(0, 24)}…`);
} else {
  console.log("relayer off (no relayer seed configured)");
}

const app = await buildApp({ chain, txService, relayer, deployment, logger: { level: "info" } });
await app.listen({ host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT || 3001) });
