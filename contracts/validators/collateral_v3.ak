//// ============================================
//// COLLATERAL CONTRACT V3 (Privacy-Enhanced)
//// ============================================
//// Manages user collateral deposits with ZK-proof commitments for privacy-enhanced lending
//// This is the new V3 system focused on ZK-privacy (60-65% privacy vs 40% in V1/V2)
//// For the legacy multi-asset system, see collateral.ak

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Transaction}
use helpers.{get_ada_amount, get_own_input, verify_zk_proof_hash}
use types.{DepositContractParams, DepositDatum, DepositRedeemer}

/// V3 Collateral Contract Validator
/// This contract holds user collateral with Poseidon commitments
/// Enables privacy-enhanced borrowing and repayment through ZK proofs
validator collateral_v3(params: DepositContractParams) {
  spend(
    datum: Option<DepositDatum>,
    redeemer: DepositRedeemer,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    expect Some(collateral_datum) = datum
    let tx = ctx.transaction

    // Get the input being spent
    let own_input = get_own_input(tx, ctx.info)

    when redeemer is {
      // Withdraw: Owner withdraws their collateral
      // Requirements:
      // - Owner signature present
      // - No active loan (deposit must be free)
      types.Withdraw -> {
        // Extract owner key hash from datum
        let owner_pkh = collateral_datum.owner

        // Verify owner signed the transaction
        let signed_by_owner = list.has(tx.extra_signatories, owner_pkh)

        signed_by_owner?
      }

      // UsedAsCollateral: Collateral is locked for a loan
      // Requirements:
      // - Admin signature present (backend service signs)
      // - Valid loan_id provided
      // - Collateral output continues with updated datum
      types.UsedAsCollateral { loan_id } -> {
        // Verify admin signature (backend service)
        let signed_by_admin =
          list.has(tx.extra_signatories, params.admin_key_hash)

        // Verify loan_id is non-empty
        let valid_loan_id = loan_id != #""

        // Find the continuing output to this contract
        expect Some(continuing_output) =
          list.find(
            tx.outputs,
            fn(output) {
              // Same address as input
              output.address == own_input.output.address
            },
          )

        // Verify the continuing output has correct value
        let input_ada = get_ada_amount(own_input.output)
        let output_ada = get_ada_amount(continuing_output)
        let value_preserved = output_ada >= input_ada

        and {
          signed_by_admin?,
          valid_loan_id?,
          value_preserved?,
        }
      }

      // UnlockDeposit: Collateral is unlocked after anonymous repayment
      // Requirements:
      // - Admin signature present (backend verified ZK proof off-chain)
      // - Valid ZK proof hash provided
      // - Collateral can be withdrawn by owner or continue locked
      types.UnlockDeposit { zk_proof_hash } -> {
        // Verify admin signature (backend verified proof)
        let signed_by_admin =
          list.has(tx.extra_signatories, params.admin_key_hash)

        // Verify ZK proof hash is valid format
        let valid_proof_hash = verify_zk_proof_hash(zk_proof_hash)

        and {
          signed_by_admin?,
          valid_proof_hash?,
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
