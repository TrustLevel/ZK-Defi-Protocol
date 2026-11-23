//// Validator-level adversarial tests for assets, using REAL on-chain proofs.
//// A pool lends one asset (`loan_asset`, here a native token) and accepts several
//// collateral assets, each with a fixed denomination, in one commitment set.
//// Covers: every pool spend moves only the loan asset, by exactly the action's
//// amount (the NFT and the pool's min ADA stay, nothing else enters or leaves);
//// loans, repayments and shares are paid in the loan asset; a deposit locks
//// exactly the denomination of the asset it names; an unlock returns the full
//// value of the deposit; the asset configuration cannot be rewritten.

use cardano/address.{Address, from_script, from_verification_key}
use cardano/assets.{Value, from_asset, from_lovelace, merge}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
  placeholder,
}
use lender_onchain_test.{
  lender_recipient_pkh, lender_root_2, lender_withdraw_proof,
  lender_withdraw_vkey, withdraw_null,
}
use semaphore_onchain_test.{
  append_proof, append_vkey, commitment, ext, group_append_proof, group_root,
  loan_amt, loan_null, old_repaid_root, proof, recipient_pkh, repaid_root,
  repay_ext, repay_null, repay_proof, repay_vkey, settlement_proof,
  settlement_vkey, vkey,
}
use types_v5.{
  Asset, BorrowAnonymous, CollateralAsset, DepositCollateral, DepositDatumV5,
  PoolDatumV5, PoolRedeemerV5, RepayAnonymous, UnlockDeposit, WithdrawLiquidity,
  pool_nft_name,
}
use v5/collateral_v5
use v5/lending_pool_v5

const pool_hash: ByteArray =
  #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const nft_policy: ByteArray =
  #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

const coll_hash: ByteArray =
  #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

/// The token the pool lends.
const loan_policy: ByteArray =
  #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

const loan_name: ByteArray = "USD"

const loan_token: Asset =
  Asset { policy_id: loan_policy, asset_name: loan_name }

/// A second accepted collateral asset next to ADA.
const coll_policy: ByteArray =
  #"e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2"

const coll_name: ByteArray = "TOK"

const tok_denomination: Int = 500

