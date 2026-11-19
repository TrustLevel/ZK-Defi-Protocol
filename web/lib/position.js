// The state of a note, derived in this browser from public chain data: the
// backend serves all commitments and nullifiers and never learns which one is
// the user's.
import { computeNullifier, computeRepayNullifier } from "@zk-defi/protocol/crypto";

export const STEPS = ["deposited", "borrowed", "repaid", "unlocked"];

// state: getState() result; depositSpent: whether the deposit UTxO is gone
export function positionOf(note, state, { depositSpent }) {
  const { datum } = state.pool;
  const deposited = state.leaves.commitments.includes(note.commitment);
  if (!deposited) return note.deposit ? "pending" : "new";
  if (state.leaves.repaid.includes(computeRepayNullifier(note.secret))) return depositSpent ? "unlocked" : "repaid";
  if (datum.used_nullifiers.includes(computeNullifier(note.secret))) return "borrowed";
  return "deposited";
}

// The card's state: "loading" until the chain state is there, so no step is
// offered on a guess (a note shown as new could be deposited a second time).
export function statusOf(note, state) {
  if (!state) return "loading";
  const ref = note.deposit && `${note.deposit.txHash}#${note.deposit.outputIndex}`;
  return positionOf(note, state, { depositSpent: !!ref && !state.deposits.has(ref) });
}

// What a step would reveal on-chain if done from this account. keyHashes: the
// payment key hashes of the connected account (or of the loan recipient).
export function linkageWarnings(note, { step, keyHashes }) {
  const fromDepositAccount = keyHashes.some((k) => note.depositKeyHashes.includes(k));
  if (!fromDepositAccount) return [];
  if (step === "repay") {
    return [{
      code: "repay-from-deposit-account",
      text: "This account paid the deposit. The repayment reveals the loan, so repaying from here links your deposit to your loan on-chain.",
    }];
  }
  if (step === "borrow") {
    return [{
      code: "loan-to-deposit-account",
      text: "This account paid the deposit. Paying the loan to it links your deposit to your loan on-chain.",
    }];
  }
  return [];
}
