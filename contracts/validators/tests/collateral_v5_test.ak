//// Adversarial tests for collateral_v5 (Workstream F).
//// These encode the reviewer findings as failing-closed negatives plus the
//// intended positives. The critical one is `unlock_while_locked_fails` +
//// `settle_without_pool_repay_fails` — together they close Reviewer-2's
//// "unlock full collateral after partial/no repayment".

use cardano/address.{from_script}
use cardano/assets.{from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction, placeholder,
}
use ak_381/groth16.{Proof, SnarkVerificationKey}
use types_v5.{
  DepositDatumV5, PoolDatumV5, RepayAnonymous, SettleLoan, UnlockDeposit,
  UsedAsCollateral, Withdraw,
}
use v5/collateral_v5

// ---- fixtures ---------------------------------------------------------------

const pool_hash: ByteArray = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const coll_hash: ByteArray = #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const owner_pkh: ByteArray = #"0011223344556677889900112233445566778899001122334455667788"

const commitment_val: Int = 12345

const coll_oref: OutputReference =
  OutputReference { transaction_id: #"aa", output_index: 0 }

const pool_oref: OutputReference =
  OutputReference { transaction_id: #"bb", output_index: 0 }

const vkey_oref: OutputReference =
  OutputReference { transaction_id: #"cc", output_index: 0 }

fn deposit_datum(loan_bound: Option<Int>) -> DepositDatumV5 {
  DepositDatumV5 {
    owner: owner_pkh,
    collateral_amount: 20_000_000,
    commitment: commitment_val,
    timestamp: 100,
    loan_bound,
  }
}

fn coll_input(loan_bound: Option<Int>, lovelace: Int) -> Input {
  Input {
    output_reference: coll_oref,
    output: Output {
      address: from_script(coll_hash),
      value: from_lovelace(lovelace),
      datum: InlineDatum(deposit_datum(loan_bound)),
      reference_script: None,
    },
  }
}

fn coll_output(datum: DepositDatumV5, lovelace: Int) -> Output {
  Output {
    address: from_script(coll_hash),
    value: from_lovelace(lovelace),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn dummy_vkey() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: 3,
    vkAlpha: #"",
    vkBeta: #"",
    vkGamma: #"",
    vkDelta: #"",
    vkAlphaBeta: [],
    vkIC: [],
  }
}

fn dummy_proof() -> Proof {
  Proof { piA: #"00", piB: #"00", piC: #"00" }
}

fn pool_datum() -> PoolDatumV5 {
  PoolDatumV5 {
    total_deposited: 100_000_000,
    total_borrowed: 0,
    interest_rate: 500,
    collateral_ratio: 125,
    vkey_ref: vkey_oref,
    open_loans_root: #"",
    last_updated: 0,
  }
}

// Reference inputs (pool datum + parked vkey) used by the Unlock branch.
fn unlock_reference_inputs() -> List<Input> {
  [
    Input {
      output_reference: pool_oref,
      output: Output {
        address: from_script(pool_hash),
        value: from_lovelace(100_000_000),
        datum: InlineDatum(pool_datum()),
        reference_script: None,
      },
    },
    Input {
      output_reference: vkey_oref,
      output: Output {
        address: from_script(#"deadbeef"),
        value: from_lovelace(2_000_000),
        datum: InlineDatum(dummy_vkey()),
        reference_script: None,
      },
    },
  ]
}

// ---- Withdraw ---------------------------------------------------------------

test withdraw_free_with_owner_sig_succeeds() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(None, 20_000_000)],
      extra_signatories: [owner_pkh],
    }
  collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(None)),
    Withdraw,
    coll_oref,
    tx,
  )
}

test withdraw_locked_fails() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(Some(777), 20_000_000)],
      extra_signatories: [owner_pkh],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(Some(777))),
    Withdraw,
    coll_oref,
    tx,
  )
}

test withdraw_without_owner_sig_fails() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(None, 20_000_000)],
      extra_signatories: [],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(None)),
    Withdraw,
    coll_oref,
    tx,
  )
}

// ---- UsedAsCollateral (lock) ------------------------------------------------

test lock_ok_succeeds() {
  let out = coll_output(deposit_datum(Some(777)), 20_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(None, 20_000_000)],
      outputs: [out],
    }
  collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(None)),
    UsedAsCollateral { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

test lock_datum_rewrite_fails() {
  // Continuation rewrites the commitment -> datum takeover must be rejected (A1).
  let tampered =
    DepositDatumV5 { ..deposit_datum(Some(777)), commitment: 99999 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(None, 20_000_000)],
      outputs: [coll_output(tampered, 20_000_000)],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(None)),
    UsedAsCollateral { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

test lock_value_drain_fails() {
  let out = coll_output(deposit_datum(Some(777)), 5_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(None, 20_000_000)],
      outputs: [out],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(None)),
    UsedAsCollateral { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

// ---- SettleLoan (free) ------------------------------------------------------

// Upcast a typed value to Data (Redeemer = Data); the parameter position forces it.
fn into_data(d: Data) -> Data {
  d
}

fn pool_repay_redeemer(nullifier: Int) -> Data {
  into_data(
    RepayAnonymous {
      deposit_ref: coll_oref,
      proof: dummy_proof(),
      repay_amount: 10_000_000,
      loan_nullifier: nullifier,
    },
  )
}

fn spent_pool_input() -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value: from_lovelace(100_000_000),
      datum: InlineDatum(pool_datum()),
      reference_script: None,
    },
  }
}

test settle_with_matching_pool_repay_succeeds() {
  let out = coll_output(deposit_datum(None), 20_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(Some(777), 20_000_000), spent_pool_input()],
      outputs: [out],
      redeemers: [Pair(Spend(pool_oref), pool_repay_redeemer(777))],
    }
  collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(Some(777))),
    SettleLoan { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

test settle_without_pool_repay_fails() {
  // No pool input / no repay -> collateral cannot be freed.
  let out = coll_output(deposit_datum(None), 20_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(Some(777), 20_000_000)],
      outputs: [out],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(Some(777))),
    SettleLoan { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

test settle_wrong_nullifier_fails() {
  // Pool repays a DIFFERENT loan -> this collateral cannot be freed.
  let out = coll_output(deposit_datum(None), 20_000_000)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(Some(777), 20_000_000), spent_pool_input()],
      outputs: [out],
      redeemers: [Pair(Spend(pool_oref), pool_repay_redeemer(555))],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(Some(777))),
    SettleLoan { loan_nullifier: 777 },
    coll_oref,
    tx,
  )
}

// ---- UnlockDeposit (the Reviewer-2 critical gate) ---------------------------

test unlock_while_locked_fails() {
  // A still-loaned deposit (loan_bound = Some) can never be unlocked, regardless
  // of the proof. This is the direct fix for "unlock full collateral after
  // partial/no repayment".
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(Some(777), 20_000_000)],
      reference_inputs: unlock_reference_inputs(),
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(Some(777))),
    UnlockDeposit { proof: dummy_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