const ada_collateral: CollateralAsset =
  CollateralAsset { policy_id: #"", asset_name: #"", denomination: 20_000_000 }

const tok_collateral: CollateralAsset =
  CollateralAsset {
    policy_id: coll_policy,
    asset_name: coll_name,
    denomination: tok_denomination,
  }

/// The pool's own ADA (min UTxO). It is not the loan asset, so it never moves.
const pool_ada: Int = 3_000_000

/// ADA that the tx builder adds to token outputs (min UTxO).
const min_ada: Int = 2_000_000

const pool_oref: OutputReference =
  OutputReference { transaction_id: #"b0", output_index: 0 }

const vk_oref: OutputReference =
  OutputReference { transaction_id: #"b1", output_index: 0 }

const svk_oref: OutputReference =
  OutputReference { transaction_id: #"b2", output_index: 0 }

const coll_oref: OutputReference =
  OutputReference { transaction_id: #"b3", output_index: 0 }

const avk_oref: OutputReference =
  OutputReference { transaction_id: #"b4", output_index: 0 }

const rvk_oref: OutputReference =
  OutputReference { transaction_id: #"b5", output_index: 0 }

const lwvk_oref: OutputReference =
  OutputReference { transaction_id: #"b6", output_index: 0 }

// ---- helpers ----------------------------------------------------------------

fn loan_tokens(n: Int) -> Value {
  from_asset(loan_policy, loan_name, n)
}

fn coll_tokens(n: Int) -> Value {
  from_asset(coll_policy, coll_name, n)
}

/// The pool UTxO value: its ADA, the NFT and `tokens` of the loan asset.
fn pool_value(ada: Int, tokens: Int) -> Value {
  from_lovelace(ada)
    |> merge(from_asset(nft_policy, pool_nft_name, 1))
    |> merge(loan_tokens(tokens))
}

fn token_pool(
  total_borrowed: Int,
  open: List<Int>,
  used: List<Int>,
) -> PoolDatumV5 {
  PoolDatumV5 {
    total_deposited: 100_000_000,
    total_borrowed,
    interest_rate: 500,
    group_root,
    group_next_index: 1,
    repaid_root: old_repaid_root,
    next_index: 0,
    external_nullifier: ext,
    repay_external_nullifier: repay_ext,
    loan_asset: loan_token,
    collateral_assets: [ada_collateral, tok_collateral],
    loan_denomination: loan_amt,
    open_loans: open,
    used_nullifiers: used,
    last_updated: 0,
    lender_root: old_repaid_root,
    lender_next_index: 0,
    total_shares: 10,
    lender_nullifiers: [],
    lender_external_nullifier: 9999,
    share_start_price: 10_000_000,
    liquidity_reserve: 0,
  }
}

fn ref_input(oref: OutputReference, datum: Data) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: from_script(#"deadbeef"),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(datum),
      reference_script: None,
    },
  }
}

fn pool_input(pd: PoolDatumV5, value: Value) -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value,
      datum: InlineDatum(pd),
      reference_script: None,
    },
  }
}

fn pool_out(pd: PoolDatumV5, value: Value) -> Output {
  Output {
    address: from_script(pool_hash),
    value,
    datum: InlineDatum(pd),
    reference_script: None,
  }
}

fn tagged(to: ByteArray, value: Value, tag: Data) -> Output {
  Output {
    address: from_verification_key(to),
    value,
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

fn run_pool(pd: PoolDatumV5, redeemer: PoolRedeemerV5, tx: Transaction) -> Bool {
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    rvk_oref,
    avk_oref,
    lwvk_oref,
    Some(pd),
    redeemer,
    pool_oref,
    tx,
  )
}

// ---- token pool: borrow -----------------------------------------------------

fn borrow_redeemer() -> PoolRedeemerV5 {
  BorrowAnonymous {
    proof: proof(),
    loan_nullifier: loan_null,
    recipient: recipient_pkh,
  }
}

fn borrowed_pool() -> PoolDatumV5 {
  token_pool(loan_amt, [loan_null], [loan_null])
}

fn borrow_tx(out_value: Value, payout: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      pool_input(token_pool(0, [], []), pool_value(pool_ada, 100_000_000)),
    ],
    reference_inputs: [ref_input(vk_oref, vkey())],
    outputs: [pool_out(borrowed_pool(), out_value), payout],
  }
}

fn loan_payout() -> Output {
  tagged(
    recipient_pkh,
    merge(from_lovelace(min_ada), loan_tokens(loan_amt)),
    loan_null,
  )
}

test token_borrow_succeeds() {
  // The loan leaves in the loan token; the pool's ADA and NFT stay.
  run_pool(
    token_pool(0, [], []),
    borrow_redeemer(),
    borrow_tx(pool_value(pool_ada, 100_000_000 - loan_amt), loan_payout()),
  )
}

test token_borrow_paid_in_ada_fails() {
  // The recipient gets ADA instead of the loan token.
  !run_pool(
    token_pool(0, [], []),
    borrow_redeemer(),
    borrow_tx(
      pool_value(pool_ada, 100_000_000 - loan_amt),
      tagged(recipient_pkh, from_lovelace(loan_amt), loan_null),
    ),
  )
}

test token_borrow_takes_pool_ada_fails() {
  // The loan is paid correctly, but the pool's own ADA is drained as well.
  !run_pool(
    token_pool(0, [], []),
    borrow_redeemer(),
    borrow_tx(pool_value(1_000_000, 100_000_000 - loan_amt), loan_payout()),
  )
}

test token_borrow_takes_more_tokens_fails() {
  // The pool gives out more of the loan token than one loan denomination.
  !run_pool(
    token_pool(0, [], []),
    borrow_redeemer(),
    borrow_tx(pool_value(pool_ada, 100_000_000 - loan_amt - 1), loan_payout()),
  )
}

test token_borrow_adds_foreign_token_to_pool_fails() {
  // Nothing but the loan asset may enter or leave the pool UTxO.
  !run_pool(
    token_pool(0, [], []),
    borrow_redeemer(),
    borrow_tx(
      merge(pool_value(pool_ada, 100_000_000 - loan_amt), coll_tokens(1)),
      loan_payout(),
    ),
  )
}

test borrow_rewriting_loan_asset_fails() {
  let out =
    PoolDatumV5 {
      ..borrowed_pool(),
      loan_asset: Asset { policy_id: #"", asset_name: #"" },
    }
  let tx =
    Transaction {
      ..borrow_tx(pool_value(pool_ada, 100_000_000 - loan_amt), loan_payout()),
      outputs: [
        pool_out(out, pool_value(pool_ada, 100_000_000 - loan_amt)),
        loan_payout(),
      ],
    }
  !run_pool(token_pool(0, [], []), borrow_redeemer(), tx)
}

// ---- token pool: repay ------------------------------------------------------

const due: Int = 10_500_000

fn repay_redeemer() -> PoolRedeemerV5 {
  RepayAnonymous {
    proof: repay_proof(),
    loan_nullifier: loan_null,
    repay_nullifier: repay_null,
    append_proof: append_proof(),
  }
}

fn repaid_pool() -> PoolDatumV5 {
  PoolDatumV5 { ..token_pool(0, [], [loan_null]), repaid_root, next_index: 1 }
}

fn repay_tx(out_value: Value) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [pool_input(borrowed_pool(), pool_value(pool_ada, 90_000_000))],
    reference_inputs: [
      ref_input(rvk_oref, repay_vkey()),
      ref_input(avk_oref, append_vkey()),
    ],
    outputs: [pool_out(repaid_pool(), out_value)],
  }
}

test token_repay_succeeds() {
  // Exactly principal + interest, in the loan token.
  run_pool(
    borrowed_pool(),
    repay_redeemer(),
    repay_tx(pool_value(pool_ada, 90_000_000 + due)),
  )
}

test token_repay_in_ada_fails() {
  // The same amount paid in ADA does not repay a token loan.
  !run_pool(
    borrowed_pool(),
    repay_redeemer(),
    repay_tx(pool_value(pool_ada + due, 90_000_000)),
  )
}

test token_repay_below_interest_fails() {
  !run_pool(
    borrowed_pool(),
    repay_redeemer(),
    repay_tx(pool_value(pool_ada, 90_000_000 + loan_amt)),
  )
}

// ---- token pool: lender withdraw --------------------------------------------

/// Two shares worth 21 tokens in total, nothing lent out: 10.5 tokens per share.
fn two_share_pool() -> PoolDatumV5 {
  PoolDatumV5 {
    ..token_pool(0, [], []),
    lender_root: lender_root_2,
    lender_next_index: 2,
    total_shares: 2,
  }
}

fn withdraw_tx(out_value: Value, payout: Output) -> Transaction {
  let out =
    PoolDatumV5 {
      ..two_share_pool(),
      total_shares: 1,
      lender_nullifiers: [withdraw_null],
    }
  Transaction {
    ..placeholder,
    inputs: [pool_input(two_share_pool(), pool_value(pool_ada, 21_000_000))],
    reference_inputs: [ref_input(lwvk_oref, lender_withdraw_vkey())],
    outputs: [pool_out(out, out_value), payout],
  }
}

fn withdraw_redeemer() -> PoolRedeemerV5 {
  WithdrawLiquidity {
    proof: lender_withdraw_proof(),
    withdraw_nullifier: withdraw_null,
    recipient: lender_recipient_pkh,
  }
}

test token_withdraw_share_succeeds() {
  run_pool(
    two_share_pool(),
    withdraw_redeemer(),
    withdraw_tx(
      pool_value(pool_ada, 10_500_000),
      tagged(
        lender_recipient_pkh,
        merge(from_lovelace(min_ada), loan_tokens(10_500_000)),
        withdraw_null,
      ),
    ),
  )
}

test token_withdraw_paid_in_ada_fails() {
  !run_pool(
    two_share_pool(),
    withdraw_redeemer(),
    withdraw_tx(
      pool_value(pool_ada, 10_500_000),
      tagged(lender_recipient_pkh, from_lovelace(10_500_000), withdraw_null),
    ),
  )
}

// ---- deposits of several collateral assets ----------------------------------

fn empty_group_pool() -> PoolDatumV5 {
  PoolDatumV5 {
    ..token_pool(0, [], []),
    group_root: old_repaid_root,
    group_next_index: 0,
  }
}

fn deposited_pool() -> PoolDatumV5 {
  PoolDatumV5 { ..empty_group_pool(), group_root, group_next_index: 1 }
}

fn owner_addr() -> Address {
  from_verification_key(
    #"0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e",
  )
}

fn deposit_datum() -> DepositDatumV5 {
  DepositDatumV5 { commitment, timestamp: 100, unlock_to: owner_addr() }
}

fn collateral_out(value: Value) -> Output {
  Output {
    address: from_script(coll_hash),
    value,
    datum: InlineDatum(deposit_datum()),
    reference_script: None,
  }
}

fn run_deposit(asset_index: Int, out_pool: PoolDatumV5, coll: Output) -> Bool {
  let value = pool_value(pool_ada, 100_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(empty_group_pool(), value)],
      reference_inputs: [ref_input(avk_oref, append_vkey())],
      outputs: [pool_out(out_pool, value), coll],
    }
  run_pool(
    empty_group_pool(),
    DepositCollateral {
      commitment,
      asset_index,
      append_proof: group_append_proof(),
    },
    tx,
  )
}

