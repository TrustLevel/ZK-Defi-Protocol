/**
 * Lender fixture generator: real BLS12-381 Groth16 proofs for the lender side,
 * emitted as an Aiken module (contracts/lib/lender_onchain_test.ak) the
 * validator tests import.
 *   - append proofs for two lender notes: empty tree -> [L1] (index 0) and
 *     [L1] -> [L1, L2] (index 1), what AddLiquidity verifies;
 *   - a lender withdraw proof for L1 against the two-note tree, bound to a
 *     payout key, what WithdrawLiquidity verifies.
 * Compression helpers are shared with gen-semaphore-fixture.cjs in spirit; they
 * are duplicated here so the existing fixture stays untouched.
 */
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const ff = require("ffjavascript");
const { poseidon2 } = require("poseidon-bls12381");

const BASE = path.resolve(__dirname, "..");
const WWASM = `${BASE}/lender_withdraw_js/lender_withdraw.wasm`;
const WZKEY = `${BASE}/keys/lender_withdraw_final.zkey`;
const WVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_lender_withdraw.json`, "utf8"));
const AWASM = `${BASE}/append_proof_js/append_proof.wasm`;
const AZKEY = `${BASE}/keys/append_proof_final.zkey`;
const AVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_append.json`, "utf8"));
const OUT = path.resolve(__dirname, "../../contracts/lib/lender_onchain_test.ak");
const DEPTH = 10;
// Must match packages/protocol/src/crypto.mjs and lender_withdraw.circom.
const LENDER_LEAF_TAG = 6666n;
const LENDER_EXTERNAL_NULLIFIER = 9999n;

function tree(leaves, index) {
  let level = new Array(1 << DEPTH).fill(0n);
  leaves.forEach((l, i) => { level[i] = l; });
  const siblings = [], pathIndices = [];
  let idx = index;
  for (let d = 0; d < DEPTH; d++) {
    siblings.push(level[idx ^ 1]);
    pathIndices.push(idx & 1);
    const next = new Array(level.length >> 1);
    for (let i = 0; i < next.length; i++) next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
    level = next; idx >>= 1;
  }
  return { root: level[0], siblings, pathIndices };
}

function toBufferBE(v, width) {
  const hex = BigInt(v).toString(16);
  if (hex.length > width * 2) throw new Error("value too large for " + width + " bytes");
  return Buffer.from(hex.padStart(width * 2, "0"), "hex");
}
const COMPRESSED = 0b10000000, INFINITY = 0b01000000, YBIT = 0b00100000;
function compressedG1(curve, point) {
  const result = toBufferBE(BigInt(point[0]), 48);
  result[0] |= COMPRESSED;
  if (BigInt(point[2]) !== 1n) { result[0] |= INFINITY; return result.toString("hex"); }
  const F = curve.G1.F;
  const x = F.fromObject(BigInt(point[0]));
  const x3b = F.add(F.mul(F.square(x), x), curve.G1.b);
  const y1 = F.toObject(F.sqrt(x3b)), y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const y = BigInt(point[1]);
  if ((y1 > y2 && y > y2) || (y1 < y2 && y > y1)) result[0] |= YBIT;
  return result.toString("hex");
}
function compressedG2(curve, point) {
  const result = Buffer.concat([toBufferBE(BigInt(point[0][1]), 48), toBufferBE(BigInt(point[0][0]), 48)]);
  result[0] |= COMPRESSED;
  if (BigInt(point[2][0]) !== 1n) { result[0] |= INFINITY; return result.toString("hex"); }
  const F = curve.G2.F;
  const x = F.fromObject(point[0].map((i) => BigInt(i)));
  const x3b = F.add(F.mul(F.square(x), x), curve.G2.b);
  const y1 = F.toObject(F.sqrt(x3b)), y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const gt = (a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]);
  const y = point[1].map((i) => BigInt(i));
  if ((gt(y1, y2) && gt(y, y2)) || (gt(y2, y1) && gt(y, y1))) result[0] |= YBIT;
  return result.toString("hex");
}

async function proveVerified(input, wasm, zkey, vkey, what) {
  const r = await snarkjs.groth16.fullProve(input, wasm, zkey);
  if (!(await snarkjs.groth16.verify(vkey, r.publicSignals, r.proof))) throw new Error(`${what} off-chain verify failed`);
  return r;
}

