// Client for the M4 backend. Everything it sends or receives is public chain
// data or a proof; notes and secrets never leave the browser.

const INT_LISTS = ["open_loans", "used_nullifiers"];

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, path, body) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    // 503: the backend's index is catching up with the chain; ask again shortly.
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.error, json.message || `${path} failed (${res.status})`);
    return json;
  }
  throw new ApiError(503, "indexing", "The backend is still catching up with the chain.");
}

// Pool and both trees with integers as BigInt.
export async function getState() {
  const s = await call("GET", "/api/state");
  const datum = Object.fromEntries(
    Object.entries(s.pool.datum).map(([k, v]) => [k, INT_LISTS.includes(k) ? v.map(BigInt) : BigInt(v)]),
  );
  return {
    deployment: s.deployment,
    pool: { utxo: s.pool.utxo, datum },
    leaves: { commitments: s.leaves.commitments.map(BigInt), repaid: s.leaves.repaid.map(BigInt) },
    indexedAt: s.indexedAt,
  };
}

// What Mesh's transaction builder asks the chain for, answered by the backend.
export const fetcher = {
  fetchUTxOs: (txHash) => call("GET", `/api/utxos/${txHash}`),
  fetchCostModels: () => call("GET", "/api/cost-models"),
};
export const evaluator = {
  evaluateTx: async (tx) =>
    (await call("POST", "/api/evaluate", { tx })).redeemers.map((r) => ({
      ...r, budget: { mem: Number(r.budget.mem), steps: Number(r.budget.steps) },
    })),
};

export const submitTx = async (tx) => (await call("POST", "/api/submit", { tx })).txHash;
export const relayBorrow = (proof, publicSignals, recipient) =>
  call("POST", "/api/relay/borrow", { proof, publicSignals, recipient });
export const relayUnlock = (proof, publicSignals, deposit) =>
  call("POST", "/api/relay/unlock", { proof, publicSignals, deposit });
