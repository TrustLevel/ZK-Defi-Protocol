"use client";

import { useEffect, useState } from "react";
import { getState } from "../lib/api";
import { poolBalance } from "@zk-defi/protocol/tx";
import Term from "./Term";

const hexText = (hex) => new TextDecoder().decode(Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16)));
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
const hex = (v) => "0x" + BigInt(v).toString(16).slice(0, 8) + "…";
const ago = (t) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
// What each transaction reveals: amounts are fixed, so only the kind and the
// public tags differ; nothing says which deposit a loan or an unlock belongs to.
const SHOWS = {
  deposit: (a) => `20 ADA collateral locked · commitment ${hex(a.commitment)}`,
  borrow: (a) => `10 ADA out · nullifier ${hex(a.nullifier)} · which collateral: hidden`,
  repay: (a) => `10.5 ADA in · nullifier ${hex(a.nullifier)} · marker ${hex(a.marker)}`,
  unlock: () => "20 ADA collateral returned · which repayment: hidden",
  liquidity: () => "one share bought at the current price · lender leaf added",
  withdraw: (a) => `one share paid out at the current price · nullifier ${hex(a.nullifier)} · which share: hidden`,
};

// What each kind of transaction is called in the feed.
const KIND = { deposit: "Collateral", borrow: "Borrow", repay: "Repay", unlock: "Unlock", liquidity: "Lend", withdraw: "Withdraw" };

// The commitment tree as a grid. No leaf is highlighted: the chain does not
// know which one is yours, and neither does this page.
function AnonymitySet({ count }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-muted"><Term id="anonymitySet" /></div>
        <div className="text-xs text-muted">{count} of 1024 slots</div>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(32,minmax(0,1fr))] gap-[3px]">
        {Array.from({ length: Math.min(1024, Math.max(128, Math.ceil(count / 32) * 32)) }, (_, i) => (
          <span key={i} className={`aspect-square rounded-[2px] ${i < count ? "bg-accent" : "bg-canvas"}`} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Every locked collateral is one leaf. A loan proves it is backed by one of them, without saying which.
      </p>
    </div>
  );
}

function Activity({ items }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">What the chain sees</div>
      <ul className="mt-2 divide-y divide-line">
        {items.map((a) => (
          <li key={a.txHash} className="flex flex-wrap items-baseline gap-x-3 py-2 text-xs">
            <span className="w-20 font-semibold">{KIND[a.type] ?? a.type}</span>
            <span className="flex-1 font-mono text-muted">{SHOWS[a.type]?.(a)}</span>
            <a className="text-muted underline" href={`https://preprod.cardanoscan.io/transaction/${a.txHash}`} target="_blank" rel="noreferrer">{ago(a.time)}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const free = poolBalance(state.pool) - d.liquidity_reserve;
  const collateralUnit = d.collateral_assets.map((c) => (c.policy_id === "" ? `${ada(c.denomination)} ADA` : `${c.denomination} ${hexText(c.asset_name)}`)).join(" or ");
  const utilization = free + d.total_borrowed > 0n ? Number((d.total_borrowed * 10000n) / (free + d.total_borrowed)) / 100 : 0;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={<Term id="freeLiquidity">Available</Term>} value={`${ada(free)} ADA`} hint={`free liquidity, ${d.total_shares} lender shares`} />
        <Stat label="Borrowed" value={`${ada(d.total_borrowed)} ADA`} hint={`${utilization}% utilization`} />
        <Stat label={<Term id="interest" />} value={`${Number(d.interest_rate) / 100}%`} hint="flat, per loan" />
        <Stat label="Open loans" value={d.open_loans.length} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={<Term id="fixedAmounts">Collateral unit</Term>} value={collateralUnit} hint="every collateral of an asset has this size" />
        <Stat label={<Term id="fixedAmounts">Loan unit</Term>} value={`${ada(d.loan_denomination)} ADA`} hint="every loan has this size" />
        <Stat label={<Term id="collateral">Locked collateral</Term>} value={state.deposits.size} hint="borrowers' own security, not pool funds" />
      </div>
      <AnonymitySet count={state.leaves.commitments.length} />
      <Activity items={state.activity} />
    </section>
  );
}
