// The relayer must refuse anything it would pay for in vain or for someone else.
// Real Groth16 proofs (borrow and settlement circuits), fake chain and runner.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import {
  computeCommitment, computeRepayNullifier, merkleRoot, borrowInput, settlementInput,
  COLLATERAL_DENOMINATION, LOAN_DENOMINATION, EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER,
} from "@zk-defi/protocol/crypto";
import { depositDatum } from "@zk-defi/protocol/plutus";
import { serializeData } from "@meshsdk/core";
import { createRelayer } from "../src/relayer.mjs";

const C = new URL("../../circuits/", import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const vkeys = {
  borrow: json(C + "keys/verification_key_semaphore.json"),
  settlement: json(C + "keys/verification_key_settlement.json"),
};
const B = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";
const B_PKH = "6257ca336c52ba8fdf1c6a55ffb644c7f4ecd5a10552a23969142ace";
const OTHER = "addr_test1qpcqxae4vhzraf58l2w4fchshumy273jgsv2vd6h42spz0trfsl4luq2c8swge9yx8d5ax9hcyxlf9zsks088qtpx3sqkaz05h";
const UNLOCK_TO = "addr_test1qq7takgp3ld6fyxewja802gvtmnpx592rvvhgqepfax7suqdtluq35cwlhl6592mvgv4j0us7uvv5mye50dykeg9nz5sufh3n0";

const secret = 987654321987654321n;
const commitment = computeCommitment(COLLATERAL_DENOMINATION, secret);
const R = computeRepayNullifier(secret);
const datum = {
  group_root: merkleRoot([commitment]), repaid_root: merkleRoot([R]), loan_denomination: LOAN_DENOMINATION,
  collateral_ratio: 125n, external_nullifier: EXTERNAL_NULLIFIER, repay_external_nullifier: REPAY_EXTERNAL_NULLIFIER,
  used_nullifiers: [], open_loans: [],
};
const chainWith = (d) => ({ state: async () => ({ pool: { utxo: { input: { txHash: "00", outputIndex: 0 } }, datum: d } }) });
const deposit = {
  input: { txHash: "ab".repeat(32), outputIndex: 1 },
  output: { plutusData: serializeData(depositDatum(commitment, 1, UNLOCK_TO), "JSON") },
};
function runner() {
  const calls = [];
  return {
    calls,
    borrow: async (a) => { calls.push(["borrow", a]); return { txHash: "b0" }; },
    unlock: async (a) => { calls.push(["unlock", a]); return { txHash: "u0" }; },
    findDeposit: async (ref) => (ref.txHash === deposit.input.txHash ? deposit : null),
  };
}

// snarkjs keeps its curve's worker threads alive globally; end them after the run.
after(async () => { await globalThis.curve_bls12381?.terminate(); });

const prove = (kind, input) => snarkjs.groth16.fullProve(input,
  `${C}${kind}_js/${kind}.wasm`, `${C}keys/${kind}_final.zkey`);
const borrowProof = await prove("collateral_semaphore",
  borrowInput({ commitments: [commitment], index: 0, secret, ratio: 125n, recipientPkh: B_PKH }).input);
const settleProof = await prove("settlement_proof",
  settlementInput({ commitment, secret, repaid: [R], index: 0 }).input);

test("borrow: a valid proof is relayed to the bound recipient", async () => {
  const r = runner();
  const out = await createRelayer({ chain: chainWith(datum), runner: r, vkeys }).borrow({ ...borrowProof, recipient: B });
  assert.deepEqual(out, { txHash: "b0" });
  assert.equal(r.calls[0][1].recipient, B);
  assert.equal(r.calls[0][1].recipientPkh, B_PKH);
});

test("borrow: refuses a recipient the proof is not bound to", async () => {
  const r = runner();
  await assert.rejects(createRelayer({ chain: chainWith(datum), runner: r, vkeys }).borrow({ ...borrowProof, recipient: OTHER }),
    { statusCode: 400, message: /different recipient/ });
  assert.equal(r.calls.length, 0);
});

test("borrow: refuses a tampered public signal", async () => {
  const signals = [...borrowProof.publicSignals];
  signals[1] = (BigInt(signals[1]) + 1n).toString();
  await assert.rejects(createRelayer({ chain: chainWith(datum), runner: runner(), vkeys }).borrow({ proof: borrowProof.proof, publicSignals: signals, recipient: B }),
    { statusCode: 400, message: /does not verify/ });
});

test("borrow: refuses a used nullifier and a stale root", async () => {
  const N = BigInt(borrowProof.publicSignals[1]);
  await assert.rejects(createRelayer({ chain: chainWith({ ...datum, used_nullifiers: [N] }), runner: runner(), vkeys }).borrow({ ...borrowProof, recipient: B }),
    { statusCode: 409, code: "used" });
  await assert.rejects(createRelayer({ chain: chainWith({ ...datum, group_root: 1n }), runner: runner(), vkeys }).borrow({ ...borrowProof, recipient: B }),
    { statusCode: 409, code: "stale" });
});

test("borrow: refuses malformed input before any work", async () => {
  const relayer = createRelayer({ chain: chainWith(datum), runner: runner(), vkeys });
  await assert.rejects(relayer.borrow({}), { statusCode: 400 });
  await assert.rejects(relayer.borrow({ ...borrowProof, publicSignals: ["1", "2"], recipient: B }), { statusCode: 400 });
  await assert.rejects(relayer.borrow({ ...borrowProof, recipient: "addr_test1wzz9c7tu2x4j0rx4l9xzgcw74s7y5exts2stfwpqfpxamksgfmdd4" }), { statusCode: 400 });
});

test("unlock: pays the deposit's own unlock_to", async () => {
  const r = runner();
  const out = await createRelayer({ chain: chainWith(datum), runner: r, vkeys }).unlock({ ...settleProof, deposit: deposit.input });
  assert.deepEqual(out, { txHash: "u0" });
  assert.equal(r.calls[0][1].unlockTo, UNLOCK_TO);
});

test("unlock: refuses a proof for another deposit, an unknown deposit and a stale root", async () => {
  const signals = [...settleProof.publicSignals];
  signals[0] = "123";
  const relayer = createRelayer({ chain: chainWith(datum), runner: runner(), vkeys });
  await assert.rejects(relayer.unlock({ proof: settleProof.proof, publicSignals: signals, deposit: deposit.input }), { statusCode: 400, message: /different deposit/ });
  await assert.rejects(relayer.unlock({ ...settleProof, deposit: { txHash: "cd".repeat(32), outputIndex: 1 } }), { statusCode: 404 });
  await assert.rejects(createRelayer({ chain: chainWith({ ...datum, repaid_root: 1n }), runner: runner(), vkeys }).unlock({ ...settleProof, deposit: deposit.input }),
    { statusCode: 409, code: "stale" });
});
