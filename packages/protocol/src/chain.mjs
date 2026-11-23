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
// (repaid_root) and the lender notes of all shares bought (lender_root). Plus the
// nullifier events, in order, from which mpf.buildSets rebuilds the loans and
// withdrawn sets.
export async function fetchLeaves(bf, S) {
  const commitments = [], repaid = [], lenders = [], events = [];
  for (const t of await poolHistory(bf, S)) {
    const r = await poolRedeemerOf(bf, S, t.tx_hash);
    if (r?.type === "DepositCollateral") commitments.push(r.commitment);
    if (r?.type === "RepayAnonymous") {
      repaid.push(r.repayNullifier);
      events.push({ type: "repay", nullifier: r.loanNullifier });
    }
    if (r?.type === "AddLiquidity") lenders.push(r.commitment);
    if (r?.type === "BorrowAnonymous") events.push({ type: "borrow", nullifier: r.loanNullifier });
    if (r?.type === "WithdrawLiquidity") events.push({ type: "withdraw", nullifier: r.withdrawNullifier });
  }
  return { commitments, repaid, lenders, events };
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

// The pool's state must be one an honest initialization leads to:
//  - the init transaction put the NFT into an output at the pool address with the
//    canonical empty datum (no shares, loans or roots set by the deployer);
//  - the parked verification keys are the ones in circuits/keys (expectedVkeys:
//    { borrow, settlement, append, repay, lender } as datum CBOR hex);
//  - the live datum's totals match the sets: total_borrowed is one denomination
//    per open loan, total_shares the notes added minus the notes withdrawn.
// `sets` is mpf.buildSets(leaves.events). Throws on the first mismatch.
export async function verifyPool(bf, S, deployment, { pool, leaves, sets, expectedVkeys, emptyRoot }) {
  const fail = (msg) => { throw new Error(`pool verification: ${msg}`); };
  const init = await bf(`/txs/${deployment.initTx}/utxos`);
  const out = init.outputs.find((o) => o.address === S.POOL_ADDRESS
    && o.amount.some((a) => a.unit === S.POOL_NFT_UNIT && a.quantity === "1"));
  if (!out?.inline_datum) fail("the init transaction did not put the NFT into the pool address");
  const d0 = decodePoolDatum(out.inline_datum);
  const empty = merkleRoot([]);
  const canonical = d0.total_deposited === 0n && d0.total_borrowed === 0n
    && d0.group_root === empty && d0.group_next_index === 0n
    && d0.repaid_root === empty && d0.next_index === 0n
    && d0.lender_root === empty && d0.lender_next_index === 0n && d0.total_shares === 0n
    && d0.loans === emptyRoot && d0.withdrawn === emptyRoot;
  if (!canonical) fail("the initial pool datum is not the empty state");
  const refs = {
    borrow: [deployment.vkeys.txHash, deployment.vkeys.borrowIdx],
    settlement: [deployment.vkeys.txHash, deployment.vkeys.settlementIdx],
    append: [deployment.vkeys.txHash, deployment.vkeys.appendIdx],
    repay: [deployment.vkeys.txHash, deployment.vkeys.repayIdx],
    lender: [deployment.vkeys.lender.txHash, deployment.vkeys.lender.index],
  };
  for (const [name, [txHash, index]] of Object.entries(refs)) {
    const o = (await bf(`/txs/${txHash}/utxos`)).outputs.find((x) => x.output_index === index);
    if (!o || o.inline_datum !== expectedVkeys[name]) fail(`the parked ${name} key is not circuits/keys`);
  }
  checkLeaves(pool.datum, leaves);
  const d = pool.datum;
  if (d.loans !== sets.loansRoot || d.withdrawn !== sets.withdrawnRoot) fail("the nullifier sets do not match the history");
  if (d.total_borrowed !== BigInt(sets.openLoans.length) * d.loan_denomination) fail("total_borrowed does not match the open loans");
  if (d.total_shares !== d.lender_next_index - BigInt(sets.withdrawnNotes.length)) fail("total_shares does not match the notes");
}
