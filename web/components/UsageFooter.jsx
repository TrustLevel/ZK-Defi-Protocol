"use client";

import { useEffect, useState } from "react";
import { enabled, setEnabled, sent, onSent } from "../lib/analytics";

// The analytics in plain view: what is counted, a switch, every request this
// browser sent, and the public totals.
export default function UsageFooter() {
  const [on, setOn] = useState(false);
  const [, setCount] = useState(0);
  useEffect(() => {
    setOn(enabled());
    return onSent(() => setCount((n) => n + 1));
  }, []);

  return (
    <footer className="mt-10 border-t border-line pt-4 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => { setEnabled(e.target.checked); setOn(e.target.checked); }} />
          Share anonymous usage counts for the test round
        </label>
        <a className="underline" href="/api/analytics" target="_blank" rel="noreferrer">all counts (public)</a>
      </div>
      <p className="mt-1">
        Counted: which step ran, whether it finished, proof times, the kind of error and the wallet's name. Never an
        address, a transaction, a commitment, a nullifier or your note; nothing links two steps.
      </p>
      {sent.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">What this browser sent ({sent.length})</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-surface p-2 font-mono">
            {sent.map((batch) => JSON.stringify(batch)).join("\n")}
          </pre>
        </details>
      )}
    </footer>
  );
}
