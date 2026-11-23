/**
 * Protocol cryptography, shared by the CLI (Node) and the web app (browser).
 * No Node built-ins: values are BigInt, bytes are lowercase hex strings.
 *
 * Leaves and nullifiers (Poseidon255 over BLS12-381, matching the circuits):
 *   commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)  -> group_root leaf
 *   N          = Poseidon255(secret, external_nullifier)   -> loan nullifier
 *   R          = Poseidon255(secret, repay_external_nullifier) -> repaid_root leaf
 * Lender notes (one note = one pool share):
 *   L          = Poseidon255(LENDER_LEAF_TAG, secret)        -> lender_root leaf
 *   W          = Poseidon255(secret, lender_external_nullifier) -> withdraw nullifier
 * All trees have depth DEPTH, unused leaves are 0.
 *
 * The *Input builders return the exact witness objects the circuits take, so
 * a prover (snarkjs in Node, or in a browser Web Worker) only runs fullProve.
 */
import { poseidon2 } from "poseidon-bls12381";

// Tree depth of every circuit (CollateralSemaphore(10) etc.).
export const DEPTH = 10;
// Protocol scalars; must match the pool datum.
export const EXTERNAL_NULLIFIER = 7777n;
export const REPAY_EXTERNAL_NULLIFIER = 8888n;
export const LENDER_EXTERNAL_NULLIFIER = 9999n;
// Fixed first input of a leaf hash; must match the circuits. The collateral tag
// is the same for every accepted collateral asset, so a leaf reveals no asset.
export const COLLATERAL_LEAF_TAG = 5555n; // collateral_semaphore, repay_proof, settlement_proof
export const LENDER_LEAF_TAG = 6666n; // lender_withdraw
// Fixed denominations (lovelace): every loan and every collateral deposit has this size.
export const LOAN_DENOMINATION = 10_000_000n;
export const COLLATERAL_DENOMINATION = 20_000_000n;
// Asset name of the one-shot pool NFT ("POOL"), hex.
export const POOL_NFT_NAME_HEX = "504f4f4c";

// ── leaves and nullifiers ────────────────────────────────────────────────────
export function computeCommitment(secret) {
  return poseidon2([COLLATERAL_LEAF_TAG, BigInt(secret)]);
}
export function computeNullifier(secret, externalNullifier = EXTERNAL_NULLIFIER) {
  return poseidon2([BigInt(secret), BigInt(externalNullifier)]);
}
export function computeRepayNullifier(secret, repayExternalNullifier = REPAY_EXTERNAL_NULLIFIER) {
  return poseidon2([BigInt(secret), BigInt(repayExternalNullifier)]);
}
export function computeLenderCommitment(secret) {
  return poseidon2([LENDER_LEAF_TAG, BigInt(secret)]);
}
export function computeLenderNullifier(secret, lenderExternalNullifier = LENDER_EXTERNAL_NULLIFIER) {
  return poseidon2([BigInt(secret), BigInt(lenderExternalNullifier)]);
}

// ── Merkle tree ──────────────────────────────────────────────────────────────
function leafLevel(leaves) {
  if (leaves.length > 1 << DEPTH) throw new Error(`tree full: ${leaves.length} leaves > ${1 << DEPTH}`);
  const level = new Array(1 << DEPTH).fill(0n);
  leaves.forEach((c, i) => { level[i] = BigInt(c); });
  return level;
}
function nextLevel(level) {
  const next = new Array(level.length >> 1);
  for (let i = 0; i < next.length; i++) next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
  return next;
}
export function merkleRoot(leaves) {
  let level = leafLevel(leaves);
  for (let d = 0; d < DEPTH; d++) level = nextLevel(level);
  return level[0];
}
// Membership path for the leaf at `index` (index may be the next free slot).
export function merkleProof(leaves, index) {
  let level = leafLevel(leaves);
  const siblings = [], pathIndices = [];
  let idx = index;
  for (let d = 0; d < DEPTH; d++) {
    siblings.push(level[idx ^ 1]);
    pathIndices.push(idx & 1);
    level = nextLevel(level);
    idx >>= 1;
  }
  return { root: level[0], siblings, pathIndices };
}

