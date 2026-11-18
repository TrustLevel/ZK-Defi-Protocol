//// ============================================
//// COLLATERAL V6 — private ZK collateral (Milestone 3)
//// ============================================
//// Holds user collateral (fixed denomination) with a Poseidon255 commitment.
//// There is no owner and no on-chain amount. A deposit is spent only via
//// UnlockDeposit, authorized by a SETTLEMENT proof: a single ZK proof that binds
//// to the spent commitment AND proves Merkle membership of a PRIVATE repayment
//// nullifier R = Poseidon255(secret, repay_external_nullifier) in the pool's
//// append-only `repaid_root`. A valid proof therefore exists only after the loan
//// was repaid and R was inserted into repaid_root.
////
//// This is the privacy-preserving successor to the v5 owner-signature unlock. It
//// preserves Reviewer-2's "no unlock after partial/no repayment" guarantee (an
//// empty / R-absent repaid_root makes the membership proof unsatisfiable) while
//// also closing Leak-2: the unlock redeemer no longer carries the borrow-time
//// loan_nullifier, and the proof's public signals share nothing with the borrow,
//// so borrow<->unlock is unlinkable.
////
//// Parameterised by the pool NFT policy and the settlement vkey reference. The
//// pool reference input is trusted only if it carries the one-shot pool NFT — a
//// UTxO someone merely paid to the pool address cannot supply a fake repaid_root.
//// The settlement vkey is fixed by parameter, never read from a datum.

use aiken/collection/list
use cardano/assets.{PolicyId, quantity_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use types_v5.{
  CollateralRedeemerV5, DepositDatumV5, PoolDatumV5, UnlockDeposit, pool_nft_name,
}
use zk.{get_vkey, verify_settlement_proof}

validator collateral_v5(
  pool_nft_policy: PolicyId,
  settlement_vkey_ref: OutputReference,
) {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    _output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    let UnlockDeposit { proof, pool_ref } = redeemer

    // Locate the trusted pool datum: the reference input must carry the pool NFT.
    expect Some(pool_in) = find_reference_input(tx, pool_ref)
    expect
      quantity_of(pool_in.output.value, pool_nft_policy, pool_nft_name) == 1
    expect InlineDatum(pd_data) = pool_in.output.datum
    expect pool_datum: PoolDatumV5 = pd_data

    // Settlement proof: binds to this exact deposit (commitment) AND proves, in
    // zero knowledge, membership of the private repayment nullifier in repaid_root.
    // This is the entire unlock gate — no borrow-shared value is revealed.
    let vkey = get_vkey(tx, settlement_vkey_ref)
    verify_settlement_proof(
      vkey,
      proof,
      collateral_datum.commitment,
      pool_datum.repaid_root,
      pool_datum.repay_external_nullifier,
    )?
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}

fn find_reference_input(tx: Transaction, ref: OutputReference) -> Option<Input> {
  list.find(tx.reference_inputs, fn(i) { i.output_reference == ref })
}
