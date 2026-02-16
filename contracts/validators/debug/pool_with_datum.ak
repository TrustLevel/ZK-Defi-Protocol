/// ============================================
/// POOL WITH DATUM (Phase 1)
/// ============================================
/// Tests structured datum with one Int field
/// Purpose: Verify that custom datum types work
///
/// Datum Structure:
/// - total_borrowed: Int (tracks borrowed amount)
///
/// Validator Logic:
/// - Still returns True (no checks yet!)
/// - We just want to test if datum serialization works
///
/// Test Scenario:
/// 1. Lock 100 ADA with datum { total_borrowed: 0 }
/// 2. Spend 50 ADA with output datum { total_borrowed: 50 }
/// Both should succeed

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

/// Pool state tracking
pub type PoolDatum {
  total_borrowed: Int,  // Amount currently borrowed from pool
}

validator pool_with_datum {
  spend(
    _datum: Option<PoolDatum>,  // ← Structured datum (was: Option<Data>)
    _redeemer: Data,
    _output_ref: OutputReference,
    _ctx: ScriptContext,
  ) {
    // Still return True - no validation yet
    // We just want to test if the structured datum works
    True
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
