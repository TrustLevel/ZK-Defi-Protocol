// Live check against Preprod: the leaves rebuilt from the M4 pool's history must
// match the roots in its current datum. Needs a Blockfrost key, so it runs only
// when PREPROD_BLOCKFROST_API_KEY is set (e.g. `npm run test:live`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BlockfrostProvider } from "@meshsdk/core";
import { deriveScripts } from "../src/scripts.mjs";
import { fetchPool, fetchLeaves, checkLeaves } from "../src/chain.mjs";

const key = process.env.PREPROD_BLOCKFROST_API_KEY;
const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

test("leaves rebuilt from the M4 pool history match its datum", { skip: !key && "PREPROD_BLOCKFROST_API_KEY not set" }, async () => {
  const m4 = json("../deployments/preprod-m4.json");
  const S = deriveScripts(json("../../../contracts/plutus.json"), m4.seed, m4.vkeys);
  const bf = async (path) => {
    const r = await fetch("https://cardano-preprod.blockfrost.io/api/v0" + path, { headers: { project_id: key } });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  };
  const pool = await fetchPool(new BlockfrostProvider(key), S);
  const leaves = await fetchLeaves(bf, S);
  assert.ok(leaves.commitments.length >= 1);
  checkLeaves(pool.datum, leaves);
});
