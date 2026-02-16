/// TEST WITH DATUM ONLY
/// Uses V3LendingPoolDatum but NO parameters
/// Always returns true (no checks)

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

pub type V3LendingPoolDatum {
  total_deposited: Int,
  total_borrowed: Int,
  interest_rate: Int,
  last_updated: Int,
}

validator test_with_datum {
  spend(
    _datum: Option<V3LendingPoolDatum>,
    _redeemer: Data,
    _output_ref: OutputReference,
    _ctx: ScriptContext,
  ) {
    // Always return true (no checks)
    True
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
