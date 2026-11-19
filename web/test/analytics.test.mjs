// The browser sends counters only: no address, hash or message leaves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, eventsOf, walletName } from "../lib/analytics.js";

const proof = (kind, ms) => ({ type: "proof", kind, stage: "done", timings: { witnessMs: ms / 2, proveMs: ms / 2 - 10, verifyMs: 10 } });

test("a run becomes counters: start, proofs, signature, submission, outcome", () => {
  const flow = [
    { type: "collateral" }, { type: "sign" }, { type: "submitted", txHash: "22c77b0624" },
    { type: "retry", reason: "pool moved" }, proof("append", 1342.4), { type: "sign" },
    { type: "submitted", txHash: "a006f8ecac" }, { type: "confirming" },
  ];
  assert.deepEqual(eventsOf("deposit", flow), [
    { step: "deposit", event: "start" },
    { step: "collateral", event: "start" },
    { step: "deposit", event: "sign" },
    { step: "deposit", event: "submitted" },
    { step: "deposit", event: "proof", kind: "append", ms: 1342 },
    { step: "deposit", event: "sign" },
    { step: "deposit", event: "submitted" },
    { step: "deposit", event: "confirmed", retries: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(eventsOf("deposit", flow)), /22c77b|a006f8|pool moved/);
});

test("failures are sent as a class, never as their message", () => {
  const msg = "Payment to addr_test1qp390j3nd3ft… failed";
  assert.equal(classifyError({ code: 2, info: "user declined sign tx" }), "wallet_declined");
  assert.equal(classifyError({ code: "stale", message: msg }), "contention");
  assert.equal(classifyError({ code: "evaluation_failed", status: 422 }), "evaluation");
  assert.equal(classifyError({ status: 400, message: msg }), "relay_rejected");
  assert.equal(classifyError(new Error("Timed out waiting for the loan to appear on-chain.")), "timeout");
  assert.equal(classifyError(new TypeError("Failed to fetch")), "network");
  assert.equal(classifyError(new Error(msg)), "other");
  assert.deepEqual(eventsOf("borrow", [], new Error(msg)).at(-1), { step: "borrow", event: "failed", error: "other" });
});

test("wallet names outside the known list are sent as other", () => {
  assert.equal(walletName("Eternl"), "eternl");
  assert.equal(walletName("my-custom-wallet"), "other");
});

test("a switched wallet account and missing funds have their own class", () => {
  assert.equal(classifyError(Object.assign(new Error("switched"), { name: "AccountChanged" })), "account_changed");
  assert.equal(classifyError({ code: -4, info: "account changed" }), "account_changed");
  assert.equal(classifyError(new Error("UTxO Balance Insufficient")), "insufficient_funds");
  assert.equal(classifyError(new Error("Not enough ADA leftover to include non-ADA assets")), "insufficient_funds");
});
