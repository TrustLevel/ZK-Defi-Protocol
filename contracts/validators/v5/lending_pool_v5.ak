//// ============================================
//// LENDING POOL V6 — private on-chain ZK lending (Milestone 3)
//// ============================================
//// Borrow/repay are authorized by a Groth16 membership proof verified ON-CHAIN.
//// The borrow does NOT reference a specific collateral UTxO — it proves the
//// commitment is a member of `group_root` — so deposit<->borrow is unlinkable.
//// A loan is a `loan_nullifier` recorded in `open_loans`; repayment (principal +
//// interest) removes it. The nullifier also enters `used_nullifiers` for good,
//// so a deposit backs exactly one loan over its lifetime. In the SAME repay tx the borrower
//// inserts their repayment nullifier R into the append-only `repaid_root` via a
//// zero-knowledge append proof — PERMISSIONLESSLY, no admin — which is what lets
//// them later prove settlement (in ZK) at unlock.
////
//// Collateral enters through the pool too (DepositCollateral): the tx must pay
//// exactly `collateral_denomination` with the commitment to the collateral
//// script, and an append proof inserts the commitment into `group_root`. So the
//// deposit anonymity set grows PERMISSIONLESSLY and only from real deposits —
//// there is no admin and no signature on any path.
////
//// The pool is the UTxO that carries the one-shot pool NFT: the validator only
//// spends an input holding it and finds the continuing output by it (at the same
//// address). The borrow and append verification keys are validator parameters.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{PolicyId, lovelace_of, quantity_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use types_v5.{
  AddLiquidity, BorrowAnonymous, DepositCollateral, DepositDatumV5, PoolDatumV5,
  PoolRedeemerV5, RepayAnonymous, pool_nft_name,
}
use zk.{get_vkey, verify_append_proof, verify_borrow_proof}

