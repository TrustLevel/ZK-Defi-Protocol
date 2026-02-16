/// ============================================
/// MINIMAL TEST: Only Admin Signature Check
/// ============================================
/// Purpose: Test if Mesh.js can handle extra_signatories
///
/// This is the SIMPLEST possible validator that tests the problem:
/// - No datum
/// - No complex logic
/// - Just checks if admin signed the transaction
///
/// If this works with Mesh.js, we've proven ERROR-010 is solved!

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

validator test_only_admin_sig {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    // Hardcoded admin key hash (from preprod deployment)
    let admin_key_hash =
      #"6e05bb090a6a921d721d4da9b9b785a9686100b62ea16f69ddc8466b"

    // Check if admin signed this transaction
    // THIS IS THE CRITICAL LINE THAT FAILS WITH LUCID EVOLUTION!
    list.has(ctx.transaction.extra_signatories, admin_key_hash)
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
