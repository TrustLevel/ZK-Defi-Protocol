"use client";

import { useState } from "react";
import { deserializeAddress } from "@meshsdk/core";
import * as flow from "../lib/flow";
import { downloadNote, saveNote, removeNote } from "../lib/notes";
import { STEPS, linkageWarnings } from "../lib/position";
import { shortAddress } from "../lib/wallet";
import Progress from "./Progress";
import Lenses from "./Lenses";

const LABEL = { deposited: "Deposited", borrowed: "Borrowed", repaid: "Repaid", unlocked: "Unlocked" };

function Stepper({ status }) {
  const reached = STEPS.indexOf(status);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 ${i <= reached ? "text-accent" : "text-muted"}`}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${i <= reached ? "bg-accent" : "border border-line"}`} />
          {LABEL[s]}
          {i < STEPS.length - 1 && <span className="text-line">—</span>}
        </li>
      ))}
    </ol>
  );
}

function Warning({ children }) {
  return <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>;
}

// One position (one note): the next step, which account it needs, and progress.
export default function PositionCard({ note, status, state, account, onChange }) {
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [backedUp, setBackedUp] = useState(false);
  const [recipient, setRecipient] = useState("");

  async function run(step) {
    setBusy(true);
    setError(null);
    setEvents([]);
    const on = (e) => setEvents((x) => [...x, e]);
    try {
      await step(on);
      onChange();
    } catch (e) {
      setError(e?.info || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const accountWarnings = account ? linkageWarnings(note, { step: status === "borrowed" ? "repay" : "borrow", keyHashes: account.keyHashes }) : [];
  let recipientPkh = null;
  try { recipientPkh = recipient ? deserializeAddress(recipient).pubKeyHash : null; } catch { /* invalid */ }
  const recipientWarnings = recipientPkh ? linkageWarnings(note, { step: "borrow", keyHashes: [recipientPkh] }) : [];

  return (
    <article className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-sm">Position {note.id}</div>
        <Stepper status={status} />
      </header>

      <Lenses note={note} status={status} state={state} account={account} recipient={recipientPkh ? recipient : ""}
        warnings={status === "deposited" ? recipientWarnings : status === "borrowed" ? accountWarnings : []} />

      {status === "new" && (
        <div className="space-y-3">
          <p className="text-sm">
            This position is a secret in your browser. <strong>Save the note file now.</strong> Without it, nobody can
            unlock the collateral, not even us.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-canvas" onClick={() => { downloadNote(note); setBackedUp(true); }}>
              Download note
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} /> I stored the note file safely
            </label>
          </div>
          <p className="text-sm text-muted">
            Connect <strong>account A</strong>, the account that holds your collateral. It pays exactly 20 ADA; the
            collateral returns to it when you unlock.
          </p>
          <div className="flex gap-2">
            <button disabled={!backedUp || !account || busy}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
              onClick={() => run((on) => flow.deposit(on, account, note, (dep) => {
                saveNote({ ...note, deposit: dep, depositKeyHashes: account.keyHashes });
                onChange();
              }))}>
              Deposit 20 ADA{account ? ` from ${shortAddress(account.address)}` : ""}
            </button>
            {!busy && <button className="text-sm text-muted underline" onClick={() => { removeNote(note.id); onChange(); }}>Discard</button>}
          </div>
        </div>
      )}

      {status === "pending" && <p className="text-sm text-muted">The deposit was submitted. Waiting for it to appear on-chain…</p>}

      {status === "deposited" && (
        <div className="space-y-3">
          <p className="text-sm">
            Borrow 10 ADA against this deposit. The proof shows that <em>some</em> deposit in the pool backs the loan,
            not which one. The relayer pays the fee, so your wallet does not appear in this transaction.
          </p>
          <label className="block text-sm">
            Pay the loan to <strong>account B</strong> (a different account from the one that deposited):
            <div className="mt-1 flex gap-2">
              <input value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="addr_test1…"
                className="w-full rounded-md border border-line px-2 py-1.5 font-mono text-xs" />
              {account && <button className="whitespace-nowrap rounded-md border border-line px-2 text-xs hover:bg-canvas" onClick={() => setRecipient(account.address)}>Use connected account</button>}
            </div>
          </label>
          {recipient && !recipientPkh && <Warning>This is not a wallet address.</Warning>}
          {recipientWarnings.map((w) => <Warning key={w.code}>{w.text}</Warning>)}
          <button disabled={!recipientPkh || busy} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => run((on) => flow.borrow(on, note, recipient))}>
            Borrow 10 ADA
          </button>
        </div>
      )}

      {status === "borrowed" && (
        <div className="space-y-3">
          <p className="text-sm">
            Repay 10.5 ADA (10 ADA + 5% interest) from <strong>account B</strong>, the account that received the loan.
          </p>
          {accountWarnings.map((w) => <Warning key={w.code}>{w.text}</Warning>)}
          <button disabled={!account || busy} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => run((on) => flow.repay(on, account, note))}>
            Repay 10.5 ADA{account ? ` from ${shortAddress(account.address)}` : ""}
          </button>
        </div>
      )}

      {status === "repaid" && (
        <div className="space-y-3">
          <p className="text-sm">
            Unlock your 20 ADA. The proof shows that this deposit's loan was repaid without saying which repayment was
            yours. The relayer pays the fee; the collateral returns to the account that deposited it.
          </p>
          <button disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() => run((on) => flow.unlock(on, note))}>
            Unlock 20 ADA
          </button>
        </div>
      )}

      {status === "unlocked" && <p className="text-sm text-muted">Done. The collateral is back in account A.</p>}

      {events.length > 0 && <Progress events={events} />}
      {error && <Warning>{error}</Warning>}
    </article>
  );
}
