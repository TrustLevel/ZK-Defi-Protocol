// Golden vectors come from the chain, not from this code: the M4 Preprod cycle of
// 2026-11-18 (deposit 83379998…, borrow bb0fceda…, repay a8ef9234…; all
// valid_contract) and the parked borrow verification key (edbfae0e…#0). The
// deposit was unlocked, so its secret protects nothing any more.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ff from "ffjavascript";
import {
  computeCommitment, computeNullifier, computeRepayNullifier, merkleRoot, merkleProof,
  compressG1, compressG2, borrowInput, repayInput, settlementInput, appendInput,
  COLLATERAL_DENOMINATION, LOAN_DENOMINATION,
} from "../src/crypto.mjs";

const CYCLE = {
  secret: 13870267942183676492312615507696928199n,
  commitment: 10978282538983229628495224588994691742899738550716023625693331685301442222972n,
  nullifier: 10889021580902365168954113585727180974899057144769597679232571432253724205969n,
  R: 31253465425210704682461986389129557566872817546220022574880210126016886455787n,
  // pool datum after the deposit (group_root) and after the repay (repaid_root)
  groupRoot: 19047856541863585390667863430475848261973742472649485296816656315636583799163n,
  repaidRoot: 19003531845030765355256782605640243812016445255213397563189406983080561676172n,
  recipientPkh: "6257ca336c52ba8fdf1c6a55ffb644c7f4ecd5a10552a23969142ace",
};
// Compressed points as parked on-chain in the borrow vkey datum.
const PARKED_BORROW_VKEY = {
  alpha: "a60114bdb346edf1e6d2286e7bb2982ded2332ed5326b3f5dab7327531d193f5ab9a5ab5ef22c63826524d195fe41838",
  beta: "9174da54ce33a9e63f2d8a885e2e6201562f0a876dbed7b3fde9727793d45c1f6d4f63cfc5fec371977dd287fab632540113d8dc95b5f9e3685753b756eafac407a97f47ddf9eb0dbdbcb83f68752fc645c9a5ca22b0c07e6c509582ecfbbb1f",
  ic0: "b1a592eed55709319d7c2eb248317a978f1abc8b58c32f4de63b6812a9f7f8432a90d2932f92ed26af3a6174b9a7cbf1",
};

test("commitment, loan nullifier and repay nullifier match the on-chain cycle", () => {
  assert.equal(computeCommitment(COLLATERAL_DENOMINATION, CYCLE.secret), CYCLE.commitment);
  assert.equal(computeNullifier(CYCLE.secret), CYCLE.nullifier);
  assert.equal(computeRepayNullifier(CYCLE.secret), CYCLE.R);
});

test("Merkle roots match the pool datum", () => {
  assert.equal(merkleRoot([CYCLE.commitment]), CYCLE.groupRoot);
  assert.equal(merkleRoot([CYCLE.R]), CYCLE.repaidRoot);
});

test("a Merkle path recomputes its root", () => {
  const leaves = [11n, 22n, CYCLE.commitment, 44n];
  const { root, siblings, pathIndices } = merkleProof(leaves, 2);
  assert.equal(root, merkleRoot(leaves));
  assert.equal(siblings.length, 10);
  assert.deepEqual(pathIndices.slice(0, 2), [0, 1]);
});

test("point compression matches the parked verification key", async () => {
  const vkey = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../../../circuits/keys/verification_key_semaphore.json", import.meta.url), "utf8"));
  const curve = await ff.getCurveFromName("bls12381");
  try {
    assert.equal(compressG1(curve, vkey.vk_alpha_1), PARKED_BORROW_VKEY.alpha);
    assert.equal(compressG2(curve, vkey.vk_beta_2), PARKED_BORROW_VKEY.beta);
    assert.equal(compressG1(curve, vkey.IC[0]), PARKED_BORROW_VKEY.ic0);
  } finally {
    await curve.terminate();
  }
});

test("proof inputs carry the public signals the validators check", () => {
  const commitments = [CYCLE.commitment];
  const b = borrowInput({
    commitments, index: 0, secret: CYCLE.secret, loanAmount: LOAN_DENOMINATION, ratio: 125n,
    recipientPkh: CYCLE.recipientPkh,
  });
  assert.equal(b.input.group_merkle_root, CYCLE.groupRoot.toString());
  assert.equal(b.input.loan_nullifier, CYCLE.nullifier.toString());
  assert.equal(b.input.recipient, BigInt("0x" + CYCLE.recipientPkh).toString());

  const r = repayInput({ commitments, index: 0, secret: CYCLE.secret, loanAmount: LOAN_DENOMINATION, ratio: 125n });
  assert.equal(r.input.repay_nullifier, CYCLE.R.toString());
  assert.equal(r.R, CYCLE.R);

  const a = appendInput({ leavesBefore: [], leaf: CYCLE.R });
  assert.equal(a.input.new_root, CYCLE.repaidRoot.toString());
  assert.equal(a.index, 0);

  const s = settlementInput({ commitment: CYCLE.commitment, secret: CYCLE.secret, repaid: [CYCLE.R], index: 0 });
  assert.equal(s.input.repaid_root, CYCLE.repaidRoot.toString());
});
