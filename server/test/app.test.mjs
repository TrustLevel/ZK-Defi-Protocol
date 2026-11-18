import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.mjs";
import { IndexLagError } from "../src/chain-service.mjs";

const deployment = { network: "preprod", policyId: "aa", poolAddress: "addr_pool", collateralAddress: "addr_coll" };
const snapshot = {
  at: 1,
  pool: { utxo: { input: { txHash: "ab", outputIndex: 0 } }, datum: { group_root: 2n ** 254n, open_loans: [5n] } },
  leaves: { commitments: [7n], repaid: [] },
};
const okChain = { state: async () => snapshot };
const txService = { evaluate: async () => [{ index: 0, budget: { mem: 1n, steps: 2n } }], submit: async () => "cafe" };

test("GET /api/state returns pool and leaves with integers as strings", async () => {
  const app = await buildApp({ chain: okChain, txService, deployment });
  const res = await app.inject({ method: "GET", url: "/api/state" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.pool.datum.group_root, (2n ** 254n).toString());
  assert.deepEqual(body.pool.datum.open_loans, ["5"]);
  assert.deepEqual(body.leaves.commitments, ["7"]);
  assert.equal(body.deployment.poolAddress, "addr_pool");
});

test("GET /api/state answers 503 while the index lags the pool", async () => {
  const app = await buildApp({ chain: { state: async () => { throw new IndexLagError(); } }, txService, deployment });
  const res = await app.inject({ method: "GET", url: "/api/state" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["retry-after"], "5");
});

test("evaluate and submit accept only hex transactions", async () => {
  const app = await buildApp({ chain: okChain, txService, deployment });
  assert.equal((await app.inject({ method: "POST", url: "/api/submit", payload: { tx: "not-hex" } })).statusCode, 400);
  const sub = await app.inject({ method: "POST", url: "/api/submit", payload: { tx: "84a4" } });
  assert.deepEqual(sub.json(), { txHash: "cafe" });
  const ev = await app.inject({ method: "POST", url: "/api/evaluate", payload: { tx: "84a4" } });
  assert.equal(ev.json().redeemers[0].budget.mem, "1");
});

test("relay routes exist only with a relayer", async () => {
  const without = await buildApp({ chain: okChain, txService, deployment });
  assert.equal((await without.inject({ method: "POST", url: "/api/relay/borrow", payload: {} })).statusCode, 404);
  const relayer = { borrow: async () => ({ txHash: "b0" }), unlock: async () => ({ txHash: "u0" }) };
  const withRelayer = await buildApp({ chain: okChain, txService, relayer, deployment });
  assert.deepEqual((await withRelayer.inject({ method: "POST", url: "/api/relay/unlock", payload: {} })).json(), { txHash: "u0" });
});
