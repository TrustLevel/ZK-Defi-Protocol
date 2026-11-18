"use client";

import { useEffect, useState } from "react";
import { getState } from "../lib/api";

const ada = (lovelace) => (Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// Public pool state as anyone can read it from the chain; no wallet needed.
export default function PoolView() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    const load = () => getState().then((s) => live && setState(s)).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (error) return <p className="text-warn">Could not load the pool: {error}</p>;
  if (!state) return <p className="text-muted">Reading the pool from the chain…</p>;

  const d = state.pool.datum;
  const lovelace = state.pool.utxo.output.amount.find((a) => a.unit === "lovelace").quantity;
  const utilization = d.total_deposited > 0n ? Number((d.total_borrowed * 10000n) / d.total_deposited) / 100 : 0;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Available" value={`${ada(lovelace)} ADA`} hint="lovelace in the pool UTxO" />
        <Stat label="Borrowed" value={`${ada(d.total_borrowed)} ADA`} hint={`${utilization}% utilization`} />
        <Stat label="Interest" value={`${Number(d.interest_rate) / 100}%`} hint="flat, per loan" />
        <Stat label="Open loans" value={d.open_loans.length} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Collateral unit" value={`${ada(d.collateral_denomination)} ADA`} hint="every deposit has this size" />
        <Stat label="Loan unit" value={`${ada(d.loan_denomination)} ADA`} hint="every loan has this size" />
        <Stat label="Anonymity set" value={state.leaves.commitments.length} hint="deposits your loan could come from" />
      </div>
    </section>
  );
}
