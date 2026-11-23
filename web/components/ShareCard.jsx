"use client";

import { useState } from "react";
import { deserializeAddress } from "@meshsdk/core";
import { sharePriceUp, sharePriceDown, withdrawableShares, poolBalance } from "@zk-defi/protocol/tx";
import * as flow from "../lib/flow";
import { downloadNote, saveNote, removeNote } from "../lib/notes";
import { withdrawWarnings } from "../lib/position";
import { shortAddress, ensureSameAccount } from "../lib/wallet";
import { eventsOf, track } from "../lib/analytics";
import Progress from "./Progress";
import Term from "./Term";

const ada = (lovelace) => (Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
// The pool's balance of its loan asset (ADA for the preview pool).
export const poolLovelace = (state) => poolBalance(state.pool);

function Warning({ children }) {
  return <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>;
}

// Two lenses on one share: what this browser knows, and what the chain shows.
function ShareLenses({ note, status }) {
  const known = {
    new: "A secret for one share, only in this browser.",
    pending: "You paid for the share; it is on its way into the pool.",
    held: "This share is yours. Only this note can withdraw it.",
    withdrawn: "This share was paid out.",
  }[status];
  const seen = {
    new: "Nothing yet.",
    pending: "Account A paid the share price into the pool, with a new lender leaf.",
    held: "Account A bought one share at the time it did. Nothing links that share to a later withdrawal.",
    withdrawn: "Some share was withdrawn to some account, for the price every share had at that moment. Which share, and whose: hidden.",
  }[status];
  if (!known) return null;
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-md bg-canvas p-3"><div className="text-xs uppercase tracking-wide text-muted">What you know</div>{known}</div>
      <div className="rounded-md bg-canvas p-3"><div className="text-xs uppercase tracking-wide text-muted">What the chain sees</div>{seen}</div>
    </div>
  );
}

// One pool share (one lender note): buy it from account A, withdraw it to account B.
export default function ShareCard({ note, status, state, account, onAccount, onChange }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [backedUp, setBackedUp] = useState(false);
  const [recipient, setRecipient] = useState("");

  async function run(name, step, { signed = false } = {}) {
    setBusy(true);
    setError(null);
    setEvents([]);
    const seen = [];
    const on = (e) => { seen.push(e); setEvents((x) => [...x, e]); };
    try {
      if (signed) await ensureSameAccount(account);
      await step(on);
      track(eventsOf(name, seen));
      onChange();
    } catch (e) {
      if (e?.name === "AccountChanged") onAccount?.(e.account);
      track(eventsOf(name, seen, e));
      setError(e?.info || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  let recipientPkh = null;
  try { recipientPkh = recipient ? deserializeAddress(recipient).pubKeyHash : null; } catch { /* invalid */ }
  const bal = state ? poolLovelace(state) : 0n;
  const d = state?.pool.datum;
  const warnings = recipientPkh && state ? withdrawWarnings(note, state, { keyHashes: [recipientPkh] }) : [];
  const free = d ? withdrawableShares(d, bal) > 0n : false;

  return (
    <article className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-sm">Share {note.id}</div>
        <div className="text-xs text-muted">{{ new: "Not bought yet", pending: "Buying", held: "In the pool", withdrawn: "Withdrawn", loading: "" }[status]}</div>
      </header>

      <ShareLenses note={note} status={status} />

      {status === "loading" && <p className="text-sm text-muted">Reading this share from the chain…</p>}

      {status === "new" && d && (
        <div className="space-y-3">
          <p className="text-sm">
            This share is a secret in your browser. <strong>Save the <Term id="note">note</Term> file now.</strong> Without it, nobody can
            withdraw the share, not even us.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-canvas" onClick={() => { downloadNote(note); setBackedUp(true); track([{ step: "note", event: "download" }]); }}>
              Download note
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} /> I stored the note file safely
            </label>
          </div>
          <p className="text-sm text-muted">
            Connect <strong><Term id="accountA">account A</Term></strong>. It pays the current <Term id="sharePrice">share price</Term> into the pool.
          </p>
          <div className="flex gap-2">
            <button disabled={!backedUp || !account || busy}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              onClick={() => run("liquidity", (on) => flow.lend(on, account, note, (added) => {
                saveNote({ ...note, added, addKeyHashes: account.keyHashes });
                onChange();
              }), { signed: true })}>
              Buy one share for {ada(sharePriceUp(d, bal))} ADA{account ? ` from ${shortAddress(account.address)}` : ""}
            </button>
            {!busy && <button className="text-sm text-muted underline" onClick={() => { removeNote(note.id); onChange(); }}>Discard</button>}
          </div>
        </div>
      )}

      {status === "pending" && <p className="text-sm text-muted">The share was paid. Waiting for it to appear on-chain…</p>}

      {status === "held" && (
        <div className="space-y-3">
          <p className="text-sm">
            Withdraw this share for {ada(sharePriceDown(d, bal))} ADA, the price every share has right now (it grows with each
            repayment&apos;s <Term id="interest">interest</Term>). The proof shows that <em>some</em> share in the pool is yours, not which one.
            The <Term id="relayer">relayer</Term> pays the fee, so your wallet does not appear in this transaction.
          </p>
          <label className="block text-sm">
            Pay to <strong><Term id="accountB">account B</Term></strong> (a different account from the one that bought the share):
            <div className="mt-1 flex gap-2">
              <input value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="addr_test1…"
                className="w-full rounded-md border border-line px-2 py-1.5 font-mono text-xs" />
              {account && <button className="whitespace-nowrap rounded-md border border-line px-2 text-xs hover:bg-canvas" onClick={() => setRecipient(account.address)}>Use connected account</button>}
            </div>
          </label>
          {recipient && !recipientPkh && <Warning>This is not a wallet address.</Warning>}
          {warnings.map((w) => <Warning key={w.code}>{w.text}</Warning>)}
          {!free && <Warning>Right now the pool&apos;s <Term id="freeLiquidity">free liquidity</Term> does not cover a share. It comes back as borrowers repay.</Warning>}
          <button disabled={!recipientPkh || !free || busy} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => run("withdraw", (on) => flow.withdraw(on, note, recipient))}>
            Withdraw {ada(sharePriceDown(d, bal))} ADA
          </button>
        </div>
      )}

      {status === "withdrawn" && <p className="text-sm text-muted">Done. The share was paid out.</p>}

      {events.length > 0 && <Progress events={events} />}
      {error && <Warning>{error}</Warning>}
    </article>
  );
}
