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
//// Parameterised by `pool_script_hash` so the trusted pool datum (and thus the
//// trusted settlement vkey + repaid_root) is located via a reference input rather
//// than trusted from the redeemer.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use types_v5.{CollateralRedeemerV5, DepositDatumV5, PoolDatumV5, UnlockDeposit}
use zk.{get_vkey, verify_settlement_proof}

validator collateral_v5(pool_script_hash: ScriptHash) {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    _output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    let UnlockDeposit { proof, pool_ref } = redeemer

    // Locate the trusted pool datum via a reference input bound to the pool script.
    expect Some(pool_in) = find_reference_input(tx, pool_ref)
    expect is_at_script(pool_in.output, pool_script_hash)
    expect InlineDatum(pd_data) = pool_in.output.datum
    expect pool_datum: PoolDatumV5 = pd_data

    // Settlement proof: binds to this exact deposit (commitment) AND proves, in
    // zero knowledge, membership of the private repayment nullifier in repaid_root.
    // This is the entire unlock gate — no borrow-shared value is revealed.
    let vkey = get_vkey(tx, pool_datum.settlement_vkey_ref)
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

fn is_at_script(output: Output, script_hash: ScriptHash) -> Bool {
  when output.address.payment_credential is {
    Script(hash) -> hash == script_hash
    _ -> False
  }
}

fn find_reference_input(tx: Transaction, ref: OutputReference) -> Option<Input> {
  list.find(tx.reference_inputs, fn(i) { i.output_reference == ref })
}
