//// Validator-level adversarial tests for the lender side, using REAL on-chain
//// proofs (lender_onchain_test, semaphore_onchain_test). One lender note is one
//// pool share. AddLiquidity pays exactly the current share price (rounded up)
//// and appends the note to lender_root; WithdrawLiquidity proves a note in
//// lender_root with a fresh withdraw nullifier W, pays the current share price
//// (rounded down) to the key the proof is bound to, from free liquidity only.
//// Share value = pool lovelace - liquidity_reserve + total_borrowed.
//// Also covers the free-liquidity rule for borrow (outstanding loans are not
//// subtracted twice) and that borrower paths cannot touch the lender fields.

use cardano/address.{from_script, from_verification_key}
use cardano/assets.{Value, from_asset, from_lovelace, merge}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use lender_onchain_test.{
  lender_append_1, lender_append_2, lender_empty_root, lender_ext, lender_note_1,
  lender_note_2, lender_recipient_pkh, lender_root_1, lender_root_2,
  lender_withdraw_proof, lender_withdraw_vkey, withdraw_null,
}
use semaphore_onchain_test.{
  append_vkey, ext, group_root, loan_amt, loan_null, old_repaid_root, proof,
  recipient_pkh, repay_ext, vkey,
}
use set_fixture.{empty_root, one, withdrawn_one}
use types_v5.{
  AddLiquidity, Asset, BorrowAnonymous, CollateralAsset, PoolDatumV5,
  PoolRedeemerV5, WithdrawLiquidity, pool_nft_name,
}
use v5/lending_pool_v5

