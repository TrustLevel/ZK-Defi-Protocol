// The analytics take counters from a closed vocabulary and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.mjs";
import { createAnalytics } from "../src/analytics.mjs";

const deployment = { network: "preprod" };
const day = new Date("2026-11-19T15:42:00Z");
const appWith = async () => {
  const analytics = createAnalytics({ now: () => day });
  return { analytics, app: await buildApp({ chain: {}, txService: {}, analytics, deployment }) };
};
const post = (app, events) => app.inject({ method: "POST", url: "/api/events", payload: { events } });

test("counts steps, proof times in 100 ms buckets, errors, retries and wallets per day", async () => {
  const { app } = await appWith();
  const res = await post(app, [
    { step: "deposit", event: "start" },
    { step: "deposit", event: "proof", kind: "append", ms: 1342 },
    { step: "deposit", event: "failed", error: "wallet_declined" },
    { step: "deposit", event: "confirmed", retries: 1 },
    { step: "wallet", event: "connect", wallet: "eternl" },
  ]);
  assert.equal(res.statusCode, 204);
  const s = (await app.inject({ method: "GET", url: "/api/analytics" })).json();
  assert.deepEqual(Object.keys(s), ["2026-11-19"]);
  assert.deepEqual(s["2026-11-19"].proofMs, { append: { 1300: 1 } });
  assert.deepEqual(s["2026-11-19"].counts, {
    "deposit.start": 1, "deposit.proof": 1, "deposit.failed": 1, "deposit.failed.wallet_declined": 1,
    "deposit.confirmed": 1, "deposit.retries.1": 1, "wallet.connect": 1, "wallet.eternl": 1,
  });
});

test("refuses anything outside the vocabulary: addresses, hashes, free text", async () => {
  const { app, analytics } = await appWith();
  for (const events of [
    [{ step: "deposit", event: "start", address: "addr_test1qp…" }],
    [{ step: "deposit", event: "submitted", txHash: "22c77b0624" }],
    [{ step: "deposit", event: "failed", error: "user declined sign tx" }],
    [{ step: "addr_test1qp", event: "start" }],
    [{ step: "deposit", event: "proof", kind: "append", ms: 1.5 }],
  ]) assert.equal((await post(app, events)).statusCode, 400, JSON.stringify(events));
  assert.deepEqual(analytics.summary(), {});
});

test("knows the error classes the web app sends", async () => {
  const { app } = await appWith();
  for (const error of ["account_changed", "insufficient_funds"]) {
    assert.equal((await post(app, [{ step: "repay", event: "failed", error }])).statusCode, 204, error);
  }
});

test("counts the lender steps: buying a share and withdrawing it with the lender proof", async () => {
  const { app } = await appWith();
  const res = await post(app, [
    { step: "withdraw", event: "start" },
    { step: "withdraw", event: "proof", kind: "lender", ms: 1040 },
    { step: "withdraw", event: "confirmed", retries: 0 },
  ]);
  assert.equal(res.statusCode, 204);
  const s = (await app.inject({ method: "GET", url: "/api/analytics" })).json();
  assert.deepEqual(s["2026-11-19"].proofMs, { lender: { 1000: 1 } });
});
