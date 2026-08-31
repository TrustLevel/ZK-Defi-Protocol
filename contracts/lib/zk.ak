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

/// Verify a v6 privacy borrow/repay proof (membership + nullifier + sufficiency).
/// Public-signal order MUST match `circuits/collateral_semaphore.circom`:
///   [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]
/// group_merkle_root / external_nullifier / collateral_ratio are bound to trusted
/// on-chain state; loan_nullifier / loan_amount to the redeemer, cross-checked by
/// the validator against the MPF set and the pool value delta.
pub fn verify_borrow_proof(
  vkey: SnarkVerificationKey,
  proof: Proof,
  group_merkle_root: Int,
  loan_nullifier: Int,
  loan_amount: Int,
  collateral_ratio: Int,
  external_nullifier: Int,
) -> Bool {
  groth_verify(
    vkey,
    proof,
    [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier],
  )
}

/// Verify a v6 unlock proof, bound to the SPECIFIC collateral UTxO being spent.
/// Public-signal order MUST match `circuits/unlock_proof.circom`:
///   [commitment, loan_nullifier, external_nullifier]
/// commitment is bound to the spent deposit datum; loan_nullifier is then checked
/// absent from the pool's open-loans set (the repayment gate).
pub fn verify_unlock_proof(
  vkey: SnarkVerificationKey,
  proof: Proof,
  commitment: Int,
  loan_nullifier: Int,
  external_nullifier: Int,
) -> Bool {
  groth_verify(vkey, proof, [commitment, loan_nullifier, external_nullifier])
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
