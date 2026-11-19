"use client";

import { useCallback, useEffect, useState } from "react";
import { sharePriceUp, sharePriceDown, withdrawableShares } from "@zk-defi/protocol/tx";
import { getState } from "../lib/api";
import { deployment } from "../lib/flow";
import { createLenderNote, loadNotes, saveNote, parseNote } from "../lib/notes";
import { lenderStatusOf, sharesInPool } from "../lib/position";
import { track } from "../lib/analytics";
import ShareCard, { poolLovelace } from "./ShareCard";
import Term from "./Term";

const ada = (lovelace) => (Number(lovelace) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

// The user's pool shares (lender notes in this browser), each with its state
// derived locally from the public chain data. One note is one share.
export default function LendView({ account, onAccount }) {
  const [notes, setNotes] = useState([]);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setNotes(loadNotes(deployment.policyId, "lender"));
    try {
      setState(await getState());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  function newShare() {
    saveNote(createLenderNote({ network: "preprod", policyId: deployment.policyId, addKeyHashes: account?.keyHashes ?? [] }));
    refresh();
  }

  async function importNote(file) {
    try {
      const note = parseNote(await file.text());
      if (note.kind !== "lender") throw new Error("This is a collateral note; import it in the Borrow tab.");
      if (note.policyId !== deployment.policyId) throw new Error("This note belongs to a different pool.");
      saveNote(note);
      track([{ step: "note", event: "import" }]);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  const d = state?.pool.datum;
  const bal = state ? poolLovelace(state) : 0n;

  return (
    <section className="space-y-4">
      <div className="space-y-2 rounded-lg border border-line bg-surface p-5 text-sm">
        <p>
          Lenders provide the ADA that borrowers receive. You lend in <Term id="share">shares</Term>: each share is one note in your browser.
          Every repayment&apos;s 5% <Term id="interest">interest</Term> raises the price of every share. This liquidity is separate from
          borrowers&apos; <Term id="collateral">collateral</Term>, which only secures each borrower&apos;s own loan and is never lent out.
        </p>
        <p className="text-muted">
          The chain sees that account A bought a share and, later, that <em>some</em> share was withdrawn to some account. It cannot tell which
          withdrawal belongs to which purchase, how long a lender stayed, or what they earned.
        </p>
        {d && (
          <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
            <div><div className="text-xs text-muted">Buy price</div><div className="tabular-nums">{ada(sharePriceUp(d, bal))} ADA</div></div>
            <div><div className="text-xs text-muted">Payout per share</div><div className="tabular-nums">{d.total_shares > 0n ? `${ada(sharePriceDown(d, bal))} ADA` : "–"}</div></div>
            <div><div className="text-xs text-muted">Shares in the pool</div><div className="tabular-nums">{sharesInPool(state)}</div></div>
            <div><div className="text-xs text-muted"><Term id="freeLiquidity">Withdrawable now</Term></div><div className="tabular-nums">{String(withdrawableShares(d, bal))} shares</div></div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-md bg-accent px-4 py-2 text-sm text-white" onClick={newShare}>New share</button>
        <label className="cursor-pointer rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas">
          Import note
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && importNote(e.target.files[0])} />
        </label>
        <span className="text-xs text-muted">Notes stay in this browser. Nothing about them is sent to the server.</span>
      </div>
      {error && <p className="text-sm text-warn">{error}</p>}
      {notes.length === 0 && <p className="text-sm text-muted">No shares yet. Start one with “New share”.</p>}
      {[...notes].reverse().map((n) => (
        <ShareCard key={n.id} note={n} status={lenderStatusOf(n, state)} state={state} account={account} onAccount={onAccount} onChange={refresh} />
      ))}
    </section>
  );
}