/// ADA as the pool's loan asset, and ADA collateral of 20 ADA per deposit.
const ada: Asset = Asset { policy_id: #"", asset_name: #"" }

const ada_collateral: CollateralAsset =
  CollateralAsset { policy_id: #"", asset_name: #"", denomination: 20_000_000 }

const pool_hash: ByteArray =
  #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const nft_policy: ByteArray =
  #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

const coll_hash: ByteArray =
  #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const pool_oref: OutputReference =
  OutputReference { transaction_id: #"b0", output_index: 0 }

const vk_oref: OutputReference =
  OutputReference { transaction_id: #"b1", output_index: 0 }

const rvk_oref: OutputReference =
  OutputReference { transaction_id: #"b5", output_index: 0 }

const avk_oref: OutputReference =
  OutputReference { transaction_id: #"b4", output_index: 0 }

const lwvk_oref: OutputReference =
  OutputReference { transaction_id: #"b6", output_index: 0 }

const reserve: Int = 2_000_000

const start_price: Int = 10_000_000

fn pool_value(lovelace: Int) -> Value {
  merge(from_lovelace(lovelace), from_asset(nft_policy, pool_nft_name, 1))
}

/// A pool with the borrow fixture's commitment set and the given lender state.
fn lender_pool(
  lender_root: Int,
  next: Int,
  shares: Int,
  total_borrowed: Int,
) -> PoolDatumV5 {
  PoolDatumV5 {
    total_deposited: 0,
    total_borrowed,
    interest_rate: 500,
    group_root,
    group_next_index: 1,
    repaid_root: old_repaid_root,
    next_index: 0,
    external_nullifier: ext,
    repay_external_nullifier: repay_ext,
    loan_asset: ada,
    collateral_assets: [ada_collateral],
    loan_denomination: loan_amt,
    loans: empty_root,
    last_updated: 0,
    lender_root,
    lender_next_index: next,
    total_shares: shares,
    withdrawn: empty_root,
    lender_external_nullifier: lender_ext,
    share_start_price: start_price,
    liquidity_reserve: reserve,
  }
}

fn ref_input(oref: OutputReference, data: Data) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: from_script(#"deadbeef"),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(data),
      reference_script: None,
    },
  }
}

fn pool_input(pd: PoolDatumV5, lovelace: Int) -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value: pool_value(lovelace),
      datum: InlineDatum(pd),
      reference_script: None,
    },
  }
}

fn pool_out(pd: PoolDatumV5, lovelace: Int) -> Output {
  Output {
    address: from_script(pool_hash),
    value: pool_value(lovelace),
    datum: InlineDatum(pd),
    reference_script: None,
  }
}

/// An output paying `lovelace` to `pkh`, tagged with `tag` as inline datum.
fn tagged_payout(pkh: ByteArray, lovelace: Int, tag: Int) -> Output {
  Output {
    address: from_verification_key(pkh),
    value: from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

fn run(pd: PoolDatumV5, r: PoolRedeemerV5, tx: Transaction) -> Bool {
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    rvk_oref,
    avk_oref,
    lwvk_oref,
    Some(pd),
    r,
    pool_oref,
    tx,
  )
}

// ---- AddLiquidity: buy one share --------------------------------------------

fn add_tx(
  pd: PoolDatumV5,
  bal_in: Int,
  out: PoolDatumV5,
  bal_out: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [pool_input(pd, bal_in)],
    reference_inputs: [ref_input(avk_oref, append_vkey())],
    outputs: [pool_out(out, bal_out)],
  }
}

fn first_share_out(paid: Int) -> PoolDatumV5 {
  PoolDatumV5 { ..lender_pool(lender_root_1, 1, 1, 0), total_deposited: paid }
}

fn add_first(out: PoolDatumV5, paid: Int) -> Bool {
  let pd = lender_pool(lender_empty_root, 0, 0, 0)
  run(
    pd,
    AddLiquidity { commitment: lender_note_1, append_proof: lender_append_1() },
    add_tx(pd, reserve, out, reserve + paid),
  )
}

test add_first_share_at_start_price_succeeds() {
  add_first(first_share_out(start_price), start_price)
}

test add_first_share_overpaid_fails() {
  // Exactly the price: any other amount would fingerprint the lender.
  !add_first(first_share_out(start_price + 1), start_price + 1)
}

test add_first_share_underpaid_fails() {
  !add_first(first_share_out(start_price - 1), start_price - 1)
}

test add_share_without_share_count_fails() {
  !add_first(
    PoolDatumV5 { ..first_share_out(start_price), total_shares: 0 },
    start_price,
  )
}

test add_share_index_not_advanced_fails() {
  !add_first(
    PoolDatumV5 { ..first_share_out(start_price), lender_next_index: 0 },
    start_price,
  )
}

test add_share_with_wrong_append_proof_fails() {
  // The append proof for index 1 does not move the empty tree.
  let pd = lender_pool(lender_empty_root, 0, 0, 0)
  !run(
    pd,
    AddLiquidity { commitment: lender_note_2, append_proof: lender_append_2() },
    add_tx(pd, reserve, first_share_out(start_price), reserve + start_price),
  )
}

test add_share_touching_borrower_fields_fails() {
  !add_first(
    PoolDatumV5 { ..first_share_out(start_price), loans: one(1, #"01") },
    start_price,
  )
}

/// Second share after one repayment's interest (0.5 ADA): the share value is
/// 10.5 ADA, so the second lender pays 10.5 ADA.
fn add_second(paid: Int) -> Bool {
  let grown = start_price + 500_000
  let pd = lender_pool(lender_root_1, 1, 1, 0)
  let out =
    PoolDatumV5 { ..lender_pool(lender_root_2, 2, 2, 0), total_deposited: paid }
  run(
    pd,
    AddLiquidity { commitment: lender_note_2, append_proof: lender_append_2() },
    add_tx(pd, reserve + grown, out, reserve + grown + paid),
  )
}

test add_second_share_at_grown_price_succeeds() {
  add_second(start_price + 500_000)
}

test add_second_share_at_start_price_fails() {
  // Interest belongs to the shares that were in the pool when it was paid.
  !add_second(start_price)
}

test add_share_counts_outstanding_loans() {
  // 1 share, 10.5 ADA value of which 10 ADA is lent out: the price is still
  // 10.5 ADA, although only 0.5 ADA is in the pool.
  let pd = lender_pool(lender_root_1, 1, 1, 10_000_000)
  let paid = start_price + 500_000
  let out =
    PoolDatumV5 {
      ..lender_pool(lender_root_2, 2, 2, 10_000_000),
      total_deposited: paid,
    }
  run(
    pd,
    AddLiquidity { commitment: lender_note_2, append_proof: lender_append_2() },
    add_tx(pd, reserve + 500_000, out, reserve + 500_000 + paid),
  )
}

// ---- WithdrawLiquidity: one share out ---------------------------------------

/// Two shares, value 21 ADA (two shares + 1 ADA interest), `borrowed` of it lent
/// out: the share price is 10.5 ADA.
fn two_shares(borrowed: Int) -> PoolDatumV5 {
  lender_pool(lender_root_2, 2, 2, borrowed)
}

const price_two: Int = 10_500_000

fn withdrawn(pd: PoolDatumV5) -> PoolDatumV5 {
  PoolDatumV5 {
    ..pd,
    total_shares: pd.total_shares - 1,
    withdrawn: withdrawn_one(withdraw_null),
  }
}

fn withdraw_redeemer(to: ByteArray) -> PoolRedeemerV5 {
  WithdrawLiquidity {
    proof: lender_withdraw_proof(),
    withdraw_nullifier: withdraw_null,
    recipient: to,
    withdrawn_proof: [],
  }
}

fn withdraw_tx(
  pd: PoolDatumV5,
  bal_in: Int,
  out: PoolDatumV5,
  bal_out: Int,
  payout: Output,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [pool_input(pd, bal_in)],
    reference_inputs: [ref_input(lwvk_oref, lender_withdraw_vkey())],
    outputs: [pool_out(out, bal_out), payout],
  }
}

fn withdraw_full(out: PoolDatumV5, bal_out: Int, payout: Output) -> Bool {
  let pd = two_shares(0)
  let bal_in = reserve + 21_000_000
  run(
    pd,
    withdraw_redeemer(lender_recipient_pkh),
    withdraw_tx(pd, bal_in, out, bal_out, payout),
  )
}

fn good_payout() -> Output {
  tagged_payout(lender_recipient_pkh, price_two, withdraw_null)
}

test withdraw_share_succeeds() {
  withdraw_full(
    withdrawn(two_shares(0)),
    reserve + 21_000_000 - price_two,
    good_payout(),
  )
}

test withdraw_same_note_twice_fails() fail {
  // W is already in the withdrawn set, so the insert cannot be proven: the spend errors.
  let pd =
    PoolDatumV5 { ..two_shares(0), withdrawn: withdrawn_one(withdraw_null) }
  let bal_in = reserve + 21_000_000
  run(
    pd,
    withdraw_redeemer(lender_recipient_pkh),
    withdraw_tx(pd, bal_in, withdrawn(pd), bal_in - price_two, good_payout()),
  )
}

test withdraw_redirected_to_other_key_fails() {
  // A copied proof cannot be re-targeted: the proof is bound to its key.
  let pd = two_shares(0)
  let bal_in = reserve + 21_000_000
  !run(
    pd,
    withdraw_redeemer(recipient_pkh),
    withdraw_tx(
      pd,
      bal_in,
      withdrawn(pd),
      bal_in - price_two,
      tagged_payout(recipient_pkh, price_two, withdraw_null),
    ),
  )
}

test withdraw_paid_to_other_key_fails() {
  !withdraw_full(
    withdrawn(two_shares(0)),
    reserve + 21_000_000 - price_two,
    tagged_payout(recipient_pkh, price_two, withdraw_null),
  )
}

test withdraw_more_than_price_fails() {
  !withdraw_full(
    withdrawn(two_shares(0)),
    reserve + 21_000_000 - price_two - 1,
    tagged_payout(lender_recipient_pkh, price_two + 1, withdraw_null),
  )
}

test withdraw_underpays_recipient_fails() {
  // The pool releases the price, but the recipient output gets less.
  !withdraw_full(
    withdrawn(two_shares(0)),
    reserve + 21_000_000 - price_two,
    tagged_payout(lender_recipient_pkh, price_two - 1, withdraw_null),
  )
}

test withdraw_payout_without_tag_fails() {
  !withdraw_full(
    withdrawn(two_shares(0)),
    reserve + 21_000_000 - price_two,
    tagged_payout(lender_recipient_pkh, price_two, withdraw_null + 1),
  )
}

test withdraw_not_recorded_fails() {
  !withdraw_full(
    PoolDatumV5 { ..two_shares(0), total_shares: 1 },
    reserve + 21_000_000 - price_two,
    good_payout(),
  )
}

test withdraw_share_count_kept_fails() {
  !withdraw_full(
    PoolDatumV5 { ..withdrawn(two_shares(0)), total_shares: 2 },
    reserve + 21_000_000 - price_two,
    good_payout(),
  )
}

test withdraw_rewriting_lender_root_fails() {
  !withdraw_full(
    PoolDatumV5 { ..withdrawn(two_shares(0)), lender_root: lender_root_1 },
    reserve + 21_000_000 - price_two,
    good_payout(),
  )
}

test withdraw_with_loans_out_from_free_liquidity_succeeds() {
  // 10 ADA lent out: value still 21 ADA, price 10.5 ADA, 11 ADA free.
  let pd = two_shares(10_000_000)
  let bal_in = reserve + 11_000_000
  run(
    pd,
    withdraw_redeemer(lender_recipient_pkh),
    withdraw_tx(pd, bal_in, withdrawn(pd), bal_in - price_two, good_payout()),
  )
}

test withdraw_beyond_free_liquidity_fails() {
  // 20 ADA lent out: price 10.5 ADA, only 1 ADA free; the reserve is not
  // lenders' money.
  let pd = two_shares(20_000_000)
  let bal_in = reserve + 1_000_000
  !run(
    pd,
    withdraw_redeemer(lender_recipient_pkh),
    withdraw_tx(pd, bal_in, withdrawn(pd), bal_in - price_two, good_payout()),
  )
}

// ---- Borrow: free liquidity, lender fields frozen ---------------------------

fn borrow_with(pd: PoolDatumV5, bal_in: Int, out: PoolDatumV5) -> Bool {
  run(
    pd,
    BorrowAnonymous {
      proof: proof(),
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
      loans_proof: [],
    },
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, bal_in)],
      reference_inputs: [ref_input(vk_oref, vkey())],
      outputs: [
        pool_out(out, bal_in - loan_amt),
        tagged_payout(recipient_pkh, loan_amt, loan_null),
      ],
    },
  )
}

