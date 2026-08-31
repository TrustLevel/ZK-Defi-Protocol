//// ============================================
//// COLLATERAL V5/V6 — ZK collateral verification (Milestone 3)
//// ============================================
//// Holds user collateral with a Poseidon255 commitment. A deposit is bound to a
//// loan via `loan_bound` (a loan nullifier — NOT an amount, so it is privacy-safe).
////
//// State machine (loan_bound):
////   None            -- free: may be Withdrawn (owner) or UnlockDeposited (proof)
////   Some(nullifier) -- locked to an outstanding loan; can only become free again
////                      via SettleLoan, which REQUIRES the pool to repay that same
////                      loan in the same transaction.
////
//// This closes the Reviewer-2 finding (unlock full collateral after partial/no
//// repayment): Unlock is only reachable once loan_bound == None, and the only
//// path to None is a pool repayment of the matching loan nullifier.
////
//// The validator is parameterised by `pool_script_hash` so it can (a) locate the
//// trusted pool datum (and thus the trusted vkey — no attacker-chosen vkey_ref)
//// and (b) verify the pool is genuinely repaying the loan on settlement.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction,
}
use types_v5.{
  CollateralRedeemerV5, DepositDatumV5, PoolDatumV5, PoolRedeemerV5,
  RepayAnonymous, SettleLoan, UnlockDeposit, UsedAsCollateral, Withdraw,
}
use zk.{get_vkey, verify_collateral_proof}

/// Ratio used as the ZK public signal for a pure ownership (unlock) proof.
/// With loan_amount = collateral_amount and ratio = 100 the sufficiency
/// constraint (collateral*100 >= loan*ratio) holds with equality, so the proof
/// only attests knowledge of the secret behind the commitment.
const unlock_ratio: Int = 100

validator collateral_v5(pool_script_hash: ScriptHash) {
  spend(
    datum: Option<DepositDatumV5>,
    redeemer: CollateralRedeemerV5,
    output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(collateral_datum) = datum
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == output_ref })

    when redeemer is {
      // Withdraw: owner reclaims un-loaned collateral. Only a FREE deposit.
      Withdraw ->
        and {
          list.has(tx.extra_signatories, collateral_datum.owner)?,
          (collateral_datum.loan_bound == None)?,
        }

      // UsedAsCollateral: lock a free deposit to a loan (None -> Some(nullifier)).
      // Safe to be permissive: locking only immobilises the owner's own funds.
      UsedAsCollateral { loan_nullifier } -> {
        expect Some(cont) = continuing_collateral(tx, own_input)
        expect InlineDatum(cont_data) = cont.datum
        expect cont_datum: DepositDatumV5 = cont_data
        and {
          (collateral_datum.loan_bound == None)?,
          (cont_datum.loan_bound == Some(loan_nullifier))?,
          (loan_nullifier != 0)?,
          datum_body_preserved(collateral_datum, cont_datum)?,
          (lovelace_of(cont.value) >= lovelace_of(own_input.output.value))?,
        }
      }

      // SettleLoan: free a locked deposit (Some(n) -> None). REQUIRES the pool to
      // repay the same loan nullifier in this transaction — this is the gate that
      // makes unlock-without-repayment impossible.
      SettleLoan { loan_nullifier } -> {
        expect Some(cont) = continuing_collateral(tx, own_input)
        expect InlineDatum(cont_data) = cont.datum
        expect cont_datum: DepositDatumV5 = cont_data
        and {
          (collateral_datum.loan_bound == Some(loan_nullifier))?,
          (cont_datum.loan_bound == None)?,
          datum_body_preserved(collateral_datum, cont_datum)?,
          (lovelace_of(cont.value) >= lovelace_of(own_input.output.value))?,
          pool_repays_nullifier(tx, pool_script_hash, loan_nullifier)?,
        }
      }

      // UnlockDeposit: spend a FREE (settled) deposit, authorized by a ZK
      // ownership proof verified against the pool's trusted vkey (read via the
      // pool reference input pinned by pool_ref, bound to pool_script_hash).
      UnlockDeposit { proof, pool_ref } -> {
        expect Some(pool_in) = find_reference_input(tx, pool_ref)
        expect is_at_script(pool_in.output, pool_script_hash)
        expect InlineDatum(pd_data) = pool_in.output.datum
        expect pool_datum: PoolDatumV5 = pd_data
        let vkey = get_vkey(tx, pool_datum.vkey_ref)
        and {
          (collateral_datum.loan_bound == None)?,
          verify_collateral_proof(
            vkey,
            proof,
            collateral_datum.commitment,
            collateral_datum.collateral_amount,
            unlock_ratio,
          )?,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}

/// The continuing collateral output (same script address as the spent input).
fn continuing_collateral(tx: Transaction, own_input: Input) -> Option<Output> {
  list.find(
    tx.outputs,
    fn(output) { output.address == own_input.output.address },
  )
}

/// Every immutable field of the deposit datum must survive a spend unchanged.
/// (loan_bound is the only field that legitimately transitions, handled per-branch.)
fn datum_body_preserved(old: DepositDatumV5, new: DepositDatumV5) -> Bool {
  and {
    new.owner == old.owner,
    new.collateral_amount == old.collateral_amount,
    new.commitment == old.commitment,
    new.timestamp == old.timestamp,
  }
}

/// True iff the output sits at the given script's payment credential.
fn is_at_script(output: Output, script_hash: ScriptHash) -> Bool {
  when output.address.payment_credential is {
    Script(hash) -> hash == script_hash
    _ -> False
  }
}

/// Find a reference input by its output reference.
fn find_reference_input(tx: Transaction, ref: OutputReference) -> Option<Input> {
  list.find(tx.reference_inputs, fn(i) { i.output_reference == ref })
}

/// True iff some spent pool input (at pool_script_hash) is being spent with a
/// RepayAnonymous redeemer for exactly `nullifier` — i.e. the loan is being repaid.
fn pool_repays_nullifier(
  tx: Transaction,
  pool_script_hash: ScriptHash,
  nullifier: Int,
) -> Bool {
  when list.find(tx.inputs, fn(i) { is_at_script(i.output, pool_script_hash) }) is {
    None -> False
    Some(pool_in) ->
      when
        list.find(
          tx.redeemers,
          fn(r) { r.1st == Spend(pool_in.output_reference) },
        )
      is {
        None -> False
        Some(pair) -> {
          expect pool_redeemer: PoolRedeemerV5 = pair.2nd
          when pool_redeemer is {
            RepayAnonymous { loan_nullifier, .. } -> loan_nullifier == nullifier
            _ -> False
          }
        }
      }
  }
}
