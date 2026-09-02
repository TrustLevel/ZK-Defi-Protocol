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
////     in the pool's `open_loans`; repayment removes it (double-borrow gate).
//// Unlock binds to the SPECIFIC deposit (commitment public) so nobody can unlock
//// another user's collateral, and proves loan-settlement in ZERO KNOWLEDGE: it
//// proves Merkle membership of a PRIVATE repayment nullifier
//// R = Poseidon255(secret, repay_external_nullifier) in the append-only
//// `repaid_root`. Unlock's public signals are [commitment, repaid_root,
//// repay_external_nullifier] — none shared with borrow, so borrow<->unlock is
//// unlinkable (closes the Leak-2 vector where the old redeemer revealed the
//// borrow-time loan_nullifier).
//// Repay inserts R into `repaid_root` ITSELF via a zero-knowledge append proof
//// (permissionless — no admin), so the whole borrow/repay/unlock path needs no
//// signature. `group_root` (the deposit anonymity set) stays admin-curated.

use ak_381/groth16.{Proof}
use cardano/transaction.{OutputReference}

/// Collateral deposit datum (v6). No owner, no amount — only the commitment
/// (Merkle leaf = Poseidon255(collateral_amount, secret)) and a timestamp.
pub type DepositDatumV5 {
  commitment: Int,
  timestamp: Int,
}

/// Lending pool datum (v6).
/// `vkey_ref`            -> borrow/repay membership circuit verification key
/// `settlement_vkey_ref` -> unlock settlement circuit verification key
/// `append_vkey_ref`     -> repay-time append circuit verification key
/// `group_root`          -> Merkle root of the collateral commitment set
///                          (admin-curated for M3, via SetGroupRoot)
/// `repaid_root`         -> append-only Merkle root of repayment nullifiers R;
///                          grown PERMISSIONLESSLY by Repay via a ZK append proof
///                          (no admin), so unlock can prove settlement in zero knowledge
/// `next_index`          -> next free leaf position in the repaid_root tree
/// `external_nullifier`  -> fixed protocol constant scoping loan nullifiers
/// `repay_external_nullifier` -> DISTINCT protocol constant scoping repayment
///                          nullifiers, so R cannot be correlated with the
///                          borrow-time loan_nullifier
/// `loan_denomination`   -> every loan is exactly this size, so loan amounts are
///                          uniform (carry no per-loan information) and open_loans
///                          need only store nullifiers, not principals.
/// `open_loans`          -> outstanding loan nullifiers (double-borrow gate)
/// `admin`               -> may update the published group_root (SetGroupRoot)
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  collateral_ratio: Int,
  vkey_ref: OutputReference,
  settlement_vkey_ref: OutputReference,
  append_vkey_ref: OutputReference,
  group_root: Int,
  repaid_root: Int,
  next_index: Int,
  external_nullifier: Int,
  repay_external_nullifier: Int,
  loan_denomination: Int,
  open_loans: List<Int>,
  admin: ByteArray,
  last_updated: Int,
}

/// Lending pool redeemer (v6).
/// `RepayAnonymous`: `repay_nullifier` = R = Poseidon255(secret, repay_external_nullifier);
/// `append_proof` attests R is appended at `next_index`, taking repaid_root ->
/// out.repaid_root (permissionless — no admin signature on repay).
pub type PoolRedeemerV5 {
  Deposit
  SetGroupRoot { new_root: Int }
  BorrowAnonymous { proof: Proof, loan_amount: Int, loan_nullifier: Int }
  RepayAnonymous {
    proof: Proof,
    repay_amount: Int,
    loan_nullifier: Int,
    repay_nullifier: Int,
    append_proof: Proof,
  }
}

/// Collateral redeemer (v6). Unlock spends the deposit with a settlement proof
/// (commitment-bound + Merkle membership of the private R in the pool's
/// `repaid_root`, read via pool_ref). Carries NO borrow-shared value.
pub type CollateralRedeemerV5 {
  UnlockDeposit { proof: Proof, pool_ref: OutputReference }
}
