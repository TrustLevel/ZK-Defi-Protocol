// Borrow, repay and settlement circuits: real Groth16 proofs over the compiled
// circuits and their keys. Valid proofs verify and expose exactly the documented
// public signals (no amount, no ratio, no asset); a changed public signal, a wrong
// secret, a leaf outside the tree or a wrong scope do not.
// Run from circuits/:  node --test tests/collateral-circuits.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import { poseidon2 } from "poseidon-bls12381";
import {
  computeCommitment, computeNullifier, computeRepayNullifier, computeLenderCommitment,
  borrowInput, repayInput, settlementInput, merkleRoot,
  COLLATERAL_LEAF_TAG, EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER,
} from "../../packages/protocol/src/crypto.mjs";

const C = new URL("../", import.meta.url).pathname;
const circuit = (wasm, zkey, vk) => ({
  wasm: C + wasm, zkey: C + "keys/" + zkey,
  vkey: JSON.parse(readFileSync(C + "keys/" + vk, "utf8")),
});
const BORROW = circuit("collateral_semaphore_js/collateral_semaphore.wasm", "collateral_semaphore_final.zkey", "verification_key_semaphore.json");
const REPAY = circuit("repay_proof_js/repay_proof.wasm", "repay_proof_final.zkey", "verification_key_repay.json");
const SETTLE = circuit("settlement_proof_js/settlement_proof.wasm", "settlement_proof_final.zkey", "verification_key_settlement.json");

const B_PKH = "6257ca336c52ba8fdf1c6a55ffb644c7f4ecd5a10552a23969142ace";
const secret = 123456789123456789123456789n;
// Deposits of different collateral assets share one set; their leaves look alike.
const commitments = [111n, secret, 222n, 333n].map((s) => computeCommitment(s));
const R = computeRepayNullifier(secret);
const repaid = [computeRepayNullifier(444n), R];

const prove = (c, input) => snarkjs.groth16.fullProve(input, c.wasm, c.zkey);
const verify = (c, signals, proof) => snarkjs.groth16.verify(c.vkey, signals, proof);

after(async () => { await globalThis.curve_bls12381?.terminate(); });

async function assertTamperedSignalsFail(c, input) {
  const { proof, publicSignals } = await prove(c, input);
  for (let i = 0; i < publicSignals.length; i++) {
    const tampered = [...publicSignals];
    tampered[i] = (BigInt(tampered[i]) + 1n).toString();
    assert.equal(await verify(c, tampered, proof), false, `signal ${i}`);
  }
}

test("the collateral leaf is tagged and differs from a lender note of the same secret", () => {
  assert.equal(computeCommitment(secret), poseidon2([COLLATERAL_LEAF_TAG, secret]));
  assert.notEqual(computeCommitment(secret), computeLenderCommitment(secret));
});

test("verification keys expose 4 (borrow), 5 (repay) and 3 (settlement) public signals", () => {
  assert.equal(BORROW.vkey.nPublic, 4);
  assert.equal(REPAY.vkey.nPublic, 5);
  assert.equal(SETTLE.vkey.nPublic, 3);
});

// ── borrow ───────────────────────────────────────────────────────────────────
test("borrow verifies and exposes [group_root, loan_nullifier, scope, recipient]", async () => {
  const { root, nullifier, input } = borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH });
  assert.equal(root, merkleRoot(commitments));
  const { proof, publicSignals } = await prove(BORROW, input);
  assert.deepEqual(publicSignals, [
    root.toString(), nullifier.toString(), EXTERNAL_NULLIFIER.toString(), BigInt("0x" + B_PKH).toString(),
  ]);
  assert.equal(await verify(BORROW, publicSignals, proof), true);
});

test("borrow: a changed public signal fails verification", async () => {
  await assertTamperedSignalsFail(BORROW, borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH }).input);
});

test("borrow: a wrong secret cannot produce a witness", async () => {
  const { input } = borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove(BORROW, { ...input, secret: (secret + 1n).toString() }));
});

test("borrow: a deposit outside the set cannot produce a witness", async () => {
  const outsider = 999n;
  const { input } = borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove(BORROW, {
    ...input, secret: outsider.toString(), loan_nullifier: computeNullifier(outsider).toString(),
  }));
});

test("borrow: a nullifier from another scope cannot produce a witness", async () => {
  const { input } = borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove(BORROW, { ...input, external_nullifier: REPAY_EXTERNAL_NULLIFIER.toString() }));
});

// ── repay ────────────────────────────────────────────────────────────────────
test("repay verifies and exposes [group_root, N, R, scope, repay scope]", async () => {
  const { root, nullifier, R: r, input } = repayInput({ commitments, index: 1, secret });
  assert.equal(r, R);
  const { proof, publicSignals } = await prove(REPAY, input);
  assert.deepEqual(publicSignals, [
    root.toString(), nullifier.toString(), R.toString(),
    EXTERNAL_NULLIFIER.toString(), REPAY_EXTERNAL_NULLIFIER.toString(),
  ]);
  assert.equal(await verify(REPAY, publicSignals, proof), true);
});

test("repay: a changed public signal fails verification", async () => {
  await assertTamperedSignalsFail(REPAY, repayInput({ commitments, index: 1, secret }).input);
});

test("repay: an R from another secret cannot produce a witness", async () => {
  const { input } = repayInput({ commitments, index: 1, secret });
  await assert.rejects(prove(REPAY, { ...input, repay_nullifier: computeRepayNullifier(111n).toString() }));
});

test("repay: a borrow proof does not verify as a repay proof", async () => {
  const { proof, publicSignals } = await prove(BORROW, borrowInput({ commitments, index: 1, secret, recipientPkh: B_PKH }).input);
  const asRepay = [publicSignals[0], publicSignals[1], R.toString(), publicSignals[2], REPAY_EXTERNAL_NULLIFIER.toString()];
  assert.equal(await verify(REPAY, asRepay, proof), false);
});

// ── settlement ───────────────────────────────────────────────────────────────
test("settlement verifies and exposes [commitment, repaid_root, repay scope]", async () => {
  const commitment = computeCommitment(secret);
  const { root, input } = settlementInput({ commitment, secret, repaid, index: 1 });
  const { proof, publicSignals } = await prove(SETTLE, input);
  assert.deepEqual(publicSignals, [commitment.toString(), root.toString(), REPAY_EXTERNAL_NULLIFIER.toString()]);
  assert.equal(await verify(SETTLE, publicSignals, proof), true);
});

test("settlement: a changed public signal fails verification", async () => {
  await assertTamperedSignalsFail(SETTLE, settlementInput({ commitment: computeCommitment(secret), secret, repaid, index: 1 }).input);
});

test("settlement: unlock without repayment (R not in repaid_root) cannot produce a witness", async () => {
  const { input } = settlementInput({ commitment: computeCommitment(secret), secret, repaid: [repaid[0]], index: 0 });
  await assert.rejects(prove(SETTLE, input));
});

test("settlement: another deposit's commitment cannot produce a witness", async () => {
  const { input } = settlementInput({ commitment: computeCommitment(111n), secret, repaid, index: 1 });
  await assert.rejects(prove(SETTLE, input));
});
