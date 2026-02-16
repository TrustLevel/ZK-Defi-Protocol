/// TEST WITH PARAMETERS
/// Uses DepositContractParams but simple datum and redeemer
/// Only checks admin signature

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use aiken/collection/list

pub type DepositContractParams {
  beacon_policy: ByteArray,
  admin_key_hash: ByteArray,
}

validator test_with_params(params: DepositContractParams) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    // Only check: Admin signature
    list.has(ctx.transaction.extra_signatories, params.admin_key_hash)
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
