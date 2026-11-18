//// Validator-level adversarial tests for the v6 private model, using REAL
//// on-chain proofs from the fixture (semaphore_onchain_test). Covers the
//// reshaped borrow (membership), repay (interest + nullifier removal) and unlock
//// (settlement proof: commitment-bound + Merkle membership of the PRIVATE
//// repayment nullifier in the pool's append-only repaid_root). The critical one
//// is `unlock_without_repay_fails`: a valid settlement proof cannot verify
//// against a repaid_root that does not (yet) contain R — preserving the
//// Reviewer-2 "no unlock without repayment" guarantee. Unlock also no longer
//// carries the borrow-time loan_nullifier (Leak-2 fix), enforced structurally.

use cardano/address.{Address, from_script, from_verification_key}
use cardano/assets.{Value, from_asset, from_lovelace, merge}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use types_v5.{
  AddLiquidity, BorrowAnonymous, DepositCollateral, DepositDatumV5, PoolDatumV5,
  RepayAnonymous, UnlockDeposit, pool_nft_name,
}
use semaphore_onchain_test.{
  append_proof, append_vkey, commitment, ext, group_append_proof, group_root,
  loan_amt, loan_null,
  old_repaid_root, proof, ratio, recipient_pkh, repaid_root, repay_ext,
  repay_null,
  settlement_proof, settlement_vkey, vkey,
}
use v5/collateral_v5
use v5/lending_pool_v5

const pool_hash: ByteArray = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const nft_policy: ByteArray = #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

/// Lovelace plus the one-shot pool NFT — the value of the REAL pool UTxO.
fn pool_value(lovelace: Int) -> Value {
  merge(from_lovelace(lovelace), from_asset(nft_policy, pool_nft_name, 1))
}

