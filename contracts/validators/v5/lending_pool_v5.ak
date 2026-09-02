//// ============================================
//// LENDING POOL V6 — private on-chain ZK lending (Milestone 3)
//// ============================================
//// Borrow/repay are authorized by a Groth16 membership proof verified ON-CHAIN.
//// The borrow does NOT reference a specific collateral UTxO — it proves the
//// commitment is a member of `group_root` — so deposit<->borrow is unlinkable.
//// A loan is a `loan_nullifier` recorded in `open_loans`; repayment (principal +
//// interest) removes it (double-borrow gate). In the SAME repay tx the borrower
//// inserts their repayment nullifier R into the append-only `repaid_root` via a
//// zero-knowledge append proof — PERMISSIONLESSLY, no admin — which is what lets
//// them later prove settlement (in ZK) at unlock. `group_root` (the deposit
//// anonymity set) stays admin-curated via SetGroupRoot.

use aiken/collection/list
use cardano/assets.{lovelace_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{Input, InlineDatum, Output, OutputReference, Transaction}
use types_v5.{
  BorrowAnonymous, Deposit, PoolDatumV5, PoolRedeemerV5, RepayAnonymous,
  SetGroupRoot,
}
use zk.{get_vkey, verify_append_proof, verify_borrow_proof}

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
    expect Some(pool_output) = continuing_pool_output(tx, pool_input)
    expect InlineDatum(out_data) = pool_output.datum
    expect out: PoolDatumV5 = out_data

    let bal_in = lovelace_of(pool_input.output.value)
    let bal_out = lovelace_of(pool_output.value)

    when redeemer is {
      // Deposit: add liquidity. Only total_deposited grows; loans/config frozen.
      Deposit -> {
        let delta = bal_out - bal_in
        and {
          (delta > 0)?,
          (out.total_deposited == pool_datum.total_deposited + delta)?,
          (out.total_borrowed == pool_datum.total_borrowed)?,
          (out.group_root == pool_datum.group_root)?,
          repaid_frozen(pool_datum, out)?,
          same_open_loans(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // SetGroupRoot: the protocol admin publishes the updated commitment-set root
      // (the deposit anonymity set is admin-curated for M3). repaid_root is NOT
      // admin-settable — it only grows via the permissionless append on Repay.
      // Nothing else may move.
      SetGroupRoot { new_root } ->
        and {
          list.has(tx.extra_signatories, pool_datum.admin)?,
          (out.group_root == new_root)?,
          repaid_frozen(pool_datum, out)?,
          (bal_out == bal_in)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (out.total_borrowed == pool_datum.total_borrowed)?,
          same_open_loans(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }

      // BorrowAnonymous: membership proof authorizes the loan. The nullifier is
      // recorded; no collateral UTxO is referenced (unlinkable).
      BorrowAnonymous { proof, loan_amount, loan_nullifier } -> {
        let vkey = get_vkey(tx, pool_datum.vkey_ref)
        let proof_ok =
          verify_borrow_proof(
            vkey,
            proof,
            pool_datum.group_root,
            loan_nullifier,
            loan_amount,
            pool_datum.collateral_ratio,
            pool_datum.external_nullifier,
          )
        let fresh = !has_nullifier(pool_datum.open_loans, loan_nullifier)
        let liquidity = loan_amount <= bal_in - pool_datum.total_borrowed
        // Fixed denomination: every loan is exactly loan_denomination, so loan
        // amounts are uniform and carry no per-loan information.
        let denominated = loan_amount == pool_datum.loan_denomination
        and {
          proof_ok?,
          fresh?,
          liquidity?,
          denominated?,
          (out.open_loans == [loan_nullifier, ..pool_datum.open_loans])?,
          (out.total_borrowed == pool_datum.total_borrowed + loan_amount)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (bal_out == bal_in - loan_amount)?,
          (out.group_root == pool_datum.group_root)?,
          repaid_frozen(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // RepayAnonymous: re-attest membership + the loan nullifier, pay principal +
      // interest, remove the loan from the open set, AND insert the repayment
      // nullifier R into repaid_root via a zero-knowledge append proof. Stays
      // PERMISSIONLESS (no admin signature): the append proof binds
      // old_root = repaid_root, new_root = out.repaid_root, leaf = R, index =
      // next_index — so the borrower grows the settlement set themselves and can
      // later unlock without any admin step. A bogus R only harms the repayer.
      RepayAnonymous {
        proof,
        repay_amount,
        loan_nullifier,
        repay_nullifier,
        append_proof,
      } -> {
        let outstanding = has_nullifier(pool_datum.open_loans, loan_nullifier)
        let principal = pool_datum.loan_denomination
        let vkey = get_vkey(tx, pool_datum.vkey_ref)
        // The proof re-attests membership + the loan nullifier for the (fixed)
        // loan denomination. repay_amount is enforced by the pool accounting below.
        let proof_ok =
          verify_borrow_proof(
            vkey,
            proof,
            pool_datum.group_root,
            loan_nullifier,
            principal,
            pool_datum.collateral_ratio,
            pool_datum.external_nullifier,
          )
        // Append proof: R is inserted at next_index, repaid_root -> out.repaid_root.
        let append_vkey = get_vkey(tx, pool_datum.append_vkey_ref)
        let append_ok =
          verify_append_proof(
            append_vkey,
            append_proof,
            pool_datum.repaid_root,
            out.repaid_root,
            repay_nullifier,
            pool_datum.next_index,
          )
        let due = principal + interest_of(principal, pool_datum.interest_rate)
        and {
          proof_ok?,
          append_ok?,
          outstanding?,
          (repay_amount >= due)?,
          (out.open_loans == remove_loan(pool_datum.open_loans, loan_nullifier))?,
          (out.total_borrowed == pool_datum.total_borrowed - principal)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (bal_out == bal_in + repay_amount)?,
          (out.group_root == pool_datum.group_root)?,
          (out.next_index == pool_datum.next_index + 1)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}

/// Flat-rate interest (bps): principal * interest_rate / 10000.
fn interest_of(principal: Int, interest_rate: Int) -> Int {
  principal * interest_rate / 10000
}

/// Every non-financial config field must survive any pool spend unchanged.
/// (group_root is checked per-branch: frozen everywhere except SetGroupRoot;
/// repaid_root + next_index are frozen everywhere except Repay via repaid_frozen.)
fn pool_static_preserved(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.interest_rate == old.interest_rate,
    new.collateral_ratio == old.collateral_ratio,
    new.vkey_ref == old.vkey_ref,
    new.settlement_vkey_ref == old.settlement_vkey_ref,
    new.append_vkey_ref == old.append_vkey_ref,
    new.external_nullifier == old.external_nullifier,
    new.repay_external_nullifier == old.repay_external_nullifier,
    new.loan_denomination == old.loan_denomination,
    new.admin == old.admin,
  }
}

/// The append-only repaid set (root + next position) may only move on Repay.
fn repaid_frozen(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.repaid_root == old.repaid_root,
    new.next_index == old.next_index,
  }
}

fn same_open_loans(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  new.open_loans == old.open_loans
}

fn has_nullifier(loans: List<Int>, n: Int) -> Bool {
  list.has(loans, n)
}

fn remove_loan(loans: List<Int>, n: Int) -> List<Int> {
  list.filter(loans, fn(x) { x != n })
}

fn continuing_pool_output(tx: Transaction, pool_input: Input) -> Option<Output> {
  list.find(tx.outputs, fn(output) { output.address == pool_input.output.address })
}
