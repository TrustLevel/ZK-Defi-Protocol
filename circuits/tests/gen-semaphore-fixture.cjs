/**
 * v6 fixture generator for the collateral_semaphore circuit (5 public signals).
 * Builds a Poseidon255 Merkle tree, generates a real BLS12-381 Groth16
 * membership+nullifier proof, compresses G1/G2 to the ak_381 byte format, and
 * emits an Aiken test that calls zk.verify_borrow_proof on-chain (+ a tampered
 * negative). Compression mirrors gen-onchain-fixture.cjs / ZK-Voting conversion.ts.
 */
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const ff = require("ffjavascript");
const { poseidon2 } = require("poseidon-bls12381");

const BASE = path.resolve(__dirname, "..");
const WASM = `${BASE}/collateral_semaphore_js/collateral_semaphore.wasm`;
const ZKEY = `${BASE}/keys/collateral_semaphore_final.zkey`;
const VKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_semaphore.json`, "utf8"));
const UWASM = `${BASE}/unlock_proof_js/unlock_proof.wasm`;
const UZKEY = `${BASE}/keys/unlock_proof_final.zkey`;
const UVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_unlock.json`, "utf8"));
const OUT = path.resolve(__dirname, "../../contracts/lib/semaphore_onchain_test.ak");
const DEPTH = 10;

function toBufferBE(v, width) {
  let hex = BigInt(v).toString(16);
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

async function main() {
  const secret = 88553311220099887766554433221100998877n;
  const collateral_amount = 20_000_000n, loan_amount = 10_000_000n, collateral_ratio = 125n;
  const external_nullifier = 7777n;

  const leaf = poseidon2([collateral_amount, secret]);
  let level = new Array(1 << DEPTH).fill(0n);
  level[0] = leaf;
  const siblings = [], pathIndices = [];
  let idx = 0;
  for (let d = 0; d < DEPTH; d++) {
    siblings.push(level[idx ^ 1]);
    pathIndices.push(idx & 1);
    const next = new Array(level.length >> 1);
    for (let i = 0; i < next.length; i++) next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
    level = next; idx >>= 1;
  }
  const root = level[0];
  const nullifier = poseidon2([secret, external_nullifier]);

  const input = {
    group_merkle_root: root.toString(),
    loan_nullifier: nullifier.toString(),
    loan_amount: loan_amount.toString(),
    collateral_ratio: collateral_ratio.toString(),
    external_nullifier: external_nullifier.toString(),
    secret: secret.toString(),
    collateral_amount: collateral_amount.toString(),
    pathIndices: pathIndices.map(String),
    siblings: siblings.map((s) => s.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  if (!(await snarkjs.groth16.verify(VKEY, publicSignals, proof))) throw new Error("off-chain verify failed");

  // Unlock proof for the SAME deposit: commitment-bound, same nullifier.
  const uInput = {
    commitment: leaf.toString(),
    loan_nullifier: nullifier.toString(),
    external_nullifier: external_nullifier.toString(),
    secret: secret.toString(),
    collateral_amount: collateral_amount.toString(),
  };
  const u = await snarkjs.groth16.fullProve(uInput, UWASM, UZKEY);
  if (!(await snarkjs.groth16.verify(UVKEY, u.publicSignals, u.proof))) throw new Error("unlock off-chain verify failed");

  const curve = await ff.getCurveFromName("bls12381");
  const cG1 = (p) => compressedG1(curve, p);
  const cG2 = (p) => compressedG2(curve, p);
  const piA = cG1(proof.pi_a), piB = cG2(proof.pi_b), piC = cG1(proof.pi_c);
  const vkAlpha = cG1(VKEY.vk_alpha_1), vkBeta = cG2(VKEY.vk_beta_2);
  const vkGamma = cG2(VKEY.vk_gamma_2), vkDelta = cG2(VKEY.vk_delta_2);
  const vkIC = VKEY.IC.map(cG1);
  // unlock
  const uPiA = cG1(u.proof.pi_a), uPiB = cG2(u.proof.pi_b), uPiC = cG1(u.proof.pi_c);
  const uvkAlpha = cG1(UVKEY.vk_alpha_1), uvkBeta = cG2(UVKEY.vk_beta_2);
  const uvkGamma = cG2(UVKEY.vk_gamma_2), uvkDelta = cG2(UVKEY.vk_delta_2);
  const uvkIC = UVKEY.IC.map(cG1);
  await curve.terminate();

  const icLit = vkIC.map((h) => `#"${h}"`).join(", ");
  const uIcLit = uvkIC.map((h) => `#"${h}"`).join(", ");
  const [g_root, g_null, g_loan, g_ratio, g_ext] = publicSignals;
  const [u_cmt, u_null, u_ext] = u.publicSignals;
  const loanTampered = (BigInt(g_loan) + 1n).toString();

  const ak = `// AUTO-GENERATED by circuits/tests/gen-semaphore-fixture.cjs — do not edit by hand.
// Real BLS12-381 Groth16 proof for the v6 privacy circuit (Merkle membership +
// nullifier), verified ON-CHAIN via zk.verify_borrow_proof — the exact helper the
// v6 lending_pool validator calls. Public signals:
//   [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]
use ak_381/groth16.{Proof, SnarkVerificationKey}
use zk.{verify_borrow_proof, verify_unlock_proof}

// Real public-signal values, exported so validator tests can build fixtures.
pub const group_root: Int = ${g_root}
pub const loan_null: Int = ${g_null}
pub const loan_amt: Int = ${g_loan}
pub const ratio: Int = ${g_ratio}
pub const ext: Int = ${g_ext}
pub const commitment: Int = ${u_cmt}

pub fn vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: ${VKEY.nPublic},
    vkAlpha: #"${vkAlpha}",
    vkBeta: #"${vkBeta}",
    vkGamma: #"${vkGamma}",
    vkDelta: #"${vkDelta}",
    vkAlphaBeta: [],
    vkIC: [${icLit}],
  }
}

pub fn proof() -> Proof {
  Proof { piA: #"${piA}", piB: #"${piB}", piC: #"${piC}" }
}

pub fn unlock_vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: ${UVKEY.nPublic},
    vkAlpha: #"${uvkAlpha}",
    vkBeta: #"${uvkBeta}",
    vkGamma: #"${uvkGamma}",
    vkDelta: #"${uvkDelta}",
    vkAlphaBeta: [],
    vkIC: [${uIcLit}],
  }
}

pub fn unlock_proof() -> Proof {
  Proof { piA: #"${uPiA}", piB: #"${uPiB}", piC: #"${uPiC}" }
}

test borrow_proof_verifies_onchain() {
  verify_borrow_proof(vkey(), proof(), ${g_root}, ${g_null}, ${g_loan}, ${g_ratio}, ${g_ext})
}

test tampered_borrow_signal_fails_onchain() {
  !verify_borrow_proof(vkey(), proof(), ${g_root}, ${g_null}, ${loanTampered}, ${g_ratio}, ${g_ext})
}

test unlock_proof_verifies_onchain() {
  verify_unlock_proof(unlock_vkey(), unlock_proof(), ${u_cmt}, ${u_null}, ${u_ext})
}

test tampered_unlock_signal_fails_onchain() {
  !verify_unlock_proof(unlock_vkey(), unlock_proof(), ${u_cmt}, ${BigInt(u_null) + 1n}, ${u_ext})
}
`;
  fs.writeFileSync(OUT, ak);
  console.log("Wrote", OUT);
  console.log("public signals:", publicSignals);
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
