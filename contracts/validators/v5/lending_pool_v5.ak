//// ============================================
//// LENDING POOL V5 — real on-chain ZK verification (Milestone 3)
//// ============================================
//// Anonymous borrow/repay authorized by a Groth16 proof verified ON-CHAIN via
//// modulo-p/ak-381. No admin signature / extra_signatories: the proof is the
//// authorization. Public signals are bound to trusted on-chain state:
////   commitment      <- referenced collateral UTxO's DepositDatumV5.commitment
////   loan/repay_amt  <- redeemer amount, cross-checked against the pool delta
////   collateral_ratio<- pool datum (protocol config)
//// The verification key is read from the reference input pinned in the pool datum.

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{Input, InlineDatum, Output, OutputReference, Transaction}
use helpers.{find_input_by_ref}
use types_v5.{
  BorrowAnonymous, Deposit, DepositDatumV5, PoolDatumV5, PoolRedeemerV5,
  RepayAnonymous,
}
use zk.{get_vkey, verify_collateral_proof}

validator lending_pool_v5 {
  spend(
    datum: Option<PoolDatumV5>,
    redeemer: PoolRedeemerV5,
    output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(pool_datum) = datum
    expect Some(pool_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == output_ref })

    when redeemer is {
      // Deposit: anyone may add liquidity (increases pool value). Datum continues.
      Deposit -> {
        expect Some(pool_output) = continuing_pool_output(tx, pool_input)
        let pool_in = lovelace_of(pool_input.output.value)
        let pool_out = lovelace_of(pool_output.value)
        let delta = pool_out - pool_in
        let pool_increased = delta > 0

        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: PoolDatumV5 = output_datum_data

        // A3: exact deposit accounting; borrowed untouched; protocol config preserved
        let deposited_updated =
          output_datum.total_deposited == pool_datum.total_deposited + delta
        let borrowed_unchanged =
          output_datum.total_borrowed == pool_datum.total_borrowed

        and {
          pool_increased?,
          deposited_updated?,
          borrowed_unchanged?,
          pool_config_preserved(pool_datum, output_datum)?,
        }
      }

      // BorrowAnonymous: ZK proof authorizes the loan, verified on-chain.
      BorrowAnonymous { collateral_ref, proof, loan_amount } -> {
        // Trusted verification key (pinned in pool datum -> reference input)
        let vkey = get_vkey(tx, pool_datum.vkey_ref)

        // Commitment comes from the referenced collateral UTxO, not the redeemer
        let commitment = referenced_commitment(tx, collateral_ref)

        // REAL on-chain zk-SNARK verification, bound to on-chain data
        let proof_ok =
          verify_collateral_proof(
            vkey,
            proof,
            commitment,
            loan_amount,
            pool_datum.collateral_ratio,
          )

        // Pool liquidity + continuity
        let pool_balance = lovelace_of(pool_input.output.value)
        let sufficient_liquidity =
          loan_amount <= pool_balance - pool_datum.total_borrowed

        expect Some(pool_output) = continuing_pool_output(tx, pool_input)
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: PoolDatumV5 = output_datum_data

        let borrowed_updated =
          output_datum.total_borrowed == pool_datum.total_borrowed + loan_amount
        // A3: liquidity accounting untouched by a borrow
        let deposited_unchanged =
          output_datum.total_deposited == pool_datum.total_deposited
        let pool_decreased_correctly =
          lovelace_of(pool_output.value) == pool_balance - loan_amount

        and {
          proof_ok?,
          sufficient_liquidity?,
          borrowed_updated?,
          deposited_unchanged?,
          pool_decreased_correctly?,
          pool_config_preserved(pool_datum, output_datum)?,
        }
      }

      // RepayAnonymous: ZK proof re-attests collateral ownership, verified on-chain.
      RepayAnonymous { deposit_ref, proof, repay_amount } -> {
        let vkey = get_vkey(tx, pool_datum.vkey_ref)
        let commitment = referenced_commitment(tx, deposit_ref)

        // Proof binds the repayment amount: collateral covers repay_amount at ratio
        let proof_ok =
          verify_collateral_proof(
            vkey,
            proof,
            commitment,
            repay_amount,
            pool_datum.collateral_ratio,
          )

        let pool_balance = lovelace_of(pool_input.output.value)
        expect Some(pool_output) = continuing_pool_output(tx, pool_input)
        expect InlineDatum(output_datum_data) = pool_output.datum
        expect output_datum: PoolDatumV5 = output_datum_data

        // A4: exact debt reduction — a partial repay may not zero the debt,
        // and it may not exceed the outstanding total (no underflow).
        let repay_positive = repay_amount > 0
        let no_overpay = repay_amount <= pool_datum.total_borrowed
        let borrowed_updated =
          output_datum.total_borrowed == pool_datum.total_borrowed - repay_amount
        // Pool must receive exactly the repayment; liquidity total untouched
        let pool_increased_correctly =
          lovelace_of(pool_output.value) == pool_balance + repay_amount
        let deposited_unchanged =
          output_datum.total_deposited == pool_datum.total_deposited

        and {
          proof_ok?,
          repay_positive?,
          no_overpay?,
          borrowed_updated?,
          pool_increased_correctly?,
          deposited_unchanged?,
          pool_config_preserved(pool_datum, output_datum)?,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}

/// A3: every protocol-configuration field must survive a pool spend unchanged.
/// Only total_deposited / total_borrowed may move, and only on their own branch.
/// (open_loans_root is added in the loan-binding workstream and folded in here then.)
fn pool_config_preserved(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.interest_rate == old.interest_rate,
    new.collateral_ratio == old.collateral_ratio,
    new.vkey_ref == old.vkey_ref,
  }
}

/// The continuing pool output (same script address as the spent pool input).
fn continuing_pool_output(tx: Transaction, pool_input: Input) -> Option<Output> {
  list.find(
    tx.outputs,
    fn(output) { output.address == pool_input.output.address },
  )
}

/// Read the commitment (Int field element) from a referenced collateral/deposit UTxO.
fn referenced_commitment(tx: Transaction, ref: OutputReference) -> Int {
  expect Some(collateral_input) = find_input_by_ref(tx, ref)
  expect InlineDatum(collateral_datum_data) = collateral_input.output.datum
  expect collateral_datum: DepositDatumV5 = collateral_datum_data
  collateral_datum.commitment
}
