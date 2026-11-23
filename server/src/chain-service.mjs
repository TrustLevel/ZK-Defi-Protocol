/**
 * Cached view of the protocol state: the live pool and the leaves of its three
 * trees (collateral commitments, repayment nullifiers, lender notes).
 * Leaves are indexed incrementally from the pool NFT's history; a snapshot is
 * served only when the leaves rebuild the roots in the live pool datum, so the
 * web app never builds a proof against a stale tree.
 */
import { fetchPool, poolHistory, poolRedeemerOf, checkLeaves } from "@zk-defi/protocol/chain";
import { buildSets } from "@zk-defi/protocol/mpf";

export class IndexLagError extends Error {
  constructor() {
    super("the index has not caught up with the pool yet");
  }
}

// What each protocol transaction shows publicly, for the activity feed.
function activityOf(t, r) {
  const base = { txHash: t.tx_hash, time: t.block_time };
  switch (r?.type) {
    case "DepositCollateral": return { ...base, type: "deposit", commitment: r.commitment };
    case "BorrowAnonymous": return { ...base, type: "borrow", nullifier: r.loanNullifier };
    case "RepayAnonymous": return { ...base, type: "repay", nullifier: r.loanNullifier, marker: r.repayNullifier };
    case "AddLiquidity": return { ...base, type: "liquidity", commitment: r.commitment };
    case "WithdrawLiquidity": return { ...base, type: "withdraw", nullifier: r.withdrawNullifier };
    default: return null;
  }
}

export function createChainService({ provider, bf, S, maxAgeMs = 10_000, feedSize = 30 }) {
  const seen = new Set(); // pool transactions (they define the leaves)
  const seenAtCollateral = new Set(); // transactions at the collateral address
  let leaves = { commitments: [], repaid: [], lenders: [], events: [] };
  let activity = [];
  let snapshot = null;
  let inflight = null;

  async function index() {
    for (const t of await poolHistory(bf, S)) {
      if (seen.has(t.tx_hash)) continue;
      const r = await poolRedeemerOf(bf, S, t.tx_hash);
      if (r?.type === "DepositCollateral") leaves.commitments.push(r.commitment);
      if (r?.type === "RepayAnonymous") {
        leaves.repaid.push(r.repayNullifier);
        leaves.events.push({ type: "repay", nullifier: r.loanNullifier });
      }
      if (r?.type === "AddLiquidity") leaves.lenders.push(r.commitment);
      if (r?.type === "BorrowAnonymous") leaves.events.push({ type: "borrow", nullifier: r.loanNullifier });
      if (r?.type === "WithdrawLiquidity") leaves.events.push({ type: "withdraw", nullifier: r.withdrawNullifier });
      const a = activityOf(t, r);
      if (a) activity.push(a);
      seen.add(t.tx_hash);
    }
    // Unlocks spend a deposit and only read the pool, so they show up at the
    // collateral address, not in the pool NFT's history.
    // A transaction there is an unlock if it spends a deposit (deposits only add
    // one). Kept apart from the pool's set, so the leaves never depend on it.
    for (const t of await bf(`/addresses/${S.COLLATERAL_ADDRESS}/transactions?order=desc&count=50`)) {
      if (seenAtCollateral.has(t.tx_hash)) continue;
      const { inputs } = await bf(`/txs/${t.tx_hash}/utxos`);
      if (inputs.some((i) => i.address === S.COLLATERAL_ADDRESS && !i.reference)) {
        activity.push({ txHash: t.tx_hash, time: t.block_time, type: "unlock" });
      }
      seenAtCollateral.add(t.tx_hash);
    }
    activity = activity.sort((a, b) => b.time - a.time).slice(0, feedSize);
  }

  async function refresh() {
    const pool = await fetchPool(provider, S).catch((e) => {
      // While a transaction spends the pool, Blockfrost can briefly list none.
      throw /found 0$/.test(e.message) ? new IndexLagError() : e;
    });
    const ref = `${pool.utxo.input.txHash}#${pool.utxo.input.outputIndex}`;
    // Deposits still locked at the collateral script (a note whose deposit is
    // gone from here, after its repayment, has been unlocked).
    const deposits = (await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS))
      .map((u) => `${u.input.txHash}#${u.input.outputIndex}`);
    // An unlock leaves the pool where it is, so a changed deposit set also
    // means new activity.
    if (snapshot?.ref !== ref || snapshot.deposits.join() !== deposits.join()) await index();
    const sets = await buildSets(leaves.events);
    try {
      checkLeaves(pool.datum, leaves);
      if (pool.datum.loans !== sets.loansRoot || pool.datum.withdrawn !== sets.withdrawnRoot) throw new Error();
    } catch {
      // The pool moved further than the history Blockfrost has indexed.
      throw new IndexLagError();
    }
    snapshot = {
      ref, pool, deposits, activity: [...activity], at: Date.now(), sets,
      leaves: {
        commitments: [...leaves.commitments], repaid: [...leaves.repaid], lenders: [...leaves.lenders],
        events: [...leaves.events],
      },
    };
    return snapshot;
  }

  return {
    // Latest consistent snapshot, at most maxAgeMs old (one refresh at a time).
    async state({ fresh = false } = {}) {
      if (!fresh && snapshot && Date.now() - snapshot.at < maxAgeMs) return snapshot;
      inflight ??= refresh().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
