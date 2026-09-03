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
const SWASM = `${BASE}/settlement_proof_js/settlement_proof.wasm`;
const SZKEY = `${BASE}/keys/settlement_proof_final.zkey`;
const SVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_settlement.json`, "utf8"));
const AWASM = `${BASE}/append_proof_js/append_proof.wasm`;
const AZKEY = `${BASE}/keys/append_proof_final.zkey`;
const AVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_append.json`, "utf8"));
const RWASM = `${BASE}/repay_proof_js/repay_proof.wasm`;
const RZKEY = `${BASE}/keys/repay_proof_final.zkey`;
const RVKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key_repay.json`, "utf8"));
const OUT = path.resolve(__dirname, "../../contracts/lib/semaphore_onchain_test.ak");
const DEPTH = 10;

// Build a depth-DEPTH Poseidon255 Merkle tree with `leaf` at index 0, returning
// { root, siblings, pathIndices } — the membership witness the circuit expects.
function merkleWitness(leaf) {
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
  return { root: level[0], siblings, pathIndices };
}

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
  const repay_external_nullifier = 8888n;

  const leaf = poseidon2([collateral_amount, secret]);
  const { root, siblings, pathIndices } = merkleWitness(leaf);
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

  // Settlement proof for the SAME deposit: commitment-bound + Merkle membership of
  // the PRIVATE repayment nullifier R in an append-only repaid-set (size 1 here).
  // R is scoped to a DISTINCT external nullifier so it cannot be correlated with
  // the borrow-time loan_nullifier, and it is NOT a public signal.
  const R = poseidon2([secret, repay_external_nullifier]);
  const sWitness = merkleWitness(R);
  const sInput = {
    commitment: leaf.toString(),
    repaid_root: sWitness.root.toString(),
    repay_external_nullifier: repay_external_nullifier.toString(),
    secret: secret.toString(),
    collateral_amount: collateral_amount.toString(),
    pathIndices: sWitness.pathIndices.map(String),
    siblings: sWitness.siblings.map((s) => s.toString()),
  };
  const u = await snarkjs.groth16.fullProve(sInput, SWASM, SZKEY);
  if (!(await snarkjs.groth16.verify(SVKEY, u.publicSignals, u.proof))) throw new Error("settlement off-chain verify failed");

  // Append proof: inserting R at index 0 into the EMPTY repaid-set, taking the
  // root from old_root (all-zero tree) to new_root (= repaid_root above). This is
  // exactly what Repay verifies to grow repaid_root permissionlessly. The siblings
  // for index 0 are identical whether the leaf is 0 or R, so sWitness.siblings work.
  const emptyRoot = merkleWitness(0n).root;
  const aInput = {
    old_root: emptyRoot.toString(),
    new_root: sWitness.root.toString(),
    leaf: R.toString(),
    index: "0",
    siblings: sWitness.siblings.map((s) => s.toString()),
  };
  const a = await snarkjs.groth16.fullProve(aInput, AWASM, AZKEY);
  if (!(await snarkjs.groth16.verify(AVKEY, a.publicSignals, a.proof))) throw new Error("append off-chain verify failed");

  // Repay proof for deposit A: proves BOTH the loan nullifier N and the repayment
  // nullifier R from the SAME secret, binding R to the loan being repaid. Public
  // [group_root, N, R, loan_amount, collateral_ratio, external_nullifier,
  // repay_external_nullifier]. This is the exact proof the v6 lending_pool now
  // verifies at Repay (verify_repay_proof), replacing the plain borrow proof.
  const rInput = {
    group_merkle_root: root.toString(),
    loan_nullifier: nullifier.toString(),
    repay_nullifier: R.toString(),
    loan_amount: loan_amount.toString(),
    collateral_ratio: collateral_ratio.toString(),
    external_nullifier: external_nullifier.toString(),
    repay_external_nullifier: repay_external_nullifier.toString(),
    secret: secret.toString(),
    collateral_amount: collateral_amount.toString(),
    pathIndices: pathIndices.map(String),
    siblings: siblings.map((s) => s.toString()),
  };
  const r = await snarkjs.groth16.fullProve(rInput, RWASM, RZKEY);
  if (!(await snarkjs.groth16.verify(RVKEY, r.publicSignals, r.proof))) throw new Error("repay off-chain verify failed");

  // Deposit D — a DIFFERENT secret — for the R-binding NEGATIVE tests. We compute
  // its repayment nullifier R_d and an append proof that would insert R_d at index 0.
  // On-chain the validator feeds ONE `repay_nullifier` to BOTH the repay proof (as
  // the R signal) and the append proof (as the inserted leaf), so:
  //   - feeding R (deposit A's, which the repay proof binds) with append_proof_d
  //     (which attests leaf R_d != R) -> the append proof fails;
  //   - feeding R_d with A's repay proof (which binds R != R_d) -> the repay proof
  //     fails.
  // Either way a repay of loan A cannot smuggle deposit D's R into repaid_root.
  const secret_d = 11223344556677889900112233445566778899n;
  const R_d = poseidon2([secret_d, repay_external_nullifier]);
  const dWitness = merkleWitness(R_d);
  const adInput = {
    old_root: emptyRoot.toString(),
    new_root: dWitness.root.toString(),
    leaf: R_d.toString(),
    index: "0",
    siblings: dWitness.siblings.map((s) => s.toString()),
  };
  const ad = await snarkjs.groth16.fullProve(adInput, AWASM, AZKEY);
  if (!(await snarkjs.groth16.verify(AVKEY, ad.publicSignals, ad.proof))) throw new Error("append-D off-chain verify failed");

  const curve = await ff.getCurveFromName("bls12381");
  const cG1 = (p) => compressedG1(curve, p);
  const cG2 = (p) => compressedG2(curve, p);
  const piA = cG1(proof.pi_a), piB = cG2(proof.pi_b), piC = cG1(proof.pi_c);
  const vkAlpha = cG1(VKEY.vk_alpha_1), vkBeta = cG2(VKEY.vk_beta_2);
  const vkGamma = cG2(VKEY.vk_gamma_2), vkDelta = cG2(VKEY.vk_delta_2);
  const vkIC = VKEY.IC.map(cG1);
  // settlement
  const sPiA = cG1(u.proof.pi_a), sPiB = cG2(u.proof.pi_b), sPiC = cG1(u.proof.pi_c);
  const svkAlpha = cG1(SVKEY.vk_alpha_1), svkBeta = cG2(SVKEY.vk_beta_2);
  const svkGamma = cG2(SVKEY.vk_gamma_2), svkDelta = cG2(SVKEY.vk_delta_2);
  const svkIC = SVKEY.IC.map(cG1);
  // append
  const aPiA = cG1(a.proof.pi_a), aPiB = cG2(a.proof.pi_b), aPiC = cG1(a.proof.pi_c);
  const avkAlpha = cG1(AVKEY.vk_alpha_1), avkBeta = cG2(AVKEY.vk_beta_2);
  const avkGamma = cG2(AVKEY.vk_gamma_2), avkDelta = cG2(AVKEY.vk_delta_2);
  const avkIC = AVKEY.IC.map(cG1);
  // repay
  const rPiA = cG1(r.proof.pi_a), rPiB = cG2(r.proof.pi_b), rPiC = cG1(r.proof.pi_c);
  const rvkAlpha = cG1(RVKEY.vk_alpha_1), rvkBeta = cG2(RVKEY.vk_beta_2);
  const rvkGamma = cG2(RVKEY.vk_gamma_2), rvkDelta = cG2(RVKEY.vk_delta_2);
  const rvkIC = RVKEY.IC.map(cG1);
  // append for deposit D (binding negatives)
  const adPiA = cG1(ad.proof.pi_a), adPiB = cG2(ad.proof.pi_b), adPiC = cG1(ad.proof.pi_c);
  await curve.terminate();

  const icLit = vkIC.map((h) => `#"${h}"`).join(", ");
  const sIcLit = svkIC.map((h) => `#"${h}"`).join(", ");
  const aIcLit = avkIC.map((h) => `#"${h}"`).join(", ");
  const rIcLit = rvkIC.map((h) => `#"${h}"`).join(", ");
  const [g_root, g_null, g_loan, g_ratio, g_ext] = publicSignals;
  const [s_cmt, s_repaid_root, s_repay_ext] = u.publicSignals;
  const [a_old_root, a_new_root, a_leaf, a_index] = a.publicSignals;
  const [rp_root, rp_n, rp_r, rp_loan, rp_ratio, rp_ext, rp_rext] = r.publicSignals;
  const [ad_old, ad_new, ad_leaf, ad_index] = ad.publicSignals;
  const loanTampered = (BigInt(g_loan) + 1n).toString();
  const repayRTampered = (BigInt(rp_r) + 1n).toString();
  // Consistency: the repay proof must bind exactly the borrow N and the append R.
  if (rp_n !== g_null) throw new Error("repay proof N != borrow loan_nullifier — fixture inconsistency");
  if (rp_r !== a_leaf) throw new Error("repay proof R != append leaf — fixture inconsistency");
  if (ad_leaf === a_leaf) throw new Error("deposit-D R equals deposit-A R — pick a different secret_d");

  const ak = `// AUTO-GENERATED by circuits/tests/gen-semaphore-fixture.cjs — do not edit by hand.
// Real BLS12-381 Groth16 proof for the v6 privacy circuit (Merkle membership +
// nullifier), verified ON-CHAIN via zk.verify_borrow_proof — the exact helper the
// v6 lending_pool validator calls. Public signals:
//   [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]
use ak_381/groth16.{Proof, SnarkVerificationKey}
use zk.{verify_append_proof, verify_borrow_proof, verify_repay_proof,
  verify_settlement_proof}

// Real public-signal values, exported so validator tests can build fixtures.
pub const group_root: Int = ${g_root}
pub const loan_null: Int = ${g_null}
pub const loan_amt: Int = ${g_loan}
pub const ratio: Int = ${g_ratio}
pub const ext: Int = ${g_ext}
pub const commitment: Int = ${s_cmt}
// Settlement public signals: [commitment, repaid_root, repay_external_nullifier].
// repaid_root here is the root of a size-1 repaid-set containing the private R.
pub const repaid_root: Int = ${s_repaid_root}
pub const repay_ext: Int = ${s_repay_ext}
// Append public signals: [old_root, new_root, leaf, index]. The append proof takes
// the empty repaid-set (old_repaid_root) to repaid_root by inserting R (= repay_null)
// at index 0 — exactly what Repay verifies to grow repaid_root permissionlessly.
pub const old_repaid_root: Int = ${a_old_root}
pub const repay_null: Int = ${a_leaf}
pub const append_index: Int = ${a_index}
// Deposit D (a DIFFERENT secret) for the R-binding negatives: its repayment
// nullifier R_d and the root after inserting R_d at index 0. A repay of loan A
// cannot insert R_d (append leaf != the repay proof's R) nor settle deposit D.
pub const repay_null_d: Int = ${ad_leaf}
pub const repaid_root_d: Int = ${ad_new}

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

pub fn settlement_vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: ${SVKEY.nPublic},
    vkAlpha: #"${svkAlpha}",
    vkBeta: #"${svkBeta}",
    vkGamma: #"${svkGamma}",
    vkDelta: #"${svkDelta}",
    vkAlphaBeta: [],
    vkIC: [${sIcLit}],
  }
}

pub fn settlement_proof() -> Proof {
  Proof { piA: #"${sPiA}", piB: #"${sPiB}", piC: #"${sPiC}" }
}

pub fn append_vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: ${AVKEY.nPublic},
    vkAlpha: #"${avkAlpha}",
    vkBeta: #"${avkBeta}",
    vkGamma: #"${avkGamma}",
    vkDelta: #"${avkDelta}",
    vkAlphaBeta: [],
    vkIC: [${aIcLit}],
  }
}

pub fn append_proof() -> Proof {
  Proof { piA: #"${aPiA}", piB: #"${aPiB}", piC: #"${aPiC}" }
}

// The repay circuit's verification key (7 public signals). Proves N AND R from the
// same secret — the binding the v6 lending_pool checks at Repay.
pub fn repay_vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: ${RVKEY.nPublic},
    vkAlpha: #"${rvkAlpha}",
    vkBeta: #"${rvkBeta}",
    vkGamma: #"${rvkGamma}",
    vkDelta: #"${rvkDelta}",
    vkAlphaBeta: [],
    vkIC: [${rIcLit}],
  }
}

pub fn repay_proof() -> Proof {
  Proof { piA: #"${rPiA}", piB: #"${rPiB}", piC: #"${rPiC}" }
}

// Append proof for deposit D (leaf = repay_null_d). Verified by the SAME append vkey
// — only the inserted leaf differs. Used to show the append leaf cannot diverge from
// the repay proof's R.
pub fn append_proof_d() -> Proof {
  Proof { piA: #"${adPiA}", piB: #"${adPiB}", piC: #"${adPiC}" }
}

test borrow_proof_verifies_onchain() {
  verify_borrow_proof(vkey(), proof(), ${g_root}, ${g_null}, ${g_loan}, ${g_ratio}, ${g_ext})
}

test tampered_borrow_signal_fails_onchain() {
  !verify_borrow_proof(vkey(), proof(), ${g_root}, ${g_null}, ${loanTampered}, ${g_ratio}, ${g_ext})
}

test settlement_proof_verifies_onchain() {
  verify_settlement_proof(settlement_vkey(), settlement_proof(), ${s_cmt}, ${s_repaid_root}, ${s_repay_ext})
}

test tampered_settlement_signal_fails_onchain() {
  // Tamper the repaid_root public signal (+1) -> membership no longer holds.
  !verify_settlement_proof(settlement_vkey(), settlement_proof(), ${s_cmt}, ${BigInt(s_repaid_root) + 1n}, ${s_repay_ext})
}

test append_proof_verifies_onchain() {
  verify_append_proof(append_vkey(), append_proof(), ${a_old_root}, ${a_new_root}, ${a_leaf}, ${a_index})
}

test tampered_append_signal_fails_onchain() {
  // Tamper the new_root public signal (+1) -> the claimed insertion no longer holds.
  !verify_append_proof(append_vkey(), append_proof(), ${a_old_root}, ${BigInt(a_new_root) + 1n}, ${a_leaf}, ${a_index})
}

// Public signals: [group_root, loan_nullifier, repay_nullifier, loan_amount,
// collateral_ratio, external_nullifier, repay_external_nullifier].
test repay_proof_verifies_onchain() {
  verify_repay_proof(repay_vkey(), repay_proof(), ${rp_root}, ${rp_n}, ${rp_r}, ${rp_loan}, ${rp_ratio}, ${rp_ext}, ${rp_rext})
}

test tampered_repay_signal_fails_onchain() {
  // Tamper the repay_nullifier (R) public signal (+1) -> proof no longer verifies.
  // This is the on-chain root of the binding: the validator passes R from the
  // redeemer, so a redeemer R != the proof's bound R is rejected here.
  !verify_repay_proof(repay_vkey(), repay_proof(), ${rp_root}, ${rp_n}, ${repayRTampered}, ${rp_loan}, ${rp_ratio}, ${rp_ext}, ${rp_rext})
}

// Deposit D's append proof verifies on its own terms (it is a real proof) — the
// binding is enforced at the validator, which passes the redeemer's repay_nullifier
// as the leaf, so pairing this with A's repay proof is what gets rejected.
test append_d_verifies_onchain() {
  verify_append_proof(append_vkey(), append_proof_d(), ${ad_old}, ${ad_new}, ${ad_leaf}, ${ad_index})
}
`;
  if (a_new_root !== s_repaid_root) throw new Error("append new_root != settlement repaid_root — fixture inconsistency");
  fs.writeFileSync(OUT, ak);
  console.log("Wrote", OUT);
  console.log("public signals:", publicSignals);
  console.log("append new_root == settlement repaid_root:", a_new_root === s_repaid_root);
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
