/// ============================================
/// POOL ABSOLUTE MINIMUM
/// ============================================
/// The simplest possible pool validator
/// Purpose: Test that basic lock + spend works
///
/// NO parameters, NO enum redeemer, NO checks
/// Always returns True
///
/// Test Scenario:
/// 1. Lock 100 ADA with datum
/// 2. Spend 50 ADA with redeemer
/// Both should succeed

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

validator pool_absolute_minimum {
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