validator lending_pool_v5(
  pool_nft_policy: PolicyId,
  collateral_hash: ScriptHash,
  vkey_ref: OutputReference,
  append_vkey_ref: OutputReference,
) {
  spend(
    datum: Option<PoolDatumV5>,
    redeemer: PoolRedeemerV5,
    output_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(pool_datum) = datum
    expect Some(pool_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == output_ref })
    // Only the UTxO holding the pool NFT is the pool.
    expect has_pool_nft(pool_input.output, pool_nft_policy)
    // The NFT must continue in an output at the same pool address.
    expect Some(pool_output) = continuing_pool_output(tx, pool_nft_policy)
    expect pool_output.address == pool_input.output.address
    expect InlineDatum(out_data) = pool_output.datum
    expect out: PoolDatumV5 = out_data

    let bal_in = lovelace_of(pool_input.output.value)
    let bal_out = lovelace_of(pool_output.value)

    when redeemer is {
      // AddLiquidity: a lender adds lovelace. Only total_deposited grows;
      // loans, both sets and config are frozen.
      AddLiquidity -> {
        let delta = bal_out - bal_in
        and {
          (delta > 0)?,
          (out.total_deposited == pool_datum.total_deposited + delta)?,
          (out.total_borrowed == pool_datum.total_borrowed)?,
          group_frozen(pool_datum, out)?,
          repaid_frozen(pool_datum, out)?,
          same_open_loans(pool_datum, out)?,
          same_used_nullifiers(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // DepositCollateral: the tx pays exactly collateral_denomination with this
      // commitment to the collateral script, and the append proof inserts the
      // commitment at group_next_index, taking group_root -> out.group_root.
      // Permissionless: the commitment set only grows from real, fixed-size
      // deposits. The pool's own value and everything else stay unchanged.
      DepositCollateral { commitment, append_proof } -> {
        let append_vkey = get_vkey(tx, append_vkey_ref)
        let append_ok =
          verify_append_proof(
            append_vkey,
            append_proof,
            pool_datum.group_root,
            out.group_root,
            commitment,
            pool_datum.group_next_index,
          )
        and {
          append_ok?,
          (out.group_next_index == pool_datum.group_next_index + 1)?,
          pays_collateral(
            tx,
            collateral_hash,
            commitment,
            pool_datum.collateral_denomination,
          )?,
          (bal_out == bal_in)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (out.total_borrowed == pool_datum.total_borrowed)?,
          repaid_frozen(pool_datum, out)?,
          same_open_loans(pool_datum, out)?,
          same_used_nullifiers(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // BorrowAnonymous: membership proof authorizes the loan. The nullifier is
      // recorded as open AND as used; no collateral UTxO is referenced (unlinkable).
      // A nullifier that was EVER used cannot borrow again — not even after its
      // loan was repaid — so a repaid deposit's R never covers a later loan.
      BorrowAnonymous { proof, loan_amount, loan_nullifier } -> {
        let vkey = get_vkey(tx, vkey_ref)
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
        let fresh = !has_nullifier(pool_datum.used_nullifiers, loan_nullifier)
        let liquidity = loan_amount <= bal_in - pool_datum.total_borrowed
        // Fixed denomination: every loan is exactly loan_denomination, so loan
        // amounts are uniform and carry no per-loan information.
        let denominated = loan_amount == pool_datum.loan_denomination
        // The fixed collateral denomination must cover the loan at the ratio
        // (the deposit amount itself is enforced on-chain at DepositCollateral).
        let covered =
          loan_amount * pool_datum.collateral_ratio <= pool_datum.collateral_denomination * 100
        and {
          proof_ok?,
          fresh?,
          liquidity?,
          denominated?,
          covered?,
          (out.open_loans == [loan_nullifier, ..pool_datum.open_loans])?,
          (out.used_nullifiers == [loan_nullifier, ..pool_datum.used_nullifiers])?,
          (out.total_borrowed == pool_datum.total_borrowed + loan_amount)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (bal_out == bal_in - loan_amount)?,
          group_frozen(pool_datum, out)?,
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
        let vkey = get_vkey(tx, vkey_ref)
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
        let append_vkey = get_vkey(tx, append_vkey_ref)
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
          // Fixed repayment: exactly principal + interest, so every repay tx
          // carries the same amount (no per-borrower fingerprint).
          (repay_amount == due)?,
          (out.open_loans == remove_loan(pool_datum.open_loans, loan_nullifier))?,
          same_used_nullifiers(pool_datum, out)?,
          (out.total_borrowed == pool_datum.total_borrowed - principal)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (bal_out == bal_in + repay_amount)?,
          group_frozen(pool_datum, out)?,
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
/// (group_root + group_next_index are frozen everywhere except DepositCollateral;
/// repaid_root + next_index are frozen everywhere except Repay.)
fn pool_static_preserved(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.interest_rate == old.interest_rate,
    new.collateral_ratio == old.collateral_ratio,
    new.external_nullifier == old.external_nullifier,
    new.repay_external_nullifier == old.repay_external_nullifier,
    new.collateral_denomination == old.collateral_denomination,
    new.loan_denomination == old.loan_denomination,
  }
}

/// The append-only commitment set (root + next position) may only move on
/// DepositCollateral.
fn group_frozen(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.group_root == old.group_root,
    new.group_next_index == old.group_next_index,
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

/// The used-nullifier set only grows, and only on Borrow.
fn same_used_nullifiers(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  new.used_nullifiers == old.used_nullifiers
}

fn has_nullifier(loans: List<Int>, n: Int) -> Bool {
  list.has(loans, n)
}

fn remove_loan(loans: List<Int>, n: Int) -> List<Int> {
  list.filter(loans, fn(x) { x != n })
}

/// Some output pays exactly `denomination` lovelace to the collateral script
/// with an inline deposit datum carrying `commitment`.
fn pays_collateral(
  tx: Transaction,
  collateral_hash: ScriptHash,
  commitment: Int,
  denomination: Int,
) -> Bool {
  list.any(
    tx.outputs,
    fn(output) {
      when output.datum is {
        InlineDatum(data) ->
          if data is DepositDatumV5 {
            and {
              output.address.payment_credential == Script(collateral_hash),
              lovelace_of(output.value) == denomination,
              data.commitment == commitment,
            }
          } else {
            False
          }
        _ -> False
      }
    },
  )
}

fn has_pool_nft(output: Output, policy: PolicyId) -> Bool {
  quantity_of(output.value, policy, pool_nft_name) == 1
}

fn continuing_pool_output(tx: Transaction, policy: PolicyId) -> Option<Output> {
  list.find(tx.outputs, fn(output) { has_pool_nft(output, policy) })
}
