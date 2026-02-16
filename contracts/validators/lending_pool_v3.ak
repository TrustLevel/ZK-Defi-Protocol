//// ============================================
//// LENDING POOL V3 (Privacy-Enhanced)
//// ============================================
//// Supports anonymous borrowing and repayment with ZK proof verification
//// Works with collateral_v3.ak for ZK-privacy features (60-65% privacy vs 40% in V1/V2)
//// For the legacy multi-asset lending pool, see lending_pool.ak

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use helpers.{find_input_by_ref, get_own_input, verify_zk_proof_hash}
use types.{
  DepositContractParams, DepositDatum, V3LendingPoolDatum, V3LendingPoolRedeemer,
}

/// V3 Lending Pool Validator
/// Manages the shared lending pool for privacy-enhanced anonymous borrowing
/// NOTE: Uses DepositContractParams/DepositDatum types which semantically represent collateral
validator lending_pool_v3(params: DepositContractParams) {
  spend(
    datum: Option<V3LendingPoolDatum>,
    redeemer: V3LendingPoolRedeemer,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    expect Some(pool_datum) = datum
    let tx = ctx.transaction

    // Get the pool input being spent
    let pool_input = get_own_input(tx, ctx.info)

    when redeemer is {
      // Deposit: Add liquidity to the pool
      // Requirements:
      // - Admin signature (to control pool deposits)
      // - Pool output continues with updated datum
      types.Deposit -> {
        // Verify admin signature
        let signed_by_admin =
          list.has(tx.extra_signatories, params.admin_key_hash)

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool value increased
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let pool_increased = output_lovelace > input_lovelace

        // Verify datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3LendingPoolDatum = output_datum_data

        let datum_valid =
          output_datum.total_deposited >= pool_datum.total_deposited

        and {
          signed_by_admin?,
          pool_increased?,
          datum_valid?,
        }
      }

      // BorrowAnonymous: Anonymous borrowing with ZK proof
      // Requirements:
      // - Admin signature (backend verified ZK proof off-chain)
      // - Valid collateral reference
      // - Valid ZK proof hash
      // - Loan amount within limits
      // - Pool has sufficient liquidity
      types.BorrowAnonymous { collateral_ref, zk_proof_hash, loan_amount } -> {
        // Verify admin signature (backend verified proof)
        let signed_by_admin =
          list.has(tx.extra_signatories, params.admin_key_hash)

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
        // Use actual pool balance (includes initial liquidity + user deposits)
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
        expect output_datum: V3LendingPoolDatum = output_datum_data

        let expected_borrowed = pool_datum.total_borrowed + loan_amount
        let datum_updated = output_datum.total_borrowed == expected_borrowed

        // Verify pool value decreased by loan amount
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let pool_decreased_correctly =
          output_lovelace == input_lovelace - loan_amount

        and {
          signed_by_admin?,
          valid_proof_hash?,
          loan_within_ltv?,
          sufficient_liquidity?,
          datum_updated?,
          pool_decreased_correctly?,
        }
      }

      // RepayAnonymous: Anonymous repayment with ZK proof
      // Requirements:
      // - Admin signature (backend verified ZK proof off-chain)
      // - Valid deposit reference
      // - Valid ZK proof hash
      // - Repayment amount correct (principal + interest)
      // - Pool receives repayment
      types.RepayAnonymous { deposit_ref, zk_proof_hash, repay_amount } -> {
        // Verify admin signature (backend verified proof)
        let signed_by_admin =
          list.has(tx.extra_signatories, params.admin_key_hash)

        // Verify ZK proof hash is valid
        let valid_proof_hash = verify_zk_proof_hash(zk_proof_hash)

        // Verify deposit input exists
        expect Some(deposit_input) = find_input_by_ref(tx, deposit_ref)

        // Verify deposit has valid datum
        expect InlineDatum(deposit_datum_data) = deposit_input.output.datum
        expect deposit_datum: DepositDatum = deposit_datum_data

        // Calculate expected repayment (principal + interest)
        // Interest rate from pool datum (in basis points)
        let loan_amount = deposit_datum.collateral_amount * 80 / 100
        let interest = loan_amount * pool_datum.interest_rate / 10000
        let expected_repayment = loan_amount + interest

        // Verify repayment amount is sufficient
        let repayment_sufficient = repay_amount >= expected_repayment

        // Find continuing pool output
        expect Some(pool_output) =
          list.find(
            tx.outputs,
            fn(output) { output.address == pool_input.output.address },
          )

        // Verify pool output datum updated
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: V3LendingPoolDatum = output_datum_data

        let expected_borrowed = pool_datum.total_borrowed - loan_amount
        let datum_updated = output_datum.total_borrowed == expected_borrowed

        // Verify pool value increased by repayment amount
        let input_lovelace = lovelace_of(pool_input.output.value)
        let output_lovelace = lovelace_of(pool_output.value)
        let pool_increased_correctly =
          output_lovelace == input_lovelace + repay_amount

        and {
          signed_by_admin?,
          valid_proof_hash?,
          repayment_sufficient?,
          datum_updated?,
          pool_increased_correctly?,
        }
      }
    }
  }

  /// Other purposes not supported
  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}
//
// ========== Unit Tests ==========
// Comprehensive tests will be added in separate test files
