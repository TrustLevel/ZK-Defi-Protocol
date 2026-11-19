"use client";

import { useState } from "react";
import * as flow from "../lib/flow";
import Progress from "./Progress";
import Term from "./Term";
import { eventsOf, track } from "../lib/analytics";

// Add liquidity to the pool. Withdrawing liquidity is not part of the current
// protocol; the UI says so.
export default function LendView({ account }) {
  const [amount, setAmount] = useState("10");
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const lovelace = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n >= 1 ? BigInt(Math.round(n * 1e6)) : null;
  })();

  async function lend() {
    setBusy(true);
    setError(null);
    setEvents([]);
    const seen = [];
    try {
      await flow.addLiquidity((e) => { seen.push(e); setEvents((x) => [...x, e]); }, account, lovelace);
      track(eventsOf("liquidity", seen));
    } catch (e) {
      track(eventsOf("liquidity", seen, e));
      setError(e?.info || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <p className="text-sm">
        Lenders provide the ADA that borrowers receive. Each loan pays 5% interest into the pool.
      </p>
      <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
        <Term id="withdraw">Withdrawing</Term> liquidity is not available yet. Only add test ADA you do not need back.
      </p>
      <div className="flex items-center gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
          className="w-28 rounded-md border border-line px-2 py-1.5 text-right tabular-nums" />
        <span className="text-sm">ADA</span>
        <button disabled={!account || !lovelace || busy} onClick={lend}
          className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">
          Add liquidity
        </button>
        {!account && <span className="text-xs text-muted">Connect a wallet first.</span>}
      </div>
      {events.length > 0 && <Progress events={events} />}
      {error && <p className="text-sm text-warn">{error}</p>}
    </section>
  );
}