const coll_hash: ByteArray = #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const pool_oref: OutputReference =
  OutputReference { transaction_id: #"b0", output_index: 0 }

const vk_oref: OutputReference =
  OutputReference { transaction_id: #"b1", output_index: 0 }

const svk_oref: OutputReference =
  OutputReference { transaction_id: #"b2", output_index: 0 }

const avk_oref: OutputReference =
  OutputReference { transaction_id: #"b4", output_index: 0 }

const coll_oref: OutputReference =
  OutputReference { transaction_id: #"b3", output_index: 0 }

fn pool_datum(
  total_borrowed: Int,
  open_loans: List<Int>,
  repaid: Int,
  nidx: Int,
  used: List<Int>,
) -> PoolDatumV5 {
  PoolDatumV5 {
    total_deposited: 100_000_000,
    total_borrowed,
    interest_rate: 500,
    collateral_ratio: ratio,
    group_root,
    group_next_index: 1,
    repaid_root: repaid,
    next_index: nidx,
    external_nullifier: ext,
    repay_external_nullifier: repay_ext,
    collateral_denomination: 20_000_000,
    loan_denomination: loan_amt,
    open_loans,
    used_nullifiers: used,
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

fn avk_ref_input() -> Input {
  Input {
    output_reference: avk_oref,
    output: Output {
      address: from_script(#"deadbeef"),
      value: from_lovelace(2_000_000),
      datum: InlineDatum(append_vkey()),
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

// ---- Borrow ----------------------------------------------------------------

test borrow_membership_succeeds() {
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let new_loan = loan_null
  let out = pool_datum(loan_amt, [new_loan], old_repaid_root, 0, [new_loan])
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_reused_nullifier_fails() {
  // The loan nullifier is already outstanding -> no second loan on it.
  let existing = loan_null
  let pd = pool_datum(loan_amt, [existing], old_repaid_root, 0, [existing])
  let out =
    pool_datum(loan_amt * 2, [existing, existing], old_repaid_root, 0, [existing, existing])
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_after_repay_same_secret_fails() {
  // One deposit backs exactly ONE loan. After the loan is repaid (nullifier out
  // of open_loans, R in repaid_root) the same secret must not borrow again —
  // otherwise the stale R would let it unlock while the new loan stays open.
  let pd = pool_datum(0, [], repaid_root, 1, [loan_null])
  let out = pool_datum(loan_amt, [loan_null], repaid_root, 1, [loan_null, loan_null])
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_500_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_500_000 - loan_amt), loan_payout()],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_not_recorded_as_used_fails() {
  // Borrow must add the nullifier to used_nullifiers; leaving it out would make
  // the nullifier reusable after repay.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [])
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

// ---- Repay (interest) ------------------------------------------------------

// principal 10_000_000 at 500 bps -> interest 500_000 -> due 10_500_000.
// Repay ALSO self-appends R: repaid_root goes empty (old_repaid_root, index 0) ->
// R-inclusive (repaid_root, index 1), attested by the append proof (no admin).
test repay_principal_plus_interest_succeeds() {
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], old_repaid_root, 0, [loan])
  let out = pool_datum(0, [], repaid_root, 1, [loan])
  let repay = 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input(), avk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      recipient: recipient_pkh,
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: repay_null,
      append_proof: append_proof(),
    },
    pool_oref,
    tx,
  )
}

test repay_clearing_used_nullifier_fails() {
  // Repay settles the open loan but must NOT drop the nullifier from
  // used_nullifiers — that would re-enable a second loan on the same deposit.
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], old_repaid_root, 0, [loan])
  let out = pool_datum(0, [], repaid_root, 1, [])
  let repay = 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input(), avk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      recipient: recipient_pkh,
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: repay_null,
      append_proof: append_proof(),
    },
    pool_oref,
    tx,
  )
}

test repay_below_interest_fails() {
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], old_repaid_root, 0, [loan])
  let out = pool_datum(0, [], repaid_root, 1, [loan])
  let repay = 10_000_000
  // pays only principal, no interest -> due is 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input(), avk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      recipient: recipient_pkh,
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: repay_null,
      append_proof: append_proof(),
    },
    pool_oref,
    tx,
  )
}

test repay_overpay_fails() {
  // Repayments are a fixed amount (exactly principal + interest), so every
  // repay tx looks the same — an odd over-payment would fingerprint the borrower.
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], old_repaid_root, 0, [loan])
  let out = pool_datum(0, [], repaid_root, 1, [loan])
  let repay = 10_700_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input(), avk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      recipient: recipient_pkh,
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: repay_null,
      append_proof: append_proof(),
    },
    pool_oref,
    tx,
  )
}

test repay_bogus_append_fails() {
  // The append proof attests old->new for repaid_root at next_index. If the out
  // datum claims a repaid_root the append proof does NOT attest, repay fails —
  // a repayer cannot fake growth of the settlement set.
  let loan = loan_null
  let pd = pool_datum(loan_amt, [loan], old_repaid_root, 0, [loan])
  let out = pool_datum(0, [], repaid_root + 1, 1, [loan])
  let repay = 10_500_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 90_000_000)],
      reference_inputs: [vk_ref_input(), avk_ref_input()],
      outputs: [pool_out(out, 90_000_000 + repay)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    RepayAnonymous {
      proof: proof(),
      recipient: recipient_pkh,
      repay_amount: repay,
      loan_nullifier: loan_null,
      repay_nullifier: repay_null,
      append_proof: append_proof(),
    },
    pool_oref,
    tx,
  )
}

// ---- Unlock (settlement proof, private model) ------------------------------

/// The borrow payout: the loan to the key the proof is bound to, tagged with
/// the loan nullifier.
fn loan_payout() -> Output {
  Output {
    address: from_verification_key(recipient_pkh),
    value: from_lovelace(loan_amt),
    datum: InlineDatum(loan_null),
    reference_script: None,
  }
}