fn tok_deposit() -> Output {
  collateral_out(merge(from_lovelace(min_ada), coll_tokens(tok_denomination)))
}

test deposit_ada_collateral_in_token_pool_succeeds() {
  run_deposit(0, deposited_pool(), collateral_out(from_lovelace(20_000_000)))
}

test deposit_second_collateral_asset_succeeds() {
  // The token collateral joins the same commitment set as ADA collateral.
  run_deposit(1, deposited_pool(), tok_deposit())
}

test deposit_second_asset_wrong_amount_fails() {
  !run_deposit(
    1,
    deposited_pool(),
    collateral_out(
      merge(from_lovelace(min_ada), coll_tokens(tok_denomination - 1)),
    ),
  )
}

test deposit_ada_under_token_index_fails() {
  // Index 1 names the token; 20 ADA without the token does not satisfy it.
  !run_deposit(1, deposited_pool(), collateral_out(from_lovelace(20_000_000)))
}

test deposit_token_under_ada_index_fails() {
  // Index 0 names ADA (exactly 20 ADA); the token deposit carries only min ADA.
  !run_deposit(0, deposited_pool(), tok_deposit())
}

test deposit_unlisted_asset_index_fails() fail {
  run_deposit(2, deposited_pool(), tok_deposit())
}

test deposit_negative_asset_index_fails() fail {
  run_deposit(-1, deposited_pool(), tok_deposit())
}

