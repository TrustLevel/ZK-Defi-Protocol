/// Minimal Test Validator
/// Tests if Option<Datum> works with inline datums
///
/// Purpose: Isolate ERROR-009 root cause

use cardano/transaction.{OutputReference, Transaction}

/// Simple datum with just 2 fields
pub type SimpleDatum {
  value_a: Int,
  value_b: Int,
}

/// Simple redeemer
pub type SimpleRedeemer {
  Unlock { secret: Int }
}

/// Minimal validator - always succeeds if datum is present
validator test_minimal {
  spend(
    datum_opt: Option<SimpleDatum>,
    redeemer: SimpleRedeemer,
    _output_ref: OutputReference,
    _ctx: Transaction,
  ) {
    // Just verify datum exists
    expect Some(datum) = datum_opt

    // Verify datum has expected structure
    // If we can access these fields, deserialization worked!
    datum.value_a >= 0 && datum.value_b >= 0
  }

  else(_ctx) {
    fail @"Unsupported purpose"
  }
}
