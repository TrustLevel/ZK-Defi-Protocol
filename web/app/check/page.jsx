"use client";

// Browser check: generate one proof of each kind with throwaway inputs and show
// how long this browser takes. Nothing is sent anywhere.
import { useState } from "react";
import {
  computeCommitment, computeRepayNullifier, borrowInput, repayInput, settlementInput, appendInput,
} from "@zk-defi/protocol/crypto";
import { prove } from "../../lib/prover";
import PocNotice from "../../components/PocNotice";

function inputs() {
  const secret = BigInt("0x" + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  const commitment = computeCommitment(20_000_000n, secret);
  const commitments = [11n, 22n, commitment];
  const R = computeRepayNullifier(secret);
  return {
    append: appendInput({ leavesBefore: [11n, 22n], leaf: commitment }).input,
    borrow: borrowInput({ commitments, index: 2, secret, ratio: 125n, recipientPkh: "ab".repeat(28) }).input,
    repay: repayInput({ commitments, index: 2, secret, ratio: 125n }).input,
    settlement: settlementInput({ commitment, secret, repaid: [44n, R], index: 1 }).input,
  };
}

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;

export default function Check() {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setRows([]);
    const all = inputs();
    for (const kind of Object.keys(all)) {
      setRows((r) => [...r, { kind, stage: "loading" }]);
      const update = (patch) => setRows((r) => r.map((x) => (x.kind === kind ? { ...x, ...patch } : x)));
      try {
        const { timings } = await prove(kind, all[kind], (stage) => update({ stage }));
        update({ stage: "verified", timings });
      } catch (e) {
        update({ stage: "failed", error: e.message });
      }
    }
    setRunning(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <PocNotice />
      <h1 className="text-2xl font-semibold">Browser check</h1>
      <p className="mt-1 text-sm text-muted">
        Generates one zero-knowledge proof of each kind with throwaway inputs, in this browser, and verifies it. Nothing is sent anywhere.
      </p>
      <button onClick={run} disabled={running} className="mt-4 rounded-md bg-accent px-4 py-2 text-white disabled:opacity-50">
        {running ? "Proving…" : "Run the check"}
      </button>
      <table className="mt-6 w-full text-sm">
        <thead className="text-left text-muted">
          <tr><th className="py-1">Proof</th><th>Status</th><th>Witness</th><th>Proving</th><th>Verify</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className="border-t border-line" data-kind={r.kind} data-stage={r.stage}>
              <td className="py-2 font-medium">{r.kind}</td>
              <td className={r.stage === "failed" ? "text-warn" : ""}>{r.error || r.stage}</td>
              <td className="tabular-nums">{r.timings && s(r.timings.witnessMs)}</td>
              <td className="tabular-nums">{r.timings && s(r.timings.proveMs)}</td>
              <td className="tabular-nums">{r.timings && s(r.timings.verifyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
