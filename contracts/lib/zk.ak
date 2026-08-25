//// ============================================
//// ZK — on-chain Groth16 verification helpers (v5)
//// ============================================
//// Wraps the generic modulo-p/ak-381 Groth16 verifier for the collateral proof.
//// This is the real on-chain verification that Milestone 3 requires.

use aiken/collection/list
use ak_381/groth16.{Proof, SnarkVerificationKey, groth_verify}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

/// Verify a collateral-ownership proof.
/// Public-signal order MUST match the circuit: [commitment, loan_amount, collateral_ratio].
pub fn verify_collateral_proof(
  vkey: SnarkVerificationKey,
  proof: Proof,
  commitment: Int,
  loan_amount: Int,
  collateral_ratio: Int,
) -> Bool {
  groth_verify(vkey, proof, [commitment, loan_amount, collateral_ratio])
}

/// Resolve the trusted verification key from the reference input pinned by `vkey_ref`.
/// The VKey UTxO is parked at an always-false address and set once at pool init, so
/// referencing it by OutputReference from the (continuity-enforced) pool datum is trusted.
pub fn get_vkey(tx: Transaction, vkey_ref: OutputReference) -> SnarkVerificationKey {
  expect Some(ref_input) =
    list.find(tx.reference_inputs, fn(i) { i.output_reference == vkey_ref })
  expect InlineDatum(vkey_data) = ref_input.output.datum
  expect vkey: SnarkVerificationKey = vkey_data
  vkey
}
