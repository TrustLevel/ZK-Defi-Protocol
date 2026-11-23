//// ============================================
//// COLLATERAL V6 — private ZK collateral (Milestone 3)
//// ============================================
//// Holds user collateral (the fixed denomination of one accepted collateral
//// asset) with a Poseidon255 commitment. There is no owner, and neither the
//// amount nor the asset is in the datum. A deposit is spent only via
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
//// The unlock pays the full value of the deposit (its asset and its min ADA) to
//// the deposit's `unlock_to` address in
//// an output tagged (inline datum) with the spent deposit's OutputReference, so
//// a copied proof cannot redirect the funds and one output cannot settle two
//// deposits (double satisfaction).
////
//// Parameterised by the pool NFT policy and the settlement vkey reference. The
//// pool reference input is trusted only if it carries the one-shot pool NFT — a
//// UTxO someone merely paid to the pool address cannot supply a fake repaid_root.
//// The settlement vkey is fixed by parameter, never read from a datum.

use aiken/collection/list
use cardano/address.{Address}
use cardano/assets.{PolicyId, Value, quantity_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use types_v5.{
  CollateralRedeemerV5, DepositDatumV5, PoolDatumV5, UnlockDeposit,
  pool_nft_name,
}
use zk.{get_vkey, verify_settlement_proof}

validator collateral_v5(
  pool_nft_policy: PolicyId,
  settlement_vkey_ref: OutputReference,
) {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    let UnlockDeposit { proof, pool_ref } = redeemer
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == output_ref })

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
    and {
      verify_settlement_proof(
        vkey,
        proof,
        collateral_datum.commitment,
        pool_datum.repaid_root,
        pool_datum.repay_external_nullifier,
      )?,
      pays_recipient(
        tx,
        collateral_datum.unlock_to,
        own_input.output.value,
        output_ref,
      )?,
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}

/// Some output pays at least the whole `value` (every asset in it) to `to`,
/// tagged with the spent deposit's reference as inline datum (one output per
/// deposit).
fn pays_recipient(
  tx: Transaction,
  to: Address,
  value: Value,
  tag: OutputReference,
) -> Bool {
  list.any(
    tx.outputs,
    fn(output) {
      and {
        output.address == to,
        contains(output.value, value),
        output.datum == InlineDatum(tag),
      }
    },
  )
}

/// `outer` holds at least every asset of `inner`.
fn contains(outer: Value, inner: Value) -> Bool {
  list.all(
    assets.flatten(inner),
    fn(entry) {
      let (policy, name, qty) = entry
      quantity_of(outer, policy, name) >= qty
    },
  )
}

fn find_reference_input(tx: Transaction, ref: OutputReference) -> Option<Input> {
  list.find(tx.reference_inputs, fn(i) { i.output_reference == ref })
}
