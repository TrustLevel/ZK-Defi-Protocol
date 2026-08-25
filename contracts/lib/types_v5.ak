//// ============================================
//// V5 TYPES — Real on-chain ZK verification (Milestone 3)
//// ============================================
//// The proof is the authorization: no admin signature / extra_signatories.
//// Public signals are reconstructed on-chain from trusted state, never trusted
//// blindly from the redeemer. Commitment is a BLS12-381 field element (Int).

use ak_381/groth16.{Proof}
use cardano/transaction.{OutputReference}

/// Collateral deposit datum (v5).
/// `commitment` = Poseidon255(collateral_amount, secret) as a BLS12-381 field
/// element, stored as Int so it can be passed straight to groth_verify.
pub type DepositDatumV5 {
  owner: ByteArray,
  collateral_amount: Int,
  commitment: Int,
  timestamp: Int,
}

/// Lending pool datum (v5).
/// `collateral_ratio` is the protocol LTV ratio used as a ZK public signal.
/// `vkey_ref` pins the reference UTxO that holds the trusted SnarkVerificationKey.
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  collateral_ratio: Int,
  vkey_ref: OutputReference,
  last_updated: Int,
}

/// Lending pool redeemer (v5). Borrow/Repay carry the Groth16 proof directly.
pub type PoolRedeemerV5 {
  Deposit
  BorrowAnonymous { collateral_ref: OutputReference, proof: Proof, loan_amount: Int }
  RepayAnonymous { deposit_ref: OutputReference, proof: Proof, repay_amount: Int }
}

/// Collateral redeemer (v5).
/// UnlockDeposit carries the proof + the reference to the trusted verification key.
pub type CollateralRedeemerV5 {
  Withdraw
  UsedAsCollateral { loan_id: ByteArray }
  UnlockDeposit { proof: Proof, vkey_ref: OutputReference }
}
