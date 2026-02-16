/// SIMPLE TEST VALIDATOR
/// Just spend pool and send 10 ADA somewhere
/// No complex logic, just test if spending works at all

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use types.{DepositContractParams, V3LendingPoolDatum}

validator test_simple_spend(params: DepositContractParams) {
  spend(
    _datum: Option<V3LendingPoolDatum>,
    _redeemer: Int,  // Just a simple Int redeemer
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    let tx = ctx.transaction

    // Only check: Admin signature
    list.has(tx.extra_signatories, params.admin_key_hash)
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
