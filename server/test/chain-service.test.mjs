// Live check against Preprod (needs PREPROD_BLOCKFROST_API_KEY): the snapshot's
// leaves rebuild the pool's roots, and the activity feed has the cycle's steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BlockfrostProvider, serializeData } from "@meshsdk/core";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { merkleRoot } from "@zk-defi/protocol/crypto";
import { poolDatum } from "@zk-defi/protocol/plutus";
import { createChainService, IndexLagError } from "../src/chain-service.mjs";

const key = process.env.PREPROD_BLOCKFROST_API_KEY;
const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

test("snapshot of the lender-side M4 pool: consistent leaves and a typed activity feed", { skip: !key && "PREPROD_BLOCKFROST_API_KEY not set" }, async () => {
  const m4 = json("../../packages/protocol/deployments/preprod-m4-lend.json");
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
  assert.equal(merkleRoot(s.leaves.lenders), s.pool.datum.lender_root);
  const types = new Set(s.activity.map((a) => a.type));
  for (const t of ["liquidity", "deposit", "borrow", "repay", "withdraw", "unlock"]) assert.ok(types.has(t), `feed has a ${t}`);
  // a cached second read returns the same snapshot
  assert.equal(await chain.state(), s);
});

// While a transaction spends the pool, Blockfrost can briefly list no pool
// UTxO at all: that is the index catching up (503), not a server error.
test("no pool UTxO for a moment is index lag", async () => {
  const S = { POOL_ADDRESS: "addr_test1pool", POOL_NFT_UNIT: "nft" };
  const chain = createChainService({ provider: { fetchAddressUTxOs: async () => [] }, bf: async () => [], S });
  await assert.rejects(chain.state(), IndexLagError);
});

// An unlock only reads the pool, so the pool UTxO stays the same; the feed must
// still pick it up once the deposit is gone.
test("an unlock appears in the feed although the pool did not move", async () => {
  const empty = merkleRoot([]);
  const z = 0n;
  const datum = serializeData(poolDatum({
    total_deposited: z, total_borrowed: z, interest_rate: z, collateral_ratio: z, group_root: empty, group_next_index: z,
    repaid_root: empty, next_index: z, external_nullifier: z, repay_external_nullifier: z, collateral_denomination: z,
    loan_denomination: z, last_updated: z, lender_root: empty, lender_next_index: z, total_shares: z,
    lender_external_nullifier: z, share_start_price: z, liquidity_reserve: z,
  }), "JSON");
  const S = { POOL_ADDRESS: "pool", POOL_NFT_UNIT: "nft", COLLATERAL_ADDRESS: "collateral" };
  const pool = { input: { txHash: "p0", outputIndex: 0 }, output: { amount: [{ unit: "nft", quantity: "1" }], plutusData: datum } };
  let deposits = [{ input: { txHash: "d0", outputIndex: 1 } }];
  let atCollateral = [{ tx_hash: "d0", block_time: 1 }];
  const provider = { fetchAddressUTxOs: async (a) => (a === "pool" ? [pool] : deposits) };
  const bf = async (p) => {
    if (p.startsWith("/addresses/collateral/")) return atCollateral;
    if (p === "/txs/u1/utxos") return { inputs: [{ address: "collateral" }] };
    if (p.startsWith("/txs/")) return { inputs: [] };
    return [];
  };
  const chain = createChainService({ provider, bf, S });
  assert.deepEqual((await chain.state()).activity, []);
  deposits = [];
  atCollateral = [{ tx_hash: "u1", block_time: 2 }, ...atCollateral];
  const s = await chain.state({ fresh: true });
  assert.deepEqual(s.activity.map((a) => a.type), ["unlock"]);
});
