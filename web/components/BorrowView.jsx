"use client";

import { useCallback, useEffect, useState } from "react";
import { getState } from "../lib/api";
import { deployment } from "../lib/flow";
import { createNote, loadNotes, saveNote, parseNote } from "../lib/notes";
import { positionOf } from "../lib/position";
import PositionCard from "./PositionCard";
import { track } from "../lib/analytics";

// The user's positions (notes in this browser), each with its state derived
// locally from the public chain data.
export default function BorrowView({ account }) {
  const [notes, setNotes] = useState([]);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setNotes(loadNotes(deployment.policyId));
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

  function newPosition() {
    saveNote(createNote({ network: "preprod", policyId: deployment.policyId, depositKeyHashes: account?.keyHashes ?? [] }));
    refresh();
  }

  async function importNote(file) {
    try {
      const note = parseNote(await file.text());
      if (note.policyId !== deployment.policyId) throw new Error("This note belongs to a different pool.");
      saveNote(note);
      track([{ step: "note", event: "import" }]);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  const status = (note) => {
    if (!state) return "new";
    const ref = note.deposit && `${note.deposit.txHash}#${note.deposit.outputIndex}`;
    return positionOf(note, state, { depositSpent: !!ref && !state.deposits.has(ref) });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-md bg-accent px-4 py-2 text-sm text-white" onClick={newPosition}>New position</button>
        <label className="cursor-pointer rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas">
          Import note
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && importNote(e.target.files[0])} />
        </label>
        <span className="text-xs text-muted">Notes stay in this browser. Nothing about them is sent to the server.</span>
      </div>
      {error && <p className="text-sm text-warn">{error}</p>}
      {notes.length === 0 && <p className="text-sm text-muted">No positions yet. Start one with “New position”.</p>}
      {[...notes].reverse().map((n) => (
        <PositionCard key={n.id} note={n} status={status(n)} state={state} account={account} onChange={refresh} />
      ))}
    </section>
  );
}
