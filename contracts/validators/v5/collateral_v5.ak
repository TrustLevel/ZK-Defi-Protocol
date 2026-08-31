//// ============================================
//// COLLATERAL V6 — private ZK collateral (Milestone 3)
//// ============================================
//// Holds user collateral (fixed denomination) with a Poseidon255 commitment.
//// There is no owner and no on-chain amount. A deposit is spent only via
//// UnlockDeposit, authorized by a commitment-bound ZK proof AND gated on the
//// loan being settled: the proof derives the loan nullifier, which must be
//// ABSENT from the pool's open-loans set (i.e. never borrowed, or fully repaid).
////
//// This is the privacy-preserving successor to the v5 owner-signature unlock and
//// the direct fix for Reviewer-2's "unlock full collateral after partial/no
//// repayment": the nullifier only leaves open_loans on a valid repayment.
////
//// Parameterised by `pool_script_hash` so the trusted pool datum (and thus the
//// trusted unlock vkey + open-loans set) is located via a reference input rather
//// than trusted from the redeemer.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use types_v5.{CollateralRedeemerV5, DepositDatumV5, PoolDatumV5, UnlockDeposit}
use zk.{get_vkey, verify_unlock_proof}

validator collateral_v5(pool_script_hash: ScriptHash) {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    _output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    let UnlockDeposit { proof, pool_ref, loan_nullifier } = redeemer

    // Locate the trusted pool datum via a reference input bound to the pool script.
    expect Some(pool_in) = find_reference_input(tx, pool_ref)
    expect is_at_script(pool_in.output, pool_script_hash)
    expect InlineDatum(pd_data) = pool_in.output.datum
    expect pool_datum: PoolDatumV5 = pd_data

    // Commitment-bound ownership proof, deriving the loan nullifier.
    let vkey = get_vkey(tx, pool_datum.unlock_vkey_ref)
    let proof_ok =
      verify_unlock_proof(
        vkey,
        proof,
        collateral_datum.commitment,
        loan_nullifier,
        pool_datum.external_nullifier,
      )

    // Repayment gate: the loan must be settled (nullifier absent from open_loans).
    let settled = !has_nullifier(pool_datum.open_loans, loan_nullifier)

    and {
      proof_ok?,
      settled?,
    }
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

fn has_nullifier(loans: List<Int>, n: Int) -> Bool {
  list.has(loans, n)
}
