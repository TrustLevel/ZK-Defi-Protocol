/**
 * Reading protocol state from the chain (backend and CLI; the browser gets the
 * same data from the backend).
 *
 * `provider` is a Mesh fetcher (e.g. BlockfrostProvider); `bf(path)` returns the
 * parsed JSON of a Blockfrost REST path. Datums and redeemers are always decoded
 * from CBOR: Blockfrost's json_value renders 255-bit integers as floats.
 */
import { decodePoolDatum, decodePoolRedeemer } from "./plutus.mjs";
import { merkleRoot } from "./crypto.mjs";

// The live pool: the one UTxO at the pool address that carries the pool NFT.
export async function fetchPool(provider, S) {
  const utxos = await provider.fetchAddressUTxOs(S.POOL_ADDRESS);
  const pool = utxos.filter((u) => u.output.amount.some((a) => a.unit === S.POOL_NFT_UNIT && a.quantity === "1"));
  if (pool.length !== 1) throw new Error(`expected exactly one pool UTxO with the NFT, found ${pool.length}`);
  return { utxo: pool[0], datum: decodePoolDatum(pool[0].output.plutusData) };
}

async function allPages(bf, path) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await bf(`${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

// Every pool transaction in chain order (the pool NFT moves through all of them).
export async function poolHistory(bf, S) {
  const txs = await allPages(bf, `/assets/${S.POOL_NFT_UNIT}/transactions?order=asc`);
  return txs.sort((a, b) => a.block_height - b.block_height || a.tx_index - b.tx_index);
}

// Decoded pool redeemer of one transaction (null if it did not spend the pool).
export async function poolRedeemerOf(bf, S, txHash) {
  const reds = await bf(`/txs/${txHash}/redeemers`);
  const r = reds.find((x) => x.purpose === "spend" && x.script_hash === S.POOL_HASH);
  if (!r) return null;
  const { cbor } = await bf(`/scripts/datum/${r.redeemer_data_hash}/cbor`);
  return decodePoolRedeemer(cbor);
}

// Leaves of the three append-only trees, in insertion order: the commitments of
// all collateral deposits (group_root), the repayment nullifiers R of all repays
// (repaid_root) and the lender notes of all shares bought (lender_root).
export async function fetchLeaves(bf, S) {
  const commitments = [], repaid = [], lenders = [];
  for (const t of await poolHistory(bf, S)) {
    const r = await poolRedeemerOf(bf, S, t.tx_hash);
    if (r?.type === "DepositCollateral") commitments.push(r.commitment);
    if (r?.type === "RepayAnonymous") repaid.push(r.repayNullifier);
    if (r?.type === "AddLiquidity") lenders.push(r.commitment);
  }
  return { commitments, repaid, lenders };
}

// The leaves must rebuild the roots in the live pool datum, or the index is stale.
export function checkLeaves(datum, { commitments, repaid, lenders }) {
  if (BigInt(lenders.length) !== datum.lender_next_index || merkleRoot(lenders) !== datum.lender_root) {
    throw new Error("lender leaves do not match the pool's lender_root");
  }
  if (BigInt(commitments.length) !== datum.group_next_index || merkleRoot(commitments) !== datum.group_root) {
    throw new Error("commitment leaves do not match the pool's group_root");
  }
  if (BigInt(repaid.length) !== datum.next_index || merkleRoot(repaid) !== datum.repaid_root) {
    throw new Error("repaid leaves do not match the pool's repaid_root");
  }
}
