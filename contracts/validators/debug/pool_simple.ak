//// ============================================
//// SIMPLE POOL - Absolute Minimum
//// ============================================
//// Deposit ADA, Withdraw ADA (admin only)

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use helpers.{get_own_input}

/// Simple Pool Datum
pub type SimplePoolDatum {
  admin_key_hash: ByteArray,
  total_deposited: Int,
}

/// Simple Pool Redeemer
pub type SimplePoolRedeemer {
  Deposit
  Withdraw { amount: Int }
}

/// Simple Pool Validator (NO PARAMETERS!)
validator pool_simple {
  spend(
    datum: Option<SimplePoolDatum>,
    redeemer: SimplePoolRedeemer,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    let tx = ctx.transaction
    expect Some(pool_datum) = datum
    let pool_input = get_own_input(tx, ctx.info)

    when redeemer is {
      // Deposit: Anyone can add ADA
      Deposit -> {
        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Get values
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let deposit_amount = output_lovelace - input_lovelace

        // Verify pool output datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: SimplePoolDatum = output_datum_data

        let expected_total = pool_datum.total_deposited + deposit_amount
        let datum_updated = output_datum.total_deposited == expected_total

        // Admin unchanged
        let admin_unchanged =
          output_datum.admin_key_hash == pool_datum.admin_key_hash

        and {
          deposit_amount > 0,
          datum_updated?,
          admin_unchanged?,
        }
      }

      // Withdraw: Only admin can withdraw
      Withdraw { amount } -> {
        // Verify admin signature
        let signed_by_admin =
          list.has(tx.extra_signatories, pool_datum.admin_key_hash)

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Get values
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let withdrawn = input_lovelace - output_lovelace

        // Verify amount matches
        let amount_correct = withdrawn == amount

        // Verify pool output datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: SimplePoolDatum = output_datum_data

        let expected_total = pool_datum.total_deposited - amount
        let datum_updated = output_datum.total_deposited == expected_total

        // Admin unchanged
        let admin_unchanged =
          output_datum.admin_key_hash == pool_datum.admin_key_hash

        and {
          signed_by_admin?,
          amount > 0,
          amount_correct?,
          datum_updated?,
          admin_unchanged?,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
