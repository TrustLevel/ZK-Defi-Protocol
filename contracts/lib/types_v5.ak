//// ============================================
//// V6 TYPES — Private on-chain ZK lending (Milestone 3)
//// ============================================
//// The proof is the authorization: there is no admin and no signature on any
//// path. Privacy model:
////   - Every amount is a fixed denomination of the pool, so amounts carry no
////     per-position information.
////   - A pool lends one asset (`loan_asset`, ADA or a native token) and accepts
////     several collateral assets (`collateral_assets`), each with its own fixed
////     denomination. Deposits of all of them share one commitment set, and every
////     leaf has the same form Poseidon255(COLLATERAL_LEAF_TAG, secret), so a
////     loan does not reveal which asset backs it.
////   - A collateral deposit goes through the pool (DepositCollateral): the pool
////     checks the denomination of the named asset on-chain and appends the
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

use aiken/crypto.{VerificationKeyHash}
use ak_381/groth16.{Proof}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference}

/// Asset name of the one-shot pool NFT (see validators/v5/pool_nft.ak). The
/// pool UTxO carries it; the validators use it to recognise the real pool.
pub const pool_nft_name: ByteArray = "POOL"

/// A native asset, or ADA as ("", "").
pub type Asset {
  policy_id: PolicyId,
  asset_name: AssetName,
}

/// An accepted collateral asset and the fixed amount every deposit of it locks.
pub type CollateralAsset {
  policy_id: PolicyId,
  asset_name: AssetName,
  denomination: Int,
}

/// Collateral deposit datum (v6). No amount and no asset — the commitment
/// (Merkle leaf = Poseidon255(COLLATERAL_LEAF_TAG, secret)), a timestamp, and `unlock_to`: the
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
/// `loan_asset`          -> the asset the pool lends: liquidity, loans,
///                          repayments and shares are all measured in it
/// `collateral_assets`   -> accepted collateral assets with their fixed
///                          denominations (checked on-chain at DepositCollateral).
///                          Each denomination is chosen at init to cover one loan;
///                          the pool has no price feed
/// `loan_denomination`   -> every loan is exactly this size (in loan_asset), so loan amounts are
///                          uniform (carry no per-loan information) and open_loans
///                          need only store nullifiers, not principals.
/// `open_loans`          -> outstanding loan nullifiers (what Repay may settle)
/// `used_nullifiers`     -> every loan nullifier ever borrowed against; never
///                          shrinks, so one deposit backs exactly ONE loan and a
///                          repaid deposit's R can never cover a later loan
///
/// Lender side (one lender note = one pool share):
/// `total_deposited`     -> cumulative loan_asset paid in by AddLiquidity
/// `lender_root`         -> append-only Merkle root of lender note leaves; grown by
///                          AddLiquidity via a ZK append proof
/// `lender_next_index`   -> next free leaf position in the lender tree
/// `total_shares`        -> shares outstanding (notes added minus notes withdrawn)
/// `lender_nullifiers`   -> withdraw nullifiers W of notes already paid out; never
///                          shrinks, so each note pays out once
/// `lender_external_nullifier` -> protocol constant scoping W
/// `share_start_price`   -> price of a share while no share is outstanding
/// `liquidity_reserve`   -> loan_asset that stays in the pool UTxO (for an ADA
///                          pool its min UTxO); neither lendable nor part of the
///                          share value. A token pool's ADA is not loan_asset and
///                          never moves, so its reserve can be 0
/// Share value = pool balance - liquidity_reserve + total_borrowed (outstanding
/// loans are pool assets). Free liquidity = pool balance - liquidity_reserve,
/// with the balance measured in loan_asset.
pub type PoolDatumV5 {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  group_root: Int,
  group_next_index: Int,
  repaid_root: Int,
  next_index: Int,
  external_nullifier: Int,
  repay_external_nullifier: Int,
  loan_asset: Asset,
  collateral_assets: List<CollateralAsset>,
  loan_denomination: Int,
  open_loans: List<Int>,
  used_nullifiers: List<Int>,
  last_updated: Int,
  lender_root: Int,
  lender_next_index: Int,
  total_shares: Int,
  lender_nullifiers: List<Int>,
  lender_external_nullifier: Int,
  share_start_price: Int,
  liquidity_reserve: Int,
}

/// Lending pool redeemer (v6).
/// `AddLiquidity`: a lender buys one share: pays exactly the current share price
/// (rounded up) and `append_proof` attests the note leaf `commitment` is appended
/// at `lender_next_index`, taking lender_root -> out.lender_root.
/// `WithdrawLiquidity`: `proof` attests a note in `lender_root` with withdraw
/// nullifier `withdraw_nullifier`, bound to `recipient`; the pool pays the current
/// share price (rounded down) to that key, from free liquidity.
/// `DepositCollateral`: a collateral output of exactly the denomination of
/// `collateral_assets[asset_index]` with this `commitment` is created, and `append_proof` attests the commitment
/// is appended at `group_next_index`, taking group_root -> out.group_root.
/// `BorrowAnonymous`: the proof is bound to `recipient`; the loan (exactly
/// `loan_denomination`) must be paid to that key (front-running protection).
/// `RepayAnonymous`: pays exactly principal + interest. `proof` is a repay proof binding `loan_nullifier` AND
/// `repay_nullifier` to one secret. `repay_nullifier` = R = Poseidon255(secret, repay_external_nullifier);
/// `append_proof` attests R is appended at `next_index`, taking repaid_root ->
/// out.repaid_root (permissionless — no admin signature on repay).
pub type PoolRedeemerV5 {
  AddLiquidity { commitment: Int, append_proof: Proof }
  DepositCollateral { commitment: Int, asset_index: Int, append_proof: Proof }
  BorrowAnonymous {
    proof: Proof,
    loan_nullifier: Int,
    recipient: VerificationKeyHash,
  }
  RepayAnonymous {
    proof: Proof,
    loan_nullifier: Int,
    repay_nullifier: Int,
    append_proof: Proof,
  }
  WithdrawLiquidity {
    proof: Proof,
    withdraw_nullifier: Int,
    recipient: VerificationKeyHash,
  }
}

/// Collateral redeemer (v6). Unlock spends the deposit with a settlement proof
/// (commitment-bound + Merkle membership of the private R in the pool's
/// `repaid_root`, read via pool_ref). Carries NO borrow-shared value.
pub type CollateralRedeemerV5 {
  UnlockDeposit { proof: Proof, pool_ref: OutputReference }
}
