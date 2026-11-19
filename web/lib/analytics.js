// Anonymous usage counts for the test round. What is sent is a closed
// vocabulary (server/src/analytics.mjs): the step, what happened, proof times,
// an error class and the wallet's name. Never an address, a transaction hash, a
// commitment, a nullifier or a note. One request carries one step, so nothing
// links two steps of a position. The user can turn it off; every request this
// browser sent is listed in the page footer.

const KEY = "zk-lending.analytics";
const WALLETS = ["eternl", "lace", "nami", "typhoncip30", "yoroi", "gerowallet", "nufi", "vespr", "begin"];

export const sent = []; // what this browser sent in this session, for the footer
const listeners = new Set();
export const onSent = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function enabled() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return false;
  }
}
export function setEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch { /* storage blocked: stays off */ }
}

// The class of a failure, never its message (messages can carry addresses).
export function classifyError(e) {
  const text = String(e?.info || e?.message || e);
  if (e?.code === 2 || e?.code === -3 || /declin|reject|cancel/i.test(text)) return "wallet_declined";
  if (e?.code === "stale" || e?.code === "pool_moved" || /BadInputsUTxO|All inputs are spent|UnknownUtxo/i.test(text)) return "contention";
  if (e?.code === "evaluation_failed" || /evaluat/i.test(text)) return "evaluation";
  if (e?.status >= 400 && e?.status < 500) return "relay_rejected";
  if (/timed out/i.test(text)) return "timeout";
  if (e instanceof TypeError || /fetch|network/i.test(text)) return "network";
  return "other";
}

// The counters for one run of a step, from the progress events of lib/flow.js.
export function eventsOf(step, flowEvents, error) {
  const out = [{ step, event: "start" }];
  for (const e of flowEvents) {
    if (e.type === "proof" && e.stage === "done" && e.timings) {
      const ms = Math.round(e.timings.witnessMs + e.timings.proveMs + e.timings.verifyMs);
      out.push({ step, event: "proof", kind: e.kind, ms });
    }
    if (e.type === "sign") out.push({ step, event: "sign" });
    if (e.type === "submitted") out.push({ step, event: "submitted" });
    if (e.type === "collateral") out.push({ step: "collateral", event: "start" });
  }
  const retries = Math.min(10, flowEvents.filter((e) => e.type === "retry").length);
  out.push(error ? { step, event: "failed", error: classifyError(error) } : { step, event: "confirmed", retries });
  return out.slice(0, 20);
}

export const walletName = (id) => (WALLETS.includes(String(id).toLowerCase()) ? String(id).toLowerCase() : "other");

export function track(events) {
  if (!enabled() || !events.length) return;
  sent.push(events);
  listeners.forEach((fn) => fn());
  fetch("/api/events", {
    method: "POST", keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  }).catch(() => { /* counts are best effort */ });
}
