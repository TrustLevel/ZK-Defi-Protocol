// The state of a note, derived in this browser from public chain data: the
// backend serves all commitments and nullifiers and never learns which one is
// the user's.
import { computeNullifier, computeRepayNullifier, computeLenderNullifier } from "@zk-defi/protocol/crypto";

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
      text: "This account locked the collateral. The repayment reveals the loan, so repaying from here links your collateral to your loan on-chain.",
    }];
  }
  if (step === "borrow") {
    return [{
      code: "loan-to-deposit-account",
      text: "This account locked the collateral. Paying the loan to it links your collateral to your loan on-chain.",
    }];
  }
  return [];
}

// ── lender notes (one pool share each) ───────────────────────────────────────
// Below this many shares still in the pool, a withdrawal hides among few others.
export const SMALL_LENDER_SET = 5;

// "loading" until the chain state is there (no step is offered on a guess);
// then new → pending (added, not yet indexed) → held → withdrawn.
export function lenderStatusOf(note, state) {
  if (!state) return "loading";
  if (state.pool.datum.lender_nullifiers.includes(computeLenderNullifier(note.secret))) return "withdrawn";
  if (state.leaves.lenders.includes(note.commitment)) return "held";
  return note.added ? "pending" : "new";
}

// Shares still in the pool: the notes a withdrawal hides among.
export const sharesInPool = (state) => state.leaves.lenders.length - state.pool.datum.lender_nullifiers.length;

// What a withdrawal would reveal. keyHashes: payment key hashes of the payout account.
export function withdrawWarnings(note, state, { keyHashes }) {
  const out = [];
  if (keyHashes.some((k) => (note.addKeyHashes ?? []).includes(k))) {
    out.push({
      code: "payout-to-adding-account",
      text: "This account added the share. Paying the withdrawal to it links your withdrawal to your liquidity on-chain.",
    });
  }
  const set = sharesInPool(state);
  if (set < SMALL_LENDER_SET) {
    out.push({
      code: "small-anonymity-set",
      text: `Only ${set} share${set === 1 ? " is" : "s are"} in the pool. Your withdrawal hides among these few; waiting for more lenders hides it better.`,
    });
  }
  return out;
}
