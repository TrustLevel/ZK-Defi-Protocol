"use client";

import Term from "./Term";

// Progress of a running step, from the events lib/flow.js reports.
const PROOF_NAME = { append: "append proof", borrow: "borrow proof", repay: "repay proof", settlement: "settlement proof" };

function line(e) {
  switch (e.type) {
    case "proof":
      if (e.stage === "done") {
        const t = e.timings ? ` in ${((e.timings.witnessMs + e.timings.proveMs + e.timings.verifyMs) / 1000).toFixed(1)} s` : "";
        return `✓ ${PROOF_NAME[e.kind]} generated and verified in your browser${t}`;
      }
      return `${PROOF_NAME[e.kind]}: ${e.stage}…`;
    case "collateral": return <>Your account has no pure-ADA output for <Term id="scriptCollateral">script collateral</Term>; creating one (sign once).</>;
    case "sign": return "Waiting for your wallet's signature…";
    case "relaying": return "Sending the proof to the relayer (it pays the fee)…";
    case "submitted": return `✓ Submitted ${e.txHash.slice(0, 10)}…`;
    case "confirming": return "Waiting for the chain…";
    case "retry": return `↻ ${e.reason}`;
    default: return null;
  }
}

export default function Progress({ events }) {
  // collapse consecutive stages of the same proof into one line
  const lines = [];
  for (const e of events) {
    const text = line(e);
    if (!text) continue;
    const prev = lines[lines.length - 1];
    if (e.type === "proof" && prev?.kind === e.kind && !prev.done) lines[lines.length - 1] = { text, kind: e.kind, done: e.stage === "done" };
    else if (e.type === "confirming" && prev?.type === "confirming") continue;
    else lines.push({ text, kind: e.type === "proof" ? e.kind : null, done: e.stage === "done", type: e.type, txHash: e.txHash });
  }
  return (
    <ul className="space-y-1 font-mono text-xs text-muted">
      {lines.map((l, i) => (
        <li key={i}>
          {l.txHash
            ? <a className="underline" href={`https://preprod.cardanoscan.io/transaction/${l.txHash}`} target="_blank" rel="noreferrer">{l.text}</a>
            : l.text}
        </li>
      ))}
    </ul>
  );
}
