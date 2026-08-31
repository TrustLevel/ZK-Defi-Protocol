//// ============================================
//// V5 TYPES — Real on-chain ZK verification (Milestone 3)
//// ============================================
//// The proof is the authorization: no admin signature / extra_signatories.
//// Public signals are reconstructed on-chain from trusted state, never trusted
//// blindly from the redeemer. Commitment is a BLS12-381 field element (Int).
////
//// v6 remediation: collateral is bound to its loan via `loan_bound` (a loan
//// nullifier, NOT an amount — privacy-safe). Unlock requires loan_bound == None,
//// which only happens once the pool has settled the loan. `open_loans_root` is a
//// reserved MPF root for the global double-borrow guard, wired in Workstream C.

use ak_381/groth16.{Proof}
use cardano/transaction.{OutputReference}

/// Collateral deposit datum (v5/v6).
/// `commitment` = Poseidon255(collateral_amount, secret) as a BLS12-381 field
/// element, stored as Int so it can be passed straight to groth_verify.
/// `loan_bound`: None = free to unlock/withdraw; Some(loan_nullifier) = currently
/// backing an outstanding loan and therefore locked until that loan is settled.
pub type DepositDatumV5 {
  owner: ByteArray,
  collateral_amount: Int,
  commitment: Int,
  timestamp: Int,
  loan_bound: Option<Int>,
}

/// Lending pool datum (v5/v6).
/// `collateral_ratio` is the protocol LTV ratio used as a ZK public signal.
/// `vkey_ref` pins the reference UTxO that holds the trusted SnarkVerificationKey.
/// `open_loans_root` is the MPF root of currently-outstanding loan nullifiers
/// (reserved for the global double-borrow guard; preserved on every branch until
/// Workstream C wires the MPF insert/delete).
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  collateral_ratio: Int,
  vkey_ref: OutputReference,
  open_loans_root: ByteArray,
  last_updated: Int,
}

/// Lending pool redeemer (v5/v6). Borrow/Repay carry the Groth16 proof directly
/// plus the loan_nullifier that ties the loan to the collateral being locked/freed.
pub type PoolRedeemerV5 {
  Deposit
  BorrowAnonymous {
    collateral_ref: OutputReference,
    proof: Proof,
    loan_amount: Int,
    loan_nullifier: Int,
  }
  RepayAnonymous {
    deposit_ref: OutputReference,
    proof: Proof,
    repay_amount: Int,
    loan_nullifier: Int,
  }
}

/// Collateral redeemer (v5/v6).
/// - UsedAsCollateral locks the collateral to a loan (loan_bound None -> Some(n)).
/// - SettleLoan frees it (Some(n) -> None) and requires the pool to be repaying
///   the same loan in this transaction.
/// - UnlockDeposit spends the freed collateral, authorized by a ZK ownership
///   proof verified against the pool's trusted vkey (read via pool_ref).
pub type CollateralRedeemerV5 {
  Withdraw
  UsedAsCollateral { loan_nullifier: Int }
  SettleLoan { loan_nullifier: Int }
  UnlockDeposit { proof: Proof, pool_ref: OutputReference }
}
