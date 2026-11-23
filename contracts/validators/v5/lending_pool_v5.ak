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
////
//// Lenders hold pool SHARES, one per lender note. AddLiquidity pays exactly the
//// current share price and appends the note's leaf to `lender_root` (append
//// proof). WithdrawLiquidity proves a note in `lender_root` in zero knowledge,
//// records its withdraw nullifier and pays the current share price to the key
//// the proof is bound to — so a withdrawal is not linkable to the liquidity
//// deposit it belongs to. Share value = pool lovelace - liquidity_reserve +
//// total_borrowed; repayment interest raises it for every share at once. Loans
//// and lender withdrawals are paid only from free liquidity (pool lovelace -
//// liquidity_reserve).

use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Script, VerificationKey}
use cardano/assets.{PolicyId, lovelace_of, quantity_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use types_v5.{
  AddLiquidity, BorrowAnonymous, DepositCollateral, DepositDatumV5, PoolDatumV5,
  PoolRedeemerV5, RepayAnonymous, WithdrawLiquidity, pool_nft_name,
}
use zk.{
  get_vkey, verify_append_proof, verify_borrow_proof,
  verify_lender_withdraw_proof, verify_repay_proof,
}

validator lending_pool_v5(
  pool_nft_policy: PolicyId,
  collateral_hash: ScriptHash,
  vkey_ref: OutputReference,
  repay_vkey_ref: OutputReference,
  append_vkey_ref: OutputReference,
  lender_vkey_ref: OutputReference,
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
      // AddLiquidity: a lender buys ONE share. The pool takes exactly the
      // current share price (rounded up, in the pool's favour), so every share
      // bought against the same pool state costs the same; the append proof
      // inserts the note leaf at lender_next_index (lender_root -> out.lender_root).
      AddLiquidity { commitment, append_proof } -> {
        let append_vkey = get_vkey(tx, append_vkey_ref)
        let append_ok =
          verify_append_proof(
            append_vkey,
            append_proof,
            pool_datum.lender_root,
            out.lender_root,
            commitment,
            pool_datum.lender_next_index,
          )
        let price = share_price_up(pool_datum, bal_in)
        and {
          append_ok?,
          (out.lender_next_index == pool_datum.lender_next_index + 1)?,
          (bal_out == bal_in + price)?,
          (out.total_shares == pool_datum.total_shares + 1)?,
          (out.lender_nullifiers == pool_datum.lender_nullifiers)?,
          (out.total_deposited == pool_datum.total_deposited + price)?,
          (out.total_borrowed == pool_datum.total_borrowed)?,
          group_frozen(pool_datum, out)?,
          repaid_frozen(pool_datum, out)?,
          same_open_loans(pool_datum, out)?,
          same_used_nullifiers(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // WithdrawLiquidity: the proof attests a note in lender_root (which one
      // stays hidden) with withdraw nullifier W, bound to `recipient`. W must be
      // fresh and is recorded, so a note pays out once. The pool pays the current
      // share price (rounded down) to that key, tagged with W, from free
      // liquidity only; while loans are out, lenders wait for repayments.
      WithdrawLiquidity { proof, withdraw_nullifier, recipient } -> {
        let lender_vkey = get_vkey(tx, lender_vkey_ref)
        let proof_ok =
          verify_lender_withdraw_proof(
            lender_vkey,
            proof,
            pool_datum.lender_root,
            withdraw_nullifier,
            pool_datum.lender_external_nullifier,
            bytearray.to_int_big_endian(recipient),
          )
        let fresh =
          !has_nullifier(pool_datum.lender_nullifiers, withdraw_nullifier)
        let price = share_price_down(pool_datum, bal_in)
        and {
          proof_ok?,
          fresh?,
          (price > 0)?,
          (price <= free_liquidity(pool_datum, bal_in))?,
          pays_loan(tx, recipient, price, withdraw_nullifier)?,
          (bal_out == bal_in - price)?,
          (out.total_shares == pool_datum.total_shares - 1)?,
          (out.lender_nullifiers == [
            withdraw_nullifier,
            ..pool_datum.lender_nullifiers
          ])?,
          (out.lender_root == pool_datum.lender_root)?,
          (out.lender_next_index == pool_datum.lender_next_index)?,
          (out.total_deposited == pool_datum.total_deposited)?,
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
          lender_frozen(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // BorrowAnonymous: membership proof authorizes the loan. The nullifier is
      // recorded as open AND as used; no collateral UTxO is referenced (unlinkable).
      // A nullifier that was EVER used cannot borrow again — not even after its
      // loan was repaid — so a repaid deposit's R never covers a later loan.
      BorrowAnonymous { proof, loan_amount, loan_nullifier, recipient } -> {
        let vkey = get_vkey(tx, vkey_ref)
        let proof_ok =
          verify_borrow_proof(
            vkey,
            proof,
            pool_datum.group_root,
            loan_nullifier,
            pool_datum.external_nullifier,
            bytearray.to_int_big_endian(recipient),
          )
        let fresh = !has_nullifier(pool_datum.used_nullifiers, loan_nullifier)
        // Paid from free liquidity: the lent-out lovelace has already left the
        // pool UTxO, so it is not subtracted again.
        let liquidity = loan_amount <= free_liquidity(pool_datum, bal_in)
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
          // The loan goes to the key the proof is bound to (front-running).
          pays_loan(tx, recipient, loan_amount, loan_nullifier)?,
          (out.open_loans == [loan_nullifier, ..pool_datum.open_loans])?,
          (out.used_nullifiers == [loan_nullifier, ..pool_datum.used_nullifiers])?,
          (out.total_borrowed == pool_datum.total_borrowed + loan_amount)?,
          (out.total_deposited == pool_datum.total_deposited)?,
          (bal_out == bal_in - loan_amount)?,
          group_frozen(pool_datum, out)?,
          repaid_frozen(pool_datum, out)?,
          lender_frozen(pool_datum, out)?,
          pool_static_preserved(pool_datum, out)?,
        }
      }

      // RepayAnonymous: a repay proof attests membership, the loan nullifier AND
      // the repayment nullifier R from ONE secret; pay principal + interest,
      // remove the loan from the open set, AND insert that R into repaid_root via
      // a zero-knowledge append proof. PERMISSIONLESS (no admin signature): the
      // append proof binds old_root = repaid_root, new_root = out.repaid_root,
      // leaf = R, index = next_index — so the settlement set grows only with the
      // R of the loan actually repaid, and its deposit can later unlock.
      RepayAnonymous {
        proof,
        repay_amount,
        loan_nullifier,
        repay_nullifier,
        append_proof,
      } -> {
        let outstanding = has_nullifier(pool_datum.open_loans, loan_nullifier)
        let principal = pool_datum.loan_denomination
        let vkey = get_vkey(tx, repay_vkey_ref)
        // The repay proof binds the loan nullifier AND the appended repayment
        // nullifier R to ONE secret (for the fixed loan denomination), so a repay
        // can only release its own deposit; a (public) borrow proof is not a repay
        // proof. repay_amount is enforced by the pool accounting below.
        let proof_ok =
          verify_repay_proof(
            vkey,
            proof,
            pool_datum.group_root,
            loan_nullifier,
            repay_nullifier,
            pool_datum.external_nullifier,
            pool_datum.repay_external_nullifier,
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
          lender_frozen(pool_datum, out)?,
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
    new.lender_external_nullifier == old.lender_external_nullifier,
    new.share_start_price == old.share_start_price,
    new.liquidity_reserve == old.liquidity_reserve,
  }
}

/// The lender side (tree, share count, spent withdraw nullifiers) may only move
/// on AddLiquidity and WithdrawLiquidity.
fn lender_frozen(old: PoolDatumV5, new: PoolDatumV5) -> Bool {
  and {
    new.lender_root == old.lender_root,
    new.lender_next_index == old.lender_next_index,
    new.total_shares == old.total_shares,
    new.lender_nullifiers == old.lender_nullifiers,
  }
}

/// Lovelace that loans and lender withdrawals may take: everything in the pool
/// UTxO above the fixed reserve.
fn free_liquidity(pool: PoolDatumV5, bal_in: Int) -> Int {
  bal_in - pool.liquidity_reserve
}

/// What all shares together are worth: free liquidity plus outstanding loans.
fn share_value(pool: PoolDatumV5, bal_in: Int) -> Int {
  free_liquidity(pool, bal_in) + pool.total_borrowed
}

/// Price of buying one share, rounded up. With no share outstanding it is the
/// fixed start price (anything left in the pool then goes to the new shares).
fn share_price_up(pool: PoolDatumV5, bal_in: Int) -> Int {
  if pool.total_shares == 0 {
    pool.share_start_price
  } else {
    ( share_value(pool, bal_in) + pool.total_shares - 1 ) / pool.total_shares
  }
}

/// Payout for one share, rounded down. No share outstanding means no payout.
fn share_price_down(pool: PoolDatumV5, bal_in: Int) -> Int {
  if pool.total_shares <= 0 {
    0
  } else {
    share_value(pool, bal_in) / pool.total_shares
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

/// Some output pays at least `amount` lovelace to the `recipient` key, tagged
/// with the loan nullifier as inline datum.
fn pays_loan(
  tx: Transaction,
  recipient: VerificationKeyHash,
  amount: Int,
  loan_nullifier: Int,
) -> Bool {
  list.any(
    tx.outputs,
    fn(output) {
      and {
        output.address.payment_credential == VerificationKey(recipient),
        lovelace_of(output.value) >= amount,
        output.datum == InlineDatum(loan_nullifier),
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
