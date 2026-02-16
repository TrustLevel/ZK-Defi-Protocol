//// ============================================
//// LENDING POOL V3.1 (NO PARAMETERS!)
//// ============================================
//// Privacy-enhanced lending pool WITHOUT parameterization
//// All configuration is stored IN THE DATUM instead of parameters
//// This allows single pool address + admin upgradability

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use helpers.{find_input_by_ref, get_own_input, verify_zk_proof_hash}
use types.{DepositDatum}

/// V3.1 Lending Pool Datum (with admin/beacon config)
pub type V3_1LendingPoolDatum {
  admin_key_hash: ByteArray,
  // Admin payment credential (for authorization)
  beacon_policy: ByteArray,
  // Beacon policy ID (for future features)
  total_deposited: Int,
  // Total ADA deposited
  total_borrowed: Int,
  // Total ADA borrowed
  interest_rate: Int,
  // Interest rate (basis points, e.g., 500 = 5%)
  last_updated: Int,
  // Unix timestamp (POSIXTime)
}

/// V3.1 Lending Pool Redeemer
pub type V3_1LendingPoolRedeemer {
  Deposit
  BorrowAnonymous {
    collateral_ref: OutputReference,
    zk_proof_hash: ByteArray,
    loan_amount: Int,
  }
  RepayAnonymous {
    deposit_ref: OutputReference,
    zk_proof_hash: ByteArray,
    repay_amount: Int,
  }
  UpdateAdmin { new_admin_key_hash: ByteArray }
}

/// V3.1 Lending Pool Validator (NO PARAMETERS!)
validator lending_pool_v3_1 {
  spend(
    datum: Option<V3_1LendingPoolDatum>,
    redeemer: V3_1LendingPoolRedeemer,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    let tx = ctx.transaction
    expect Some(pool_datum) = datum
    let pool_input = get_own_input(tx, ctx.info)

    when redeemer is {
      // Deposit: Anyone can deposit ADA into the pool
      Deposit -> {
        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool output datum exists and deposits increased
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3_1LendingPoolDatum = output_datum_data

        // Calculate deposit amount
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let deposit_amount = output_lovelace - input_lovelace

        // Verify deposit is positive and datum updated
        let expected_deposited = pool_datum.total_deposited + deposit_amount
        let datum_updated = output_datum.total_deposited == expected_deposited

        // Verify admin/beacon unchanged
        let config_unchanged =
          output_datum.admin_key_hash == pool_datum.admin_key_hash && output_datum.beacon_policy == pool_datum.beacon_policy

        and {
          deposit_amount > 0,
          datum_updated?,
          config_unchanged?,
        }
      }

      // BorrowAnonymous: Anonymous borrowing with ZK proof
      BorrowAnonymous { collateral_ref, zk_proof_hash, loan_amount } -> {
        // Verify admin signature (backend verified ZK proof off-chain)
        let signed_by_admin =
          list.has(tx.extra_signatories, pool_datum.admin_key_hash)

        // Verify ZK proof hash is valid
        let valid_proof_hash = verify_zk_proof_hash(zk_proof_hash)

        // Verify collateral input exists
        expect Some(collateral_input) = find_input_by_ref(tx, collateral_ref)

        // Verify collateral has valid deposit datum
        expect InlineDatum(collateral_datum_data) =
          collateral_input.output.datum
        expect collateral_datum: DepositDatum = collateral_datum_data

        // Verify loan amount is valid (max 80% LTV)
        let max_loan_amount = collateral_datum.collateral_amount * 80 / 100
        let loan_within_ltv = loan_amount <= max_loan_amount

        // Verify pool has sufficient liquidity
        let pool_balance = lovelace_of(pool_input.output.value)
        let available_liquidity = pool_balance - pool_datum.total_borrowed
        let sufficient_liquidity = loan_amount <= available_liquidity

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool output datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3_1LendingPoolDatum = output_datum_data

        let expected_borrowed = pool_datum.total_borrowed + loan_amount
        let datum_updated = output_datum.total_borrowed == expected_borrowed

        // Verify pool value decreased by loan amount
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let pool_decreased_correctly =
          output_lovelace == input_lovelace - loan_amount

        // Verify admin/beacon unchanged
        let config_unchanged =
          output_datum.admin_key_hash == pool_datum.admin_key_hash && output_datum.beacon_policy == pool_datum.beacon_policy

        and {
          signed_by_admin?,
          valid_proof_hash?,
          loan_within_ltv?,
          sufficient_liquidity?,
          datum_updated?,
          pool_decreased_correctly?,
          config_unchanged?,
        }
      }

      // RepayAnonymous: Anonymous repayment with ZK proof
      RepayAnonymous { deposit_ref, zk_proof_hash, repay_amount } -> {
        // Verify admin signature (backend verified ZK proof off-chain)
        let signed_by_admin =
          list.has(tx.extra_signatories, pool_datum.admin_key_hash)

        // Verify ZK proof hash is valid
        let valid_proof_hash = verify_zk_proof_hash(zk_proof_hash)

        // Verify deposit input exists
        expect Some(deposit_input) = find_input_by_ref(tx, deposit_ref)

        // Verify deposit has valid datum
        expect InlineDatum(deposit_datum_data) = deposit_input.output.datum
        expect _deposit_datum: DepositDatum = deposit_datum_data

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool output datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3_1LendingPoolDatum = output_datum_data

        let expected_borrowed = pool_datum.total_borrowed - repay_amount
        let datum_updated = output_datum.total_borrowed == expected_borrowed

        // Verify pool value increased by repay amount
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let pool_increased_correctly =
          output_lovelace == input_lovelace + repay_amount

        // Verify admin/beacon unchanged
        let config_unchanged =
          output_datum.admin_key_hash == pool_datum.admin_key_hash && output_datum.beacon_policy == pool_datum.beacon_policy

        and {
          signed_by_admin?,
          valid_proof_hash?,
          repay_amount > 0,
          datum_updated?,
          pool_increased_correctly?,
          config_unchanged?,
        }
      }

      // UpdateAdmin: Change admin key (only current admin can do this)
      UpdateAdmin { new_admin_key_hash } -> {
        // Verify current admin signature
        let signed_by_admin =
          list.has(tx.extra_signatories, pool_datum.admin_key_hash)

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool output datum updated with new admin
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3_1LendingPoolDatum = output_datum_data

        let admin_updated = output_datum.admin_key_hash == new_admin_key_hash

        // Verify everything else unchanged
        let state_unchanged =
          output_datum.total_deposited == pool_datum.total_deposited && output_datum.total_borrowed == pool_datum.total_borrowed && output_datum.interest_rate == pool_datum.interest_rate && output_datum.beacon_policy == pool_datum.beacon_policy

        // Verify pool value unchanged
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let value_unchanged = output_lovelace == input_lovelace

        and {
          signed_by_admin?,
          admin_updated?,
          state_unchanged?,
          value_unchanged?,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
