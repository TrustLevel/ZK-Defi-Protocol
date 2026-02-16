/// Test Validator WITHOUT Option<Datum>
/// Tests if we can avoid the Option wrapper

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

/// Test validator WITHOUT Option<Datum>
validator test_no_option {
  spend(
    datum: Option<SimpleDatum>,  // ← Aiken requires Option<T>
    redeemer: SimpleRedeemer,
    _output_ref: OutputReference,
    _ctx: Transaction,
  ) {
    // Extract datum from Option
    expect Some(d) = datum
    d.value_a >= 0 && d.value_b >= 0
  }

  else(_ctx) {
    fail @"Unsupported purpose"
  }
}
