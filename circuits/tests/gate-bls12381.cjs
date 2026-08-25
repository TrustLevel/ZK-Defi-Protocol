/**
 * Phase 1 GATE — BLS12-381 proof generation + verification
 *
 * Proves the migrated circuit works end-to-end off-chain:
 *   - commitment computed with poseidon-bls12381 (matches circuit Poseidon255)
 *   - snarkjs groth16 fullProve over BLS12-381
 *   - groth16 verify == true
 *   - determinism sanity
 *   - rejection: insufficient collateral must fail proof generation
 *
 * snarkjs is resolved from offchain/node_modules; poseidon2 is referenced from
 * the ZK-Voting-App node_modules for this gate test only (DeFi install happens
 * during the off-chain migration step).
 */
const fs = require("fs");
const snarkjs = require("/Users/dominiktilman/ZK-Defi-Protocol/offchain/node_modules/snarkjs");
const { poseidon2 } = require("/Users/dominiktilman/ZK-Voting-App/node_modules/poseidon-bls12381");

const BASE = "/Users/dominiktilman/ZK-Defi-Protocol/circuits";
const WASM = `${BASE}/collateral_proof_js/collateral_proof.wasm`;
const ZKEY = `${BASE}/keys/collateral_proof_final.zkey`;
const VKEY = JSON.parse(fs.readFileSync(`${BASE}/keys/verification_key.json`, "utf8"));

function inputs(collateral_amount, loan_amount, collateral_ratio, secret) {
  const commitment = poseidon2([collateral_amount, secret]);
  return {
    commitment: commitment.toString(),
    loan_amount: loan_amount.toString(),
    collateral_ratio: collateral_ratio.toString(),
    secret: secret.toString(),
    collateral_amount: collateral_amount.toString(),
  };
}

async function main() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { console.log("  ✅", m); pass++; } else { console.log("  ❌", m); fail++; } };

  // ---- Valid case: 20 ADA collateral, 10 ADA loan, 125% ratio ----
  const secret = 88553311220099887766554433221100998877n;
  const collateral_amount = 20_000_000n; // lovelace
  const loan_amount = 10_000_000n;
  const collateral_ratio = 125n; // 20e6*100=2e9 >= 10e6*125=1.25e9  ✓
  const inp = inputs(collateral_amount, loan_amount, collateral_ratio, secret);

  console.log("VALID case:");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inp, WASM, ZKEY);
  const verified = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
  ok(verified === true, "groth16 verify == true");
  ok(publicSignals.length === 3, "3 public signals");
  ok(publicSignals[0] === inp.commitment, "publicSignals[0] == commitment");
  ok(publicSignals[1] === loan_amount.toString(), "publicSignals[1] == loan_amount");
  ok(publicSignals[2] === collateral_ratio.toString(), "publicSignals[2] == collateral_ratio");
  ok(VKEY.curve === "bls12381", "vkey curve == bls12381");

  // ---- Determinism: same commitment for same inputs ----
  const c2 = poseidon2([collateral_amount, secret]).toString();
  ok(c2 === inp.commitment, "poseidon255 deterministic");

  // ---- Tampered public signals must fail verification ----
  const tampered = [...publicSignals];
  tampered[1] = (BigInt(tampered[1]) + 1n).toString();
  const badVerify = await snarkjs.groth16.verify(VKEY, tampered, proof);
  ok(badVerify === false, "tampered public signal -> verify == false");

  // ---- Rejection: insufficient collateral must fail proof generation ----
  console.log("REJECTION case (10 ADA collateral, 10 ADA loan @125% -> 1e9 < 1.25e9):");
  const badInp = inputs(10_000_000n, 10_000_000n, 125n, secret);
  let rejected = false;
  try {
    await snarkjs.groth16.fullProve(badInp, WASM, ZKEY);
  } catch (_e) {
    rejected = true;
  }
  ok(rejected, "insufficient collateral -> proof generation rejected");

  console.log(`\nGATE RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
