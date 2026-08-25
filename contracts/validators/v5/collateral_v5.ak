//// ============================================
//// COLLATERAL V5 — ZK collateral verification (Milestone 3)
//// ============================================
//// Holds user collateral with a Poseidon255 commitment. Unlocking after an
//// anonymous loan is authorized by a Groth16 proof verified ON-CHAIN (proving
//// knowledge of the secret behind the commitment) — no admin signature.
//// Owner withdrawal of un-loaned collateral still uses an owner signature.

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Transaction}

use types_v5.{
  CollateralRedeemerV5, DepositDatumV5, UnlockDeposit, UsedAsCollateral, Withdraw,
}
use zk.{get_vkey, verify_collateral_proof}

/// Ratio used as the ZK public signal for a pure ownership (unlock) proof.
/// With loan_amount = collateral_amount and ratio = 100 the sufficiency
/// constraint (collateral*100 >= loan*ratio) holds with equality, so the proof
/// only attests knowledge of the secret behind the commitment.
const unlock_ratio: Int = 100

validator collateral_v5 {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == output_ref })

    when redeemer is {
      // Withdraw: owner reclaims un-loaned collateral (owner-authorized action).
      Withdraw -> list.has(tx.extra_signatories, collateral_datum.owner)?

      // UsedAsCollateral: collateral is locked/continued for a loan.
      UsedAsCollateral { loan_id } -> {
        let valid_loan_id = loan_id != #""
        expect Some(continuing_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == own_input.output.address },
          )
        let value_preserved =
          lovelace_of(continuing_output.value) >= lovelace_of(own_input.output.value)
        and {
          valid_loan_id?,
          value_preserved?,
        }
      }

      // UnlockDeposit: unlock after anonymous repayment, authorized by a ZK proof
      // that attests knowledge of the secret behind this deposit's commitment.
      UnlockDeposit { proof, vkey_ref } -> {
        let vkey = get_vkey(tx, vkey_ref)
        verify_collateral_proof(
          vkey,
          proof,
          collateral_datum.commitment,
          collateral_datum.collateral_amount,
          unlock_ratio,
        )?
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}