test deposit_rewriting_collateral_assets_fails() {
  // Adding a cheap asset to the accepted list is not possible on any spend.
  let out =
    PoolDatumV5 {
      ..deposited_pool(),
      collateral_assets: [
        ada_collateral,
        CollateralAsset { ..tok_collateral, denomination: 1 },
      ],
    }
  !run_deposit(1, out, tok_deposit())
}

// ---- unlock of token collateral ---------------------------------------------

fn tok_coll_value() -> Value {
  merge(from_lovelace(min_ada), coll_tokens(tok_denomination))
}

fn run_unlock(payout_value: Value) -> Bool {
  let settled =
    PoolDatumV5 { ..token_pool(0, [], [loan_null]), repaid_root, next_index: 1 }
  let coll_in =
    Input {
      output_reference: coll_oref,
      output: Output {
        address: from_script(coll_hash),
        value: tok_coll_value(),
        datum: InlineDatum(deposit_datum()),
        reference_script: None,
      },
    }
  let pool_ref =
    Input {
      output_reference: pool_oref,
      output: Output {
        address: from_script(pool_hash),
        value: pool_value(pool_ada, 100_000_000),
        datum: InlineDatum(settled),
        reference_script: None,
      },
    }
  let payout: Output =
    Output {
      address: owner_addr(),
      value: payout_value,
      datum: InlineDatum(coll_oref),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_in],
      reference_inputs: [pool_ref, ref_input(svk_oref, settlement_vkey())],
      outputs: [payout],
    }
  let redeemer: Redeemer =
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref }
  expect r: types_v5.CollateralRedeemerV5 = redeemer
  collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum()),
    r,
    coll_oref,
    tx,
  )
}

test unlock_token_collateral_succeeds() {
  // The full deposit comes back: the token and its min ADA.
  run_unlock(tok_coll_value())
}

test unlock_token_collateral_paid_in_ada_fails() {
  !run_unlock(from_lovelace(50_000_000))
}

test unlock_token_collateral_short_of_token_fails() {
  !run_unlock(merge(from_lovelace(min_ada), coll_tokens(tok_denomination - 1)))
}

test unlock_token_collateral_without_its_min_ada_fails() {
  !run_unlock(merge(from_lovelace(1_000_000), coll_tokens(tok_denomination)))
}
