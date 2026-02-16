/// ULTRA SIMPLE VALIDATOR
/// No datum, simple redeemer, only admin signature check
/// This is the absolute minimum to test if validator execution works

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

// Simple params: just admin key hash
pub type SimpleParams {
  admin_key_hash: ByteArray,
}

validator test_ultra_simple(params: SimpleParams) {
  spend(
    _datum: Option<Data>,  // Option wrapper required by Aiken
    _redeemer: Int,  // Just a simple number
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    // Only check: Admin signed this transaction?
    list.has(ctx.transaction.extra_signatories, params.admin_key_hash)
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
