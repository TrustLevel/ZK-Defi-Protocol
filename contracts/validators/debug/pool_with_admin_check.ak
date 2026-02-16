/// ============================================
/// POOL WITH ADMIN CHECK (Phase 2)
/// ============================================
/// Adds access control - only admin can borrow
/// Purpose: Test admin signature verification
///
/// Features:
/// - Structured datum: PoolDatum { total_borrowed: Int }
/// - Admin signature check (hardcoded key, no parameters!)
/// - First real validation logic
///
/// Test Scenarios:
/// 1. Admin signs and borrows → SUCCESS ✅
/// 2. User signs and borrows → FAIL ❌
///
/// This tests the access control mechanism

use aiken/collection/list
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}

/// Pool state tracking
pub type PoolDatum {
  total_borrowed: Int,  // Amount currently borrowed from pool
}

/// Empty redeemer type (simplest possible for PlutusV3 compatibility)
pub type VoidRedeemer {
  Void
}

validator pool_with_admin_check {
  spend(
    _datum: Option<PoolDatum>,
    _redeemer: VoidRedeemer,  // Simplest redeemer (fixes PlutusV3 serialization)
    _output_ref: OutputReference,
    ctx: ScriptContext,
  ) {
    // Hardcoded admin key (from preprod deployment)
    // This is the admin wallet's payment credential hash
    let admin_key_hash =
      #"6e05bb090a6a921d721d4da9b9b785a9686100b62ea16f69ddc8466b"

    // Check if admin signed this transaction
    let signed_by_admin =
      list.has(ctx.transaction.extra_signatories, admin_key_hash)

    // Only allow if admin signed
    signed_by_admin
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}
