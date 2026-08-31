//// ============================================
//// V6 TYPES — Private on-chain ZK lending (Milestone 3)
//// ============================================
//// The proof is the authorization: no admin signature / extra_signatories on the
//// anonymous paths. Privacy model:
////   - collateral_amount is NEVER on-chain (private circuit witness; the UTxO uses
////     a fixed denomination), so amounts are confidential.
////   - Borrow proves MEMBERSHIP of the commitment in `group_root` (Merkle) — it
////     does not reference a specific deposit UTxO, so deposit<->borrow is unlinkable.
////   - A loan is tracked by a `loan_nullifier` = Poseidon255(secret, external_nullifier)
////     in the pool's `open_loans`; repayment removes it and gates unlock.
//// Unlock binds to the SPECIFIC deposit (commitment public) so nobody can unlock
//// another user's collateral; it is only permitted once the loan nullifier is
//// settled (absent from open_loans).

use ak_381/groth16.{Proof}
use cardano/transaction.{OutputReference}

/// Collateral deposit datum (v6). No owner, no amount — only the commitment
/// (Merkle leaf = Poseidon255(collateral_amount, secret)) and a timestamp.
pub type DepositDatumV5 {
  commitment: Int,
  timestamp: Int,
}

/// Lending pool datum (v6).
/// `vkey_ref`        -> borrow/repay membership circuit verification key
/// `unlock_vkey_ref` -> unlock (commitment-bound) circuit verification key
/// `group_root`      -> Merkle root of the collateral commitment set
/// `external_nullifier` -> fixed protocol constant scoping loan nullifiers
/// `loan_denomination` -> every loan is exactly this size, so loan amounts are
///                        uniform (carry no per-loan information) and open_loans
///                        need only store nullifiers, not principals.
/// `open_loans`      -> outstanding loan nullifiers (double-spend + settlement gate)
/// `admin`           -> may update the published group_root
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  collateral_ratio: Int,
  vkey_ref: OutputReference,
  unlock_vkey_ref: OutputReference,
  group_root: Int,
  external_nullifier: Int,
  loan_denomination: Int,
  open_loans: List<Int>,
  admin: ByteArray,
  last_updated: Int,
}

/// Lending pool redeemer (v6).
pub type PoolRedeemerV5 {
  Deposit
  SetGroupRoot { new_root: Int }
  BorrowAnonymous { proof: Proof, loan_amount: Int, loan_nullifier: Int }
  RepayAnonymous { proof: Proof, repay_amount: Int, loan_nullifier: Int }
}

/// Collateral redeemer (v6). Unlock spends the deposit with a commitment-bound
/// proof and the loan nullifier that must be settled in the pool (read via pool_ref).
pub type CollateralRedeemerV5 {
  UnlockDeposit { proof: Proof, pool_ref: OutputReference, loan_nullifier: Int }
}