/// The depositor's chosen unlock recipient (a fresh key address).
fn owner_addr() -> Address {
  from_verification_key(#"0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e")
}

fn deposit_datum(cmt: Int) -> DepositDatumV5 {
  DepositDatumV5 { commitment: cmt, timestamp: 100, unlock_to: owner_addr() }
}

/// The unlock payout: full collateral to the recipient, tagged with the deposit.
fn payout(to: Address, lovelace: Int, tag: OutputReference) -> Output {
  Output {
    address: to,
    value: from_lovelace(lovelace),
    datum: InlineDatum(tag),
    reference_script: None,
  }
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

fn pool_ref_input(repaid: Int, nidx: Int) -> Input {
  Input {
    output_reference: pool_oref,
    output: Output {
      address: from_script(pool_hash),
      value: pool_value(90_000_000),
      datum: InlineDatum(pool_datum(loan_amt, [], repaid, nidx, [loan_null])),
      reference_script: None,
    },
  }
}

test unlock_when_settled_succeeds() {
  // repaid_root contains R (self-appended at repay) -> settlement proof verifies,
  // and the full collateral goes to the recipient fixed at deposit.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root, 1), svk_ref_input()],
      outputs: [payout(owner_addr(), 20_000_000, coll_oref)],
    }
  collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_without_repay_fails() {
  // repaid_root is still the empty root (loan not repaid -> R not appended) -> the
  // settlement proof cannot verify. Fail-closed: preserves the Reviewer-2 guarantee.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(old_repaid_root, 0), svk_ref_input()],
      outputs: [payout(owner_addr(), 20_000_000, coll_oref)],
    }
  !collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
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
      reference_inputs: [pool_ref_input(repaid_root, 1), svk_ref_input()],
      outputs: [payout(owner_addr(), 20_000_000, coll_oref)],
    }
  !collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
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

test unlock_via_forged_pool_ref_fails() fail {
  // The real pool has NOT been repaid. An attacker pays a fresh UTxO to the pool
  // script address (no validator runs on a payment) with a datum whose
  // repaid_root contains R, and points pool_ref at it. Must be rejected.
  let forged_oref = OutputReference { transaction_id: #"ee", output_index: 7 }
  let forged_pool =
    Input {
      output_reference: forged_oref,
      output: Output {
        address: from_script(pool_hash),
        value: from_lovelace(2_000_000),
        datum: InlineDatum(pool_datum(0, [], repaid_root, 1, [loan_null])),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [forged_pool, svk_ref_input()],
    }
  collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: forged_oref },
    coll_oref,
    tx,
  )
}

test unlock_with_vkey_at_other_ref_fails() fail {
  // The settlement vkey is fixed by parameter (svk_oref). A vkey supplied at any
  // other reference input — e.g. one the attacker set up themselves — is ignored,
  // so the unlock cannot be authorized against an attacker-chosen key.
  let attacker_vk =
    Input {
      output_reference: OutputReference { transaction_id: #"ad", output_index: 0 },
      output: Output {
        address: from_script(#"bad0bad0"),
        value: from_lovelace(2_000_000),
        datum: InlineDatum(settlement_vkey()),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root, 1), attacker_vk],
    }
  collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test spend_pool_without_nft_fails() fail {
  // A UTxO at the pool address WITHOUT the pool NFT is not the pool; it must
  // not be spendable as one (closes fake-pool / double-satisfaction tricks).
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let fake =
    Input {
      output_reference: pool_oref,
      output: Output {
        address: from_script(pool_hash),
        value: from_lovelace(100_000_000),
        datum: InlineDatum(pd),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [fake],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test continuing_output_without_nft_fails() fail {
  // The NFT must stay with the pool: a continuing output at the pool address
  // WITHOUT the NFT (NFT moved elsewhere) is rejected.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let no_nft_out =
    Output {
      address: from_script(pool_hash),
      value: from_lovelace(100_000_000 - loan_amt),
      datum: InlineDatum(out),
      reference_script: None,
    }
  let nft_elsewhere =
    Output {
      address: from_script(#"7e1f7e1f"),
      value: pool_value(2_000_000),
      datum: NoDatum,
      reference_script: None,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [no_nft_out, nft_elsewhere],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test continuing_output_other_address_fails() fail {
  // The NFT-carrying continuing output must sit at the SAME pool address.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let moved =
    Output {
      address: from_script(#"7e1f7e1f"),
      value: pool_value(100_000_000 - loan_amt),
      datum: InlineDatum(out),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [moved],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_with_vkey_at_other_ref_fails() fail {
  // The borrow vkey is fixed by parameter (vk_oref); a vkey offered at any
  // other reference input is ignored.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let attacker_vk =
    Input {
      output_reference: OutputReference { transaction_id: #"ad", output_index: 1 },
      output: Output {
        address: from_script(#"bad0bad0"),
        value: from_lovelace(2_000_000),
        datum: InlineDatum(vkey()),
        reference_script: None,
      },
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [attacker_vk],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test group_root_change_without_append_fails() {
  // There is no admin path: group_root can only grow through DepositCollateral
  // with a valid append proof. Any other spend that rewrites it is rejected —
  // so nobody can insert commitments that have no deposit behind them.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out =
    PoolDatumV5 {
      ..pd,
      group_root: 12345,
      total_deposited: pd.total_deposited + 1_000_000,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      outputs: [pool_out(out, 101_000_000)],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    AddLiquidity,
    pool_oref,
    tx,
  )
}

// ---- DepositCollateral (permissionless commitment set) ---------------------

/// Pool state before the first collateral deposit: empty commitment set.
fn empty_group_pool() -> PoolDatumV5 {
  PoolDatumV5 {
    ..pool_datum(0, [], old_repaid_root, 0, []),
    group_root: old_repaid_root,
    group_next_index: 0,
  }
}

fn collateral_out(cmt: Int, lovelace: Int, script: ByteArray) -> Output {
  Output {
    address: from_script(script),
    value: from_lovelace(lovelace),
    datum: InlineDatum(deposit_datum(cmt)),
    reference_script: None,
  }
}

fn deposit_tx(out_pool: PoolDatumV5, coll: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [pool_input(empty_group_pool(), 100_000_000)],
    reference_inputs: [avk_ref_input()],
    outputs: [pool_out(out_pool, 100_000_000), coll],
  }
}

fn run_deposit(tx: Transaction) -> Bool {
  lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(empty_group_pool()),
    DepositCollateral { commitment, append_proof: group_append_proof() },
    pool_oref,
    tx,
  )
}

fn deposited_pool() -> PoolDatumV5 {
  PoolDatumV5 { ..empty_group_pool(), group_root, group_next_index: 1 }
}

test deposit_collateral_succeeds() {
  // Exactly 20 ADA with the commitment to the collateral script, and the append
  // proof takes the empty commitment set to group_root (commitment at index 0).
  run_deposit(
    deposit_tx(deposited_pool(), collateral_out(commitment, 20_000_000, coll_hash)),
  )
}

test deposit_collateral_wrong_amount_fails() {
  // 19 ADA instead of the fixed 20 ADA denomination.
  !run_deposit(
    deposit_tx(deposited_pool(), collateral_out(commitment, 19_000_000, coll_hash)),
  )
}

test deposit_collateral_wrong_address_fails() {
  // The collateral is paid somewhere other than the collateral script.
  !run_deposit(
    deposit_tx(deposited_pool(), collateral_out(commitment, 20_000_000, #"7e1f7e1f")),
  )
}

test deposit_collateral_commitment_mismatch_fails() {
  // The appended commitment must be the one locked in the collateral output.
  !run_deposit(
    deposit_tx(
      deposited_pool(),
      collateral_out(commitment + 1, 20_000_000, coll_hash),
    ),
  )
}

test deposit_collateral_bogus_append_fails() {
  // The out datum claims a group_root the append proof does not attest.
  let out = PoolDatumV5 { ..deposited_pool(), group_root: group_root + 1 }
  !run_deposit(deposit_tx(out, collateral_out(commitment, 20_000_000, coll_hash)))
}

test deposit_collateral_index_not_advanced_fails() {
  let out = PoolDatumV5 { ..deposited_pool(), group_next_index: 0 }
  !run_deposit(deposit_tx(out, collateral_out(commitment, 20_000_000, coll_hash)))
}

test borrow_collateral_denomination_too_small_fails() {
  // A pool configured with collateral (10 ADA) that does not cover the 10 ADA
  // loan at 125 % must refuse to lend.
  let pd =
    PoolDatumV5 {
      ..pool_datum(0, [], old_repaid_root, 0, []),
      collateral_denomination: 10_000_000,
    }
  let out =
    PoolDatumV5 {
      ..pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null]),
      collateral_denomination: 10_000_000,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), loan_payout()],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

// ---- Unlock recipient (front-running) ---------------------------------------

test unlock_to_other_address_fails() {
  // A mempool observer copies a valid unlock proof and pays the collateral to
  // themselves. The collateral must only go to the recipient fixed at deposit.
  let thief =
    Output {
      address: from_script(#"7e1f7e1f"),
      value: from_lovelace(20_000_000),
      datum: InlineDatum(coll_oref),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root, 1), svk_ref_input()],
      outputs: [thief],
    }
  !collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_underpays_recipient_fails() {
  // The recipient output carries less than the collateral (rest siphoned off).
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root, 1), svk_ref_input()],
      outputs: [payout(owner_addr(), 19_000_000, coll_oref)],
    }
  !collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

test unlock_payout_tagged_for_other_deposit_fails() {
  // Double satisfaction: the only recipient output is tagged for ANOTHER deposit
  // of the same owner, so it cannot also count as this deposit's payout.
  let other = OutputReference { transaction_id: #"b9", output_index: 0 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [coll_input(commitment)],
      reference_inputs: [pool_ref_input(repaid_root, 1), svk_ref_input()],
      outputs: [payout(owner_addr(), 20_000_000, other)],
    }
  !collateral_v5.collateral_v5.spend(
    nft_policy,
    svk_oref,
    Some(deposit_datum(commitment)),
    UnlockDeposit { proof: settlement_proof(), pool_ref: pool_oref },
    coll_oref,
    tx,
  )
}

// ---- Borrow recipient (front-running) ---------------------------------------

test borrow_payout_to_other_key_fails() {
  // A copied borrow proof whose loan is paid to the front-runner, not to the
  // recipient the proof was made for.
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let thief =
    Output {
      address: from_verification_key(#"7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f"),
      value: from_lovelace(loan_amt),
      datum: InlineDatum(loan_null),
      reference_script: None,
    }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), thief],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_underpays_recipient_fails() {
  // The recipient output carries less than the loan (rest kept by the builder).
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let short =
    Output { ..loan_payout(), value: from_lovelace(loan_amt - 1_000_000) }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), short],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: recipient_pkh,
    },
    pool_oref,
    tx,
  )
}

test borrow_redeemer_recipient_swapped_fails() {
  // The front-runner swaps the redeemer recipient to their own key and pays the
  // loan there: the proof was made for recipient_pkh, so it no longer verifies.
  let thief_pkh = #"7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f7e1f"
  let pd = pool_datum(0, [], old_repaid_root, 0, [])
  let out = pool_datum(loan_amt, [loan_null], old_repaid_root, 0, [loan_null])
  let to_thief =
    Output { ..loan_payout(), address: from_verification_key(thief_pkh) }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [pool_input(pd, 100_000_000)],
      reference_inputs: [vk_ref_input()],
      outputs: [pool_out(out, 100_000_000 - loan_amt), to_thief],
    }
  !lending_pool_v5.lending_pool_v5.spend(
    nft_policy,
    coll_hash,
    vk_oref,
    avk_oref,
    Some(pd),
    BorrowAnonymous {
      proof: proof(),
      loan_amount: loan_amt,
      loan_nullifier: loan_null,
      recipient: thief_pkh,
    },
    pool_oref,
    tx,
  )
}
