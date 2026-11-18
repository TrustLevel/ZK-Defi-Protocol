/**
 * Cached view of the protocol state: the live pool and the leaves of both trees.
 * Leaves are indexed incrementally from the pool NFT's history; a snapshot is
 * served only when the leaves rebuild the roots in the live pool datum, so the
 * web app never builds a proof against a stale tree.
 */
import { fetchPool, poolHistory, poolRedeemerOf, checkLeaves } from "@zk-defi/protocol/chain";

export class IndexLagError extends Error {
  constructor() {
    super("the index has not caught up with the pool yet");
  }
}

export function createChainService({ provider, bf, S, maxAgeMs = 10_000 }) {
  const seen = new Set();
  let leaves = { commitments: [], repaid: [] };
  let snapshot = null;
  let inflight = null;

  async function index() {
    for (const t of await poolHistory(bf, S)) {
      if (seen.has(t.tx_hash)) continue;
      const r = await poolRedeemerOf(bf, S, t.tx_hash);
      if (r?.type === "DepositCollateral") leaves.commitments.push(r.commitment);
      if (r?.type === "RepayAnonymous") leaves.repaid.push(r.repayNullifier);
      seen.add(t.tx_hash);
    }
  }

  async function refresh() {
    const pool = await fetchPool(provider, S);
    const ref = `${pool.utxo.input.txHash}#${pool.utxo.input.outputIndex}`;
    if (snapshot?.ref !== ref) await index();
    try {
      checkLeaves(pool.datum, leaves);
    } catch {
      // The pool moved further than the history Blockfrost has indexed.
      throw new IndexLagError();
    }
    // Deposits still locked at the collateral script (a note whose deposit is
    // gone from here, after its repayment, has been unlocked).
    const deposits = (await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS))
      .map((u) => `${u.input.txHash}#${u.input.outputIndex}`);
    snapshot = {
      ref, pool, deposits, at: Date.now(),
      leaves: { commitments: [...leaves.commitments], repaid: [...leaves.repaid] },
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
