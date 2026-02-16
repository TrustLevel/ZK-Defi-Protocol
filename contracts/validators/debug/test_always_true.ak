/// ============================================
/// ALWAYS TRUE VALIDATOR (für Mesh.js spend test)
/// ============================================
/// Purpose: Test basic PlutusV3 spending with Mesh.js
/// No logic - just returns True
/// This establishes the baseline before adding extra_signatories

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

validator test_always_true {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _output_ref: OutputReference,
    _ctx: ScriptContext,
  ) {
    // Always return True - no checks at all
    True
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
