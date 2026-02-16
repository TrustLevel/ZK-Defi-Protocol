/// ABSOLUTE MINIMUM VALIDATOR
/// Returns true always
/// No complex types, no checks, nothing

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

validator test_absolute_minimum {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _output_ref: OutputReference,
    _ctx: ScriptContext,
  ) {
    // Always return true
    True
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
