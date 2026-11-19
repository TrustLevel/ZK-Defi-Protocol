/**
 * Usage analytics for the test round, kept as counters per day and nothing
 * else: no event is stored on its own, nothing links two events, and no
 * address, transaction hash, commitment, nullifier, IP or time of day is ever
 * accepted. What the browser may send is a closed vocabulary (EVENT below);
 * anything else is refused. The counters are public (GET /api/analytics).
 *
 *   { step: "deposit", event: "start" }
 *   { step: "deposit", event: "proof", kind: "append", ms: 1342 }
 *   { step: "deposit", event: "failed", error: "wallet_declined" }
 *   { step: "deposit", event: "confirmed", retries: 0 }
 *   { step: "wallet", event: "connect", wallet: "eternl" }
 */
import fs from "fs";

const STEPS = ["deposit", "borrow", "repay", "unlock", "liquidity", "collateral", "wallet", "note"];
const EVENTS = ["start", "proof", "sign", "submitted", "confirmed", "failed", "connect", "download", "import"];
const KINDS = ["append", "borrow", "repay", "settlement"];
const ERRORS = ["wallet_declined", "account_changed", "insufficient_funds", "contention", "evaluation", "relay_rejected", "timeout", "network", "other"];
const WALLETS = ["eternl", "lace", "nami", "typhoncip30", "yoroi", "gerowallet", "nufi", "vespr", "begin", "other"];

export const EVENT = {
  type: "object",
  additionalProperties: false,
  required: ["step", "event"],
  properties: {
    step: { enum: STEPS },
    event: { enum: EVENTS },
    kind: { enum: KINDS },
    ms: { type: "integer", minimum: 0, maximum: 600000 },
    error: { enum: ERRORS },
    retries: { type: "integer", minimum: 0, maximum: 10 },
    wallet: { enum: WALLETS },
  },
};

// Proof times in buckets of 100 ms: enough for a median, no exact values.
const bucket = (ms) => String(Math.round(ms / 100) * 100);

export function createAnalytics({ file, now = () => new Date(), flushMs = 5000 } = {}) {
  let days = {};
  if (file && fs.existsSync(file)) days = JSON.parse(fs.readFileSync(file, "utf8"));
  let timer = null;
  const persist = () => {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      fs.writeFileSync(file + ".tmp", JSON.stringify(days, null, 1));
      fs.renameSync(file + ".tmp", file);
    }, flushMs);
    timer.unref?.();
  };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

  return {
    record(e) {
      const day = (days[now().toISOString().slice(0, 10)] ??= { counts: {}, proofMs: {} });
      inc(day.counts, `${e.step}.${e.event}`);
      if (e.event === "proof" && e.kind && e.ms !== undefined) inc((day.proofMs[e.kind] ??= {}), bucket(e.ms));
      if (e.event === "failed" && e.error) inc(day.counts, `${e.step}.failed.${e.error}`);
      if (e.event === "confirmed" && e.retries !== undefined) inc(day.counts, `${e.step}.retries.${e.retries}`);
      if (e.event === "connect" && e.wallet) inc(day.counts, `wallet.${e.wallet}`);
      persist();
    },
    summary: () => days,
  };
}
