"use client";

// Two lenses on the next step: what only you know, and exactly what the
// transaction puts on-chain. Values are the real ones for this position.
import { computeNullifier, computeRepayNullifier } from "@zk-defi/protocol/crypto";
import { shortAddress } from "../lib/wallet";
import Term from "./Term";

const hex = (v) => "0x" + BigInt(v).toString(16).slice(0, 10) + "…";

// Row labels that have an explanation.
const TERM = {
  Secret: "secret", "Your secret": "secret", Commitment: "commitment", "Loan nullifier": "nullifier",
  "Repayment marker": "marker", "Which deposit": "anonymitySet", "Which repayment": "marker",
  "Fee paid by": "relayer", Amount: "fixedAmounts", Loan: "fixedAmounts",
};

function Row({ label, value, tone }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-muted">{TERM[label] ? <Term id={TERM[label]}>{label}</Term> : label}</span>
      <span className={`text-right font-mono ${tone === "hidden" ? "text-accent" : tone === "link" ? "text-warn" : ""}`}>{value}</span>
    </div>
  );
}

function lenses({ note, status, state, account, recipient, warnings }) {
  const deposits = state?.leaves.commitments.length ?? 0;
  const repaid = state?.leaves.repaid.length ?? 0;
  const N = computeNullifier(note.secret);
  const R = computeRepayNullifier(note.secret);
  const linked = warnings.length > 0;
  const secret = ["Secret", "only in this browser", "hidden"];
  switch (status) {
    case "new":
      return {
        title: "Deposit",
        know: [secret, ["Collateral", "20 ADA"], ["Returns to", account ? shortAddress(account.address) : "account A"]],
        chain: [
          ["Amount", "20 ADA (every deposit is 20 ADA)"],
          ["Paid by", account ? shortAddress(account.address) : "account A"],
          ["Commitment", hex(note.commitment)],
          ["Your secret", "not on-chain", "hidden"],
        ],
      };
    case "deposited":
      return {
        title: "Borrow",
        know: [secret, ["Backed by", `your deposit (${hex(note.commitment)})`], ["Loan to", recipient ? shortAddress(recipient) : "account B"]],
        chain: [
          ["Loan", "10 ADA (every loan is 10 ADA)"],
          ["Paid to", recipient ? shortAddress(recipient) : "account B", linked ? "link" : undefined],
          ["Loan nullifier", hex(N)],
          ["Which deposit", `hidden: one of ${deposits}`, "hidden"],
          ["Fee paid by", "the relayer", "hidden"],
        ],
      };
    case "borrowed":
      return {
        title: "Repay",
        know: [secret, ["This loan", "is yours"], ["Pays", account ? shortAddress(account.address) : "account B"]],
        chain: [
          ["Amount", "10.5 ADA (every repayment is 10.5 ADA)"],
          ["Paid by", account ? shortAddress(account.address) : "account B", linked ? "link" : undefined],
          ["Loan nullifier", `${hex(N)} (same as the loan, by design)`],
          ["Repayment marker", hex(R)],
          ["Which deposit", "hidden: the marker reveals none", "hidden"],
        ],
      };
    case "repaid":
      return {
        title: "Unlock",
        know: [secret, ["Your repayment", "is in the repaid set"]],
        chain: [
          ["Deposit spent", note.deposit ? `${note.deposit.txHash.slice(0, 10)}…#${note.deposit.outputIndex}` : "your deposit"],
          ["Paid to", "the account that deposited"],
          ["Which repayment", `hidden: one of ${repaid}`, "hidden"],
          ["Link to the loan", "none", "hidden"],
          ["Fee paid by", "the relayer", "hidden"],
        ],
      };
    default:
      return null;
  }
}

export default function Lenses(props) {
  const l = lenses(props);
  if (!l) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-line p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">What you know</div>
        {l.know.map(([a, b, t]) => <Row key={a} label={a} value={b} tone={t} />)}
      </div>
      <div className="rounded-md bg-chain-soft p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-chain">What the chain sees · {l.title}</div>
        {l.chain.map(([a, b, t]) => <Row key={a} label={a} value={b} tone={t} />)}
      </div>
    </div>
  );
}