fn borrowed(pd: PoolDatumV5) -> PoolDatumV5 {
  PoolDatumV5 {
    ..pd,
    total_borrowed: pd.total_borrowed + loan_amt,
    loans: one(loan_null, #"01"),
  }
}

test borrow_lends_more_than_half_the_liquidity() {
  // 4 shares (40 ADA), 30 ADA already lent out, 10 ADA free: the fourth loan
  // is paid. (Subtracting total_borrowed from the pool lovelace again would
  // leave -20 ADA "free" and refuse it.)
  let pd = lender_pool(lender_root_2, 2, 4, 30_000_000)
  borrow_with(pd, reserve + 10_000_000, borrowed(pd))
}

test borrow_from_reserve_fails() {
  let pd = lender_pool(lender_root_2, 2, 4, 31_000_000)
  !borrow_with(pd, reserve + 9_000_000, borrowed(pd))
}

test borrow_touching_lender_fields_fails() {
  let pd = lender_pool(lender_root_2, 2, 4, 0)
  !borrow_with(
    pd,
    reserve + 40_000_000,
    PoolDatumV5 { ..borrowed(pd), total_shares: 5 },
  )
}

test borrow_spending_withdraw_nullifier_set_fails() {
  let pd = lender_pool(lender_root_2, 2, 4, 0)
  !borrow_with(
    pd,
    reserve + 40_000_000,
    PoolDatumV5 { ..borrowed(pd), withdrawn: withdrawn_one(withdraw_null) },
  )
}