async function main() {
  const secret1 = 31415926535897932384626433832795028841n;
  const secret2 = 27182818284590452353602874713526624977n;
  const RECIPIENT_PKH = "cd".repeat(28);
  const recipient = BigInt("0x" + RECIPIENT_PKH);
  const L1 = poseidon2([LENDER_LEAF_TAG, secret1]);
  const L2 = poseidon2([LENDER_LEAF_TAG, secret2]);
  const W1 = poseidon2([secret1, LENDER_EXTERNAL_NULLIFIER]);

  const empty = tree([], 0);
  const one = tree([L1], 1);          // siblings for index 1 in [L1]
  const two = tree([L1, L2], 0);      // membership path of L1 in [L1, L2]
  const rootOne = tree([L1], 0).root;

  const a1 = await proveVerified({
    old_root: empty.root.toString(), new_root: rootOne.toString(), leaf: L1.toString(), index: "0",
    siblings: empty.siblings.map(String),
  }, AWASM, AZKEY, AVKEY, "append L1");
  const a2 = await proveVerified({
    old_root: rootOne.toString(), new_root: two.root.toString(), leaf: L2.toString(), index: "1",
    siblings: one.siblings.map(String),
  }, AWASM, AZKEY, AVKEY, "append L2");
  const w = await proveVerified({
    lender_root: two.root.toString(), withdraw_nullifier: W1.toString(),
    lender_external_nullifier: LENDER_EXTERNAL_NULLIFIER.toString(), recipient: recipient.toString(),
    secret: secret1.toString(), pathIndices: two.pathIndices.map(String), siblings: two.siblings.map(String),
  }, WWASM, WZKEY, WVKEY, "lender withdraw");

  const curve = await ff.getCurveFromName("bls12381");
  const g1 = (p) => compressedG1(curve, p), g2 = (p) => compressedG2(curve, p);
  const proofLit = (p) => `Proof { piA: #"${g1(p.pi_a)}", piB: #"${g2(p.pi_b)}", piC: #"${g1(p.pi_c)}" }`;
  const vkeyLit = (v) => `SnarkVerificationKey {
    nPublic: ${v.nPublic},
    vkAlpha: #"${g1(v.vk_alpha_1)}",
    vkBeta: #"${g2(v.vk_beta_2)}",
    vkGamma: #"${g2(v.vk_gamma_2)}",
    vkDelta: #"${g2(v.vk_delta_2)}",
    vkAlphaBeta: [],
    vkIC: [${v.IC.map(g1).map((h) => `#"${h}"`).join(", ")}],
  }`;
  const lits = {
    a1: proofLit(a1.proof), a2: proofLit(a2.proof), w: proofLit(w.proof), wvk: vkeyLit(WVKEY),
  };
  await curve.terminate();

  const [w_root, w_null, w_ext, w_recipient] = w.publicSignals;
  if (w_root !== two.root.toString() || w_null !== W1.toString() || w_recipient !== recipient.toString()) {
    throw new Error("withdraw public signals do not match the fixture");
  }

  const ak = `// AUTO-GENERATED by circuits/tests/gen-lender-fixture.cjs — do not edit by hand.
// Real BLS12-381 Groth16 proofs for the lender side: two append proofs that grow
// the lender tree (empty -> [L1] -> [L1, L2]) and a lender withdraw proof for L1
// against [L1, L2], bound to lender_recipient_pkh. Lender withdraw public signals:
//   [lender_root, withdraw_nullifier, lender_external_nullifier, recipient]
use ak_381/groth16.{Proof, SnarkVerificationKey}
use semaphore_onchain_test.{append_vkey}
use zk.{verify_append_proof, verify_lender_withdraw_proof}

pub const lender_empty_root: Int = ${empty.root}
pub const lender_note_1: Int = ${L1}
pub const lender_root_1: Int = ${rootOne}
pub const lender_note_2: Int = ${L2}
pub const lender_root_2: Int = ${two.root}
pub const withdraw_null: Int = ${w_null}
pub const lender_ext: Int = ${w_ext}
pub const lender_recipient_pkh: ByteArray = #"${RECIPIENT_PKH}"
pub const lender_recipient: Int = ${w_recipient}

pub fn lender_withdraw_vkey() -> SnarkVerificationKey {
  ${lits.wvk}
}

// L1 appended at index 0: lender_empty_root -> lender_root_1.
pub fn lender_append_1() -> Proof {
  ${lits.a1}
}

// L2 appended at index 1: lender_root_1 -> lender_root_2.
pub fn lender_append_2() -> Proof {
  ${lits.a2}
}

// L1 withdrawn from lender_root_2, paid to lender_recipient_pkh.
pub fn lender_withdraw_proof() -> Proof {
  ${lits.w}
}

test lender_append_1_verifies_onchain() {
  verify_append_proof(append_vkey(), lender_append_1(), lender_empty_root, lender_root_1, lender_note_1, 0)
}

test lender_append_2_verifies_onchain() {
  verify_append_proof(append_vkey(), lender_append_2(), lender_root_1, lender_root_2, lender_note_2, 1)
}

test lender_withdraw_verifies_onchain() {
  verify_lender_withdraw_proof(lender_withdraw_vkey(), lender_withdraw_proof(), lender_root_2, withdraw_null, lender_ext, lender_recipient)
}

test lender_withdraw_other_recipient_fails_onchain() {
  !verify_lender_withdraw_proof(lender_withdraw_vkey(), lender_withdraw_proof(), lender_root_2, withdraw_null, lender_ext, lender_recipient + 1)
}

test lender_withdraw_other_root_fails_onchain() {
  !verify_lender_withdraw_proof(lender_withdraw_vkey(), lender_withdraw_proof(), lender_root_1, withdraw_null, lender_ext, lender_recipient)
}
`;
  fs.writeFileSync(OUT, ak);
  console.log("Wrote", OUT);
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
