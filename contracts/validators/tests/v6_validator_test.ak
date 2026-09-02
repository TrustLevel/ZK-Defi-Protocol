//// Validator-level adversarial tests for the v6 private model, using REAL
//// on-chain proofs from the fixture (semaphore_onchain_test). Covers the
//// reshaped borrow (membership), repay (interest + nullifier removal) and unlock
//// (settlement proof: commitment-bound + Merkle membership of the PRIVATE
//// repayment nullifier in the pool's append-only repaid_root). The critical one
//// is `unlock_without_repay_fails`: a valid settlement proof cannot verify
//// against a repaid_root that does not (yet) contain R — preserving the
//// Reviewer-2 "no unlock without repayment" guarantee. Unlock also no longer
//// carries the borrow-time loan_nullifier (Leak-2 fix), enforced structurally.

use cardano/address.{from_script}
use cardano/assets.{from_lovelace}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use types_v5.{
  BorrowAnonymous, DepositDatumV5, PoolDatumV5, RepayAnonymous, UnlockDeposit,
}
use semaphore_onchain_test.{
  commitment, ext, group_root, loan_amt, loan_null, proof, ratio, repaid_root,
  repay_ext, settlement_proof, settlement_vkey, vkey,
}
use v5/collateral_v5
use v5/lending_pool_v5

const pool_hash: ByteArray = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const coll_hash: ByteArray = #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const admin_pkh: ByteArray = #"0011223344556677889900112233445566778899001122334455667788"

// Models a repaid_root that does not contain R (e.g. before the admin has
// inserted the repayment nullifier via SetRoots). Any root != the fixture's
// R-inclusive `repaid_root` makes the membership proof unsatisfiable.
const empty_repaid_root: Int = 0

const pool_oref: OutputReference =
  OutputReference { transaction_id: #"b0", output_index: 0 }

const vk_oref: OutputReference =
  OutputReference { transaction_id: #"b1", output_index: 0 }

const svk_oref: OutputReference =
  OutputReference { transaction_id: #"b2", output_index: 0 }

const coll_oref: OutputReference =
  OutputReference { transaction_id: #"b3", output_index: 0 }

fn pool_datum(total_borrowed: Int, open_loans: List<Int>, repaid: Int) -> PoolDatumV5 {
  PoolDatumV5 {
    total_deposited: 100_000_000,
    total_borrowed,
    interest_rate: 500,
    collateral_ratio: ratio,
    vkey_ref: vk_oref,
    settlement_vkey_ref: svk_oref,
    group_root,
    repaid_root: repaid,
    external_nullifier: ext,
    repay_external_nullifier: repay_ext,
    loan_denomination: loan_amt,
    open_loans,
    admin: admin_pkh,
    last_updated: 0,
  }
}

fn vk_ref_input() -> Input {
  Input {
    output_reference: vk_oref,
    output: Output {
      address: from_script(#"deadbeef"),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(vkey()),
      reference_script: None,
    },
  }
}

fn svk_ref_input() -> Input {
  Input {
    output_reference: svk_oref,
    output: Output {
      address: from_script(#"deadbeef"),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(settlement_vkey()),
      reference_script: None,
    },
  }
}

fn pool_input(pd: PoolDatumV5, lovelace: Int) -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value: from_lovelace(lovelace),
      datum: InlineDatum(pd),
      reference_script: None,
    },
  }
}

fn pool_out(pd: PoolDatumV5, lovelace: Int) -> Output {
  Output {
    address: from_script(pool_hash),
    value: from_lovelace(lovelace),
    datum: InlineDatum(pd),
    reference_script: None,
  }
}

// ---- Borrow ----------------------------------------------------------------

test borrow_membership_succeeds() {
  let pd = pool_datum(0, [], repaid_root)
  let new_loan = loan_null
  let out = pool_datum(loan_amt, [new_loan], repaid_root)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt)],
    }
  lending_pool_v5.lending_pool_v5.spend(
    Some(pd),
    BorrowAnonymous { proof: proof(), loan_amount: loan_amt, loan_nullifier: loan_null },
    pool_oref,
    tx,
  )
}

test borrow_reused_nullifier_fails() {
  // The loan nullifier is already outstanding -> no second loan on it.
  let existing = loan_null
  let pd = pool_datum(loan_amt, [existing], repaid_root)
  let out = pool_datum(loan_amt * 2, [existing, existing], repaid_root)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    Some(pd),
    BorrowAnonymous { proof: proof(), loan_amount: loan_amt, loan_nullifier: loan_null },
    pool_oref,
    tx,
  )
}

// ---- Repay (interest) ------------------------------------------------------

// principal 10_000_000 at 500 bps -> interest 500_000 -> due 10_500_000.
test repay_principal_plus_interest_succeeds() {
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], repaid_root)
  let out = pool_datum(0, [], repaid_root)
  let repay = 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  lending_pool_v5.lending_pool_v5.spend(
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: 0,
    },
    pool_oref,
    tx,
  )
}

test repay_below_interest_fails() {
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], repaid_root)
  let out = pool_datum(0, [], repaid_root)
  let repay = 10_000_000
  // pays only principal, no interest -> due is 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: 0,
    },
    pool_oref,
    tx,
  )
}

// ---- Unlock (settlement proof, private model) ------------------------------

fn deposit_datum(cmt: Int) -> DepositDatumV5 {
  DepositDatumV5 { commitment: cmt, timestamp: 100 }
}

fn coll_input(cmt: Int) -> Input {
  Input {
    output_reference: coll_oref,
    output: Output {
      address: from_script(coll_hash),
      value: from_lovelace(20_000_000),
      datum: InlineDatum(deposit_datum(cmt)),
      reference_script: None,
    },
  }
}

fn pool_ref_input(repaid: Int) -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value: from_lovelace(90_000_000),
      datum: InlineDatum(pool_datum(loan_amt, [], repaid)),
      reference_script: None,
    },
  }
}

test unlock_when_settled_succeeds() {
  // repaid_root contains R -> the settlement membership proof verifies.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root), svk_ref_input()],
    }
  collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_without_repay_fails() {
  // repaid_root does NOT contain R (loan not repaid / R not yet inserted) -> the
  // settlement proof cannot verify. Fail-closed: preserves the Reviewer-2 guarantee.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(empty_repaid_root), svk_ref_input()],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_wrong_commitment_fails() {
  // The spent deposit's commitment differs from the proof's -> binding fails.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment + 1)],
      reference_inputs: [pool_ref_input(repaid_root), svk_ref_input()],
    }
  !collateral_v5.collateral_v5.spend(
    pool_hash,
    Some(deposit_datum(commitment + 1)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_redeemer_carries_no_loan_nullifier() {
  // Structural guarantee (Leak-2): UnlockDeposit has EXACTLY {proof, pool_ref}.
  // This destructuring compiles only because the redeemer no longer carries the
  // borrow-time loan_nullifier — the value that used to re-link borrow<->unlock.
  let r = UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref }
  let UnlockDeposit { proof: _, pool_ref } = r
  pool_ref == pool_oref
}
