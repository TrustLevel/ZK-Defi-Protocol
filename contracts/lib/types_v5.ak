//// ============================================
//// V6 TYPES — Private on-chain ZK lending (Milestone 3)
//// ============================================
//// The proof is the authorization: there is no admin and no signature on any
//// path. Privacy model:
////   - collateral_amount is NEVER on-chain (private circuit witness; the UTxO uses
////     a fixed denomination), so amounts are confidential.
////   - A collateral deposit goes through the pool (DepositCollateral): the pool
////     checks the fixed collateral denomination on-chain and appends the
////     commitment to `group_root` via a ZK append proof — permissionless.
////   - Borrow proves MEMBERSHIP of the commitment in `group_root` (Merkle) — it
////     does not reference a specific deposit UTxO, so deposit<->borrow is unlinkable.
////   - A loan is tracked by a `loan_nullifier` = Poseidon255(secret, external_nullifier)
////     in the pool's `open_loans`; repayment removes it. The nullifier also enters
////     the never-shrinking `used_nullifiers`, so one deposit backs exactly one loan.
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
//// signature.

use ak_381/groth16.{Proof}
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/transaction.{OutputReference}

/// Asset name of the one-shot pool NFT (see validators/v5/pool_nft.ak). The
/// pool UTxO carries it; the validators use it to recognise the real pool.
pub const pool_nft_name: ByteArray = "POOL"

/// Collateral deposit datum (v6). No amount — the commitment (Merkle leaf =
/// Poseidon255(collateral_amount, secret)), a timestamp, and `unlock_to`: the
/// address the collateral is paid to on unlock. Fixing the recipient at deposit
/// means a copied unlock proof cannot redirect the collateral (front-running);
/// it reveals nothing new, since unlock spends this very deposit anyway.
pub type DepositDatumV5 {
  commitment: Int,
  timestamp: Int,
  unlock_to: Address,
}

/// Lending pool datum (v6). The pool UTxO carries the one-shot pool NFT; the
/// verification keys are validator parameters, not datum fields.
/// `group_root`          -> append-only Merkle root of the collateral commitment
///                          set; grown PERMISSIONLESSLY by DepositCollateral via
///                          a ZK append proof (no admin)
/// `group_next_index`    -> next free leaf position in the group_root tree
/// `repaid_root`         -> append-only Merkle root of repayment nullifiers R;
///                          grown PERMISSIONLESSLY by Repay via a ZK append proof
///                          (no admin), so unlock can prove settlement in zero knowledge
/// `next_index`          -> next free leaf position in the repaid_root tree
/// `external_nullifier`  -> fixed protocol constant scoping loan nullifiers
/// `repay_external_nullifier` -> DISTINCT protocol constant scoping repayment
///                          nullifiers, so R cannot be correlated with the
///                          borrow-time loan_nullifier
/// `collateral_denomination` -> every collateral deposit is exactly this many
///                          lovelace (checked on-chain at DepositCollateral);
///                          Borrow checks it covers loan_denomination at the ratio
/// `loan_denomination`   -> every loan is exactly this size, so loan amounts are
///                          uniform (carry no per-loan information) and open_loans
///                          need only store nullifiers, not principals.
/// `open_loans`          -> outstanding loan nullifiers (what Repay may settle)
/// `used_nullifiers`     -> every loan nullifier ever borrowed against; never
///                          shrinks, so one deposit backs exactly ONE loan and a
///                          repaid deposit's R can never cover a later loan
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  collateral_ratio: Int,
  group_root: Int,
  group_next_index: Int,
  repaid_root: Int,
  next_index: Int,
  external_nullifier: Int,
  repay_external_nullifier: Int,
  collateral_denomination: Int,
  loan_denomination: Int,
  open_loans: List<Int>,
  used_nullifiers: List<Int>,
  last_updated: Int,
}

/// Lending pool redeemer (v6).
/// `AddLiquidity`: lender adds lovelace to the pool.
/// `DepositCollateral`: a collateral output of exactly `collateral_denomination`
/// with this `commitment` is created, and `append_proof` attests the commitment
/// is appended at `group_next_index`, taking group_root -> out.group_root.
/// `BorrowAnonymous`: the proof is bound to `recipient`; the loan must be paid
/// to that key (front-running protection).
/// `RepayAnonymous`: `proof` is a repay proof binding `loan_nullifier` AND
/// `repay_nullifier` to one secret. `repay_nullifier` = R = Poseidon255(secret, repay_external_nullifier);
/// `append_proof` attests R is appended at `next_index`, taking repaid_root ->
/// out.repaid_root (permissionless — no admin signature on repay).
pub type PoolRedeemerV5 {
  AddLiquidity
  DepositCollateral { commitment: Int, append_proof: Proof }
  BorrowAnonymous {
    proof: Proof,
    loan_amount: Int,
    loan_nullifier: Int,
    recipient: VerificationKeyHash,
  }
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
