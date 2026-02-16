/// MINIMAL TEST VERSION of lending_pool_v3
/// Same structure, but absolute minimum logic
/// Goal: Test if the basic validator structure works at all

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use types.{DepositContractParams, V3LendingPoolDatum}

validator test_pool_minimal(params: DepositContractParams) {
  spend(
    _datum: Option<V3LendingPoolDatum>,
    _redeemer: Int,  // Just a number (not the complex enum)
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    // ONLY check: Admin signature
    // That's it. Nothing else.
    list.has(ctx.transaction.extra_signatories, params.admin_key_hash)
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
