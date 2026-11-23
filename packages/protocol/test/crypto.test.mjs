// Golden vectors come from outside this code. The nullifiers and Merkle roots
// come from the M4 Preprod cycle of 2026-11-18 (borrow bb0fceda…, repay
// a8ef9234…; valid_contract); their formulas are unchanged. The deposit was
// unlocked, so its secret protects nothing any more. Point compression is checked
// against the verification key in contracts/lib/semaphore_onchain_test.ak, which
// circuits/tests/gen-semaphore-fixture.cjs compresses independently and which
// `aiken check` verifies real proofs against.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ff from "ffjavascript";
import { poseidon2 } from "poseidon-bls12381";
import {
  computeCommitment, computeNullifier, computeRepayNullifier, merkleRoot, merkleProof,
  compressG1, compressG2, borrowInput, repayInput, settlementInput, appendInput,
  COLLATERAL_LEAF_TAG,
} from "../src/crypto.mjs";

const CYCLE = {
  secret: 13870267942183676492312615507696928199n,
  // the M4 leaf of that deposit; a Merkle leaf like any other for the root checks
  m4Commitment: 10978282538983229628495224588994691742899738550716023625693331685301442222972n,
  nullifier: 10889021580902365168954113585727180974899057144769597679232571432253724205969n,
  R: 31253465425210704682461986389129557566872817546220022574880210126016886455787n,
  // pool datum after the deposit (group_root) and after the repay (repaid_root)
  groupRoot: 19047856541863585390667863430475848261973742472649485296816656315636583799163n,
  repaidRoot: 19003531845030765355256782605640243812016445255213397563189406983080561676172n,
  recipientPkh: "6257ca336c52ba8fdf1c6a55ffb644c7f4ecd5a10552a23969142ace",
};
// The borrow verification key as the Aiken fixture holds it (vkey() in
// contracts/lib/semaphore_onchain_test.ak).
async function fixtureBorrowVkey() {
  const ak = await (await import("node:fs/promises")).readFile(
    new URL("../../../contracts/lib/semaphore_onchain_test.ak", import.meta.url), "utf8");
  const body = ak.slice(ak.indexOf("pub fn vkey()"), ak.indexOf("pub fn proof()"));
  const field = (name) => body.match(new RegExp(`${name}: #"([0-9a-f]+)"`))[1];
  return { alpha: field("vkAlpha"), beta: field("vkBeta"), ic0: body.match(/vkIC: \[\s*#"([0-9a-f]+)"/)[1] };
}

test("loan nullifier and repay nullifier match the on-chain cycle", () => {
  assert.equal(computeNullifier(CYCLE.secret), CYCLE.nullifier);
  assert.equal(computeRepayNullifier(CYCLE.secret), CYCLE.R);
});

test("the collateral leaf is Poseidon255(COLLATERAL_LEAF_TAG, secret), whatever the asset", () => {
  assert.equal(COLLATERAL_LEAF_TAG, 5555n);
  assert.equal(computeCommitment(CYCLE.secret), poseidon2([5555n, CYCLE.secret]));
  assert.notEqual(computeCommitment(CYCLE.secret), CYCLE.m4Commitment);
});

test("Merkle roots match the pool datum", () => {
  assert.equal(merkleRoot([CYCLE.m4Commitment]), CYCLE.groupRoot);
  assert.equal(merkleRoot([CYCLE.R]), CYCLE.repaidRoot);
});

test("a Merkle path recomputes its root", () => {
  const leaves = [11n, 22n, CYCLE.m4Commitment, 44n];
  const { root, siblings, pathIndices } = merkleProof(leaves, 2);
  assert.equal(root, merkleRoot(leaves));
  assert.equal(siblings.length, 10);
  assert.deepEqual(pathIndices.slice(0, 2), [0, 1]);
});

test("point compression matches the verification key the Aiken fixture verifies proofs with", async () => {
  const expected = await fixtureBorrowVkey();
  const vkey = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../../../circuits/keys/verification_key_semaphore.json", import.meta.url), "utf8"));
  const curve = await ff.getCurveFromName("bls12381");
  try {
    assert.equal(compressG1(curve, vkey.vk_alpha_1), expected.alpha);
    assert.equal(compressG2(curve, vkey.vk_beta_2), expected.beta);
    assert.equal(compressG1(curve, vkey.IC[0]), expected.ic0);
  } finally {
    await curve.terminate();
  }
});

test("proof inputs carry the public signals the validators check", () => {
  const commitments = [CYCLE.m4Commitment];
  const b = borrowInput({ commitments, index: 0, secret: CYCLE.secret, recipientPkh: CYCLE.recipientPkh });
  assert.equal(b.input.group_merkle_root, CYCLE.groupRoot.toString());
  assert.equal(b.input.loan_nullifier, CYCLE.nullifier.toString());
  assert.equal(b.input.recipient, BigInt("0x" + CYCLE.recipientPkh).toString());

  assert.equal(b.input.loan_amount, undefined);
  assert.equal(b.input.collateral_ratio, undefined);

  const r = repayInput({ commitments, index: 0, secret: CYCLE.secret });
  assert.equal(r.input.repay_nullifier, CYCLE.R.toString());
  assert.equal(r.R, CYCLE.R);

  const a = appendInput({ leavesBefore: [], leaf: CYCLE.R });
  assert.equal(a.input.new_root, CYCLE.repaidRoot.toString());
  assert.equal(a.index, 0);

  const s = settlementInput({ commitment: computeCommitment(CYCLE.secret), secret: CYCLE.secret, repaid: [CYCLE.R], index: 0 });
  assert.equal(s.input.repaid_root, CYCLE.repaidRoot.toString());
});