// ── BLS12-381 point compression (Zcash format, as the on-chain verifier reads it) ──
const COMPRESSED = 0x80, INFINITY = 0x40, YBIT = 0x20;
function toHexBE(v, width) {
  const hex = BigInt(v).toString(16);
  if (hex.length > width * 2) throw new Error(`value too large for ${width} bytes`);
  return hex.padStart(width * 2, "0");
}
function withFlags(hex, flags) {
  const first = (parseInt(hex.slice(0, 2), 16) | flags).toString(16).padStart(2, "0");
  return first + hex.slice(2);
}
// `curve` is ffjavascript's getCurveFromName("bls12381"); the caller owns it.
export function compressG1(curve, point) {
  const x = toHexBE(point[0], 48);
  if (BigInt(point[2]) !== 1n) return withFlags(x, COMPRESSED | INFINITY);
  const F = curve.G1.F;
  const fx = F.fromObject(BigInt(point[0]));
  const rhs = F.add(F.mul(F.square(fx), fx), curve.G1.b);
  const y1 = F.toObject(F.sqrt(rhs)), y2 = F.toObject(F.neg(F.sqrt(rhs)));
  const y = BigInt(point[1]);
  const larger = (y1 > y2 && y > y2) || (y1 < y2 && y > y1);
  return withFlags(x, COMPRESSED | (larger ? YBIT : 0));
}
export function compressG2(curve, point) {
  const x = toHexBE(point[0][1], 48) + toHexBE(point[0][0], 48);
  if (BigInt(point[2][0]) !== 1n) return withFlags(x, COMPRESSED | INFINITY);
  const F = curve.G2.F;
  const fx = F.fromObject(point[0].map((i) => BigInt(i)));
  const rhs = F.add(F.mul(F.square(fx), fx), curve.G2.b);
  const y1 = F.toObject(F.sqrt(rhs)), y2 = F.toObject(F.neg(F.sqrt(rhs)));
  const gt = (a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]);
  const y = point[1].map((i) => BigInt(i));
  const larger = (gt(y1, y2) && gt(y, y2)) || (gt(y2, y1) && gt(y, y1));
  return withFlags(x, COMPRESSED | (larger ? YBIT : 0));
}
// A snarkjs Groth16 proof as the three compressed points the validators take.
export function compressProof(curve, proof) {
  return { piA: compressG1(curve, proof.pi_a), piB: compressG2(curve, proof.pi_b), piC: compressG1(curve, proof.pi_c) };
}

// ── circuit inputs ───────────────────────────────────────────────────────────
const str = (v) => BigInt(v).toString();

// The proof's recipient signal: the 28-byte payment key hash as a big-endian
// integer (matches bytearray.to_int_big_endian in the validator).
export function pkhToInt(pkhHex) {
  if (!/^[0-9a-f]{56}$/i.test(pkhHex)) throw new Error(`bad key hash: ${pkhHex}`);
  return BigInt("0x" + pkhHex);
}

// Borrow (collateral_semaphore): membership + loan nullifier, bound to the payout key.
export function borrowInput({
  commitments, index, secret, recipientPkh, externalNullifier = EXTERNAL_NULLIFIER,
}) {
  const { root, siblings, pathIndices } = merkleProof(commitments, index);
  const nullifier = computeNullifier(secret, externalNullifier);
  return {
    root, nullifier,
    input: {
      group_merkle_root: str(root), loan_nullifier: str(nullifier),
      external_nullifier: str(externalNullifier), recipient: str(pkhToInt(recipientPkh)),
      secret: str(secret), pathIndices: pathIndices.map(String), siblings: siblings.map(str),
    },
  };
}

// Repay (repay_proof): membership + loan nullifier N AND repay nullifier R from one secret.
export function repayInput({
  commitments, index, secret, externalNullifier = EXTERNAL_NULLIFIER,
  repayExternalNullifier = REPAY_EXTERNAL_NULLIFIER,
}) {
  const { root, siblings, pathIndices } = merkleProof(commitments, index);
  const nullifier = computeNullifier(secret, externalNullifier);
  const R = computeRepayNullifier(secret, repayExternalNullifier);
  return {
    root, nullifier, R,
    input: {
      group_merkle_root: str(root), loan_nullifier: str(nullifier), repay_nullifier: str(R),
      external_nullifier: str(externalNullifier), repay_external_nullifier: str(repayExternalNullifier),
      secret: str(secret), pathIndices: pathIndices.map(String), siblings: siblings.map(str),
    },
  };
}

// Unlock (settlement_proof): bound to the commitment, R ∈ repaid_root (R private).
export function settlementInput({
  commitment, secret, repaid, index, repayExternalNullifier = REPAY_EXTERNAL_NULLIFIER,
}) {
  const { root, siblings, pathIndices } = merkleProof(repaid, index);
  return {
    root,
    input: {
      commitment: str(commitment), repaid_root: str(root), repay_external_nullifier: str(repayExternalNullifier),
      secret: str(secret), pathIndices: pathIndices.map(String), siblings: siblings.map(str),
    },
  };
}

// Lender withdraw (lender_withdraw): note ∈ lender_root, withdraw nullifier W,
// bound to the payout key.
export function lenderWithdrawInput({
  notes, index, secret, recipientPkh, lenderExternalNullifier = LENDER_EXTERNAL_NULLIFIER,
}) {
  const { root, siblings, pathIndices } = merkleProof(notes, index);
  const nullifier = computeLenderNullifier(secret, lenderExternalNullifier);
  return {
    root, nullifier,
    input: {
      lender_root: str(root), withdraw_nullifier: str(nullifier),
      lender_external_nullifier: str(lenderExternalNullifier), recipient: str(pkhToInt(recipientPkh)),
      secret: str(secret), pathIndices: pathIndices.map(String), siblings: siblings.map(str),
    },
  };
}

// Append (append_proof): `leaf` inserted at the next free slot, old_root -> new_root.
// Used by deposit (commitment into group_root), repay (R into repaid_root) and
// add liquidity (lender note into lender_root).
export function appendInput({ leavesBefore, leaf }) {
  const index = leavesBefore.length;
  const { root: oldRoot, siblings } = merkleProof(leavesBefore, index);
  const newRoot = merkleRoot([...leavesBefore, leaf]);
  return {
    oldRoot, newRoot, index,
    input: {
      old_root: str(oldRoot), new_root: str(newRoot), leaf: str(leaf), index: String(index),
      siblings: siblings.map(str),
    },
  };
}
