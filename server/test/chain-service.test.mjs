// Live check against Preprod (needs PREPROD_BLOCKFROST_API_KEY): the snapshot's
// leaves rebuild the pool's roots, and the activity feed has the cycle's steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BlockfrostProvider } from "@meshsdk/core";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { merkleRoot } from "@zk-defi/protocol/crypto";
import { createChainService } from "../src/chain-service.mjs";

const key = process.env.PREPROD_BLOCKFROST_API_KEY;
const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

test("snapshot of the M4 pool: consistent leaves and a typed activity feed", { skip: !key && "PREPROD_BLOCKFROST_API_KEY not set" }, async () => {
  const m4 = json("../../packages/protocol/deployments/preprod-m4.json");
  const S = deriveScripts(json("../../contracts/plutus.json"), m4.seed, m4.vkeys);
  const bf = async (p) => {
    const r = await fetch("https://cardano-preprod.blockfrost.io/api/v0" + p, { headers: { project_id: key } });
    if (!r.ok) throw new Error(`${r.status} ${p}`);
    return r.json();
  };
  const chain = createChainService({ provider: new BlockfrostProvider(key), bf, S });
  const s = await chain.state();
  assert.equal(merkleRoot(s.leaves.commitments), s.pool.datum.group_root);
  assert.equal(merkleRoot(s.leaves.repaid), s.pool.datum.repaid_root);
  const types = new Set(s.activity.map((a) => a.type));
  for (const t of ["deposit", "borrow", "repay", "unlock"]) assert.ok(types.has(t), `feed has a ${t}`);
  // a cached second read returns the same snapshot
  assert.equal(await chain.state(), s);
});
