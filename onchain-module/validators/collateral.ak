//// Validator to hold utxos containing users' collateral deposits

use aiken/collection/list
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{from_asset, from_lovelace, merge, negate}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input, placeholder,
}
use functions.{
  get_input_from_contract, get_lending_pool_datum, get_loan_status,
  get_loanable_asset_amt, get_protocol_outputs, get_script_hash_frm_output,
  is_collateral_locked, is_signed_by, validate_collateral_output_for_loan_req,
  validate_collateral_output_for_repayment_proc,
  validate_collateral_output_for_repayment_req, validate_protocol_inputs,
}
use test_constants as tc
use types.{
  BorrowProcess, BorrowRequest, CollateralDatum, CollateralValidatorParams,
  LendingPoolDatum, LiquidateCollateral, LoanDatum, LoanProcessed, RepayProcess,
  RepayRequest, RepayRequested, UnifiedRedeemer, WithdrawCollateral,
}

validator collateral(params: CollateralValidatorParams) {
  spend(
    datum: Option<CollateralDatum>,
    redeemer: UnifiedRedeemer,
    output_ref: OutputReference,
    this_tx: Transaction,
  ) {
    expect Some(input_from_self) = this_tx.inputs |> find_input(output_ref)
    expect Some(collateral_datum) = datum
    let owner_key_hash =
      when collateral_datum.owner.payment_credential is {
        VerificationKey(key_hash) -> key_hash
        Script(script_hash) -> script_hash
      }

    when redeemer is {
      WithdrawCollateral -> {
        let collateral_not_locked = !is_collateral_locked(collateral_datum)
        and {
          collateral_not_locked?,
          is_signed_by(this_tx.extra_signatories, owner_key_hash)?,
        }
      }
      BorrowRequest { loan_amt, loan_term, loan_asset } -> {
        expect None == get_loan_status(collateral_datum)
        let signed_by_owner =
          is_signed_by(this_tx.extra_signatories, owner_key_hash)
        let own_hash =
          get_script_hash_frm_output(
            input_from_self.output,
            @"collateral::spend::borrow_req",
          )
        let (inputs_count_valid, _inputs) =
          validate_protocol_inputs(
            redeemer,
            this_tx.inputs,
            own_hash,
            params.lending_pool,
          )
        let protocol_outputs =
          get_protocol_outputs(this_tx.outputs, own_hash, params.lending_pool)
        expect (1 == list.length(protocol_outputs.collateral))?
        expect (0 == list.length(protocol_outputs.lending_pool))?
        expect Some(collateral_output) = list.head(protocol_outputs.collateral)
        let collateral_output_valid =
          validate_collateral_output_for_loan_req(
            collateral_output,
            input_from_self,
            collateral_datum,
            loan_amt,
            loan_term,
            loan_asset,
          )
        and {
          signed_by_owner?,
          inputs_count_valid?,
          collateral_output_valid?,
        }
      }
      BorrowProcess -> {
        // Require spending a utxo from lending_pool, to invoke validator functions there
        expect Some(lender_input) =
          get_input_from_contract(this_tx.inputs, params.lending_pool)
        expect Some(loan_datum) = collateral_datum.used_in
        let loan_amt = loan_datum.borrowed_amt
        let amt_in_pool = get_loanable_asset_amt(lender_input.output, None)
        (amt_in_pool > loan_amt)?
      }
      RepayRequest -> {
        expect Some(loan_status) = get_loan_status(collateral_datum)
        expect loan_status == LoanProcessed
        let signed_by_owner =
          is_signed_by(this_tx.extra_signatories, owner_key_hash)
        let own_hash =
          get_script_hash_frm_output(
            input_from_self.output,
            @"collateral::spend::borrow_req",
          )
        let (inputs_count_valid, _inputs) =
          validate_protocol_inputs(
            redeemer,
            this_tx.inputs,
            own_hash,
            params.lending_pool,
          )
        let protocol_outputs =
          get_protocol_outputs(this_tx.outputs, own_hash, params.lending_pool)
        expect (1 == list.length(protocol_outputs.collateral))?
        expect (0 == list.length(protocol_outputs.lending_pool))?
        expect Some(collateral_output) = list.head(protocol_outputs.collateral)
        let collateral_output_valid =
          validate_collateral_output_for_repayment_req(
            collateral_output,
            input_from_self,
            collateral_datum,
          )
        and {
          signed_by_owner?,
          inputs_count_valid?,
          collateral_output_valid?,
        }
      }
      RepayProcess -> {
        // Require spending a utxo from lending_pool, to invoke validator functions there
        expect Some(lender_input) =
          get_input_from_contract(this_tx.inputs, params.lending_pool)
        expect Some(lender_input_datum) =
          get_lending_pool_datum(lender_input.output.datum)
        let own_hash =
          get_script_hash_frm_output(
            input_from_self.output,
            @"collateral::spend::repay_loan",
          )
        let protocol_outputs =
          get_protocol_outputs(this_tx.outputs, own_hash, params.lending_pool)
        expect Some(collateral_output) = list.head(protocol_outputs.collateral)
        let collateral_output_valid =
          validate_collateral_output_for_repayment_proc(
            input_from_self,
            collateral_output,
            collateral_datum.owner,
            lender_input_datum.collateral_asset,
          )

        collateral_output_valid?
      }
      LiquidateCollateral ->
        // todo @"Liquidate collateral logic here"
        is_signed_by(this_tx.extra_signatories, params.admin_key_hash)
      _ -> fail @"Invalid redeemer"
    }
  }

  /// Unsupported validator purpose
  else(_ctx: ScriptContext) {
    fail @"Unsupported purpose"
  }
}

test withdraw_succeed() {
  let collateral_datum = tc.unlocked_collateral_datum
  let collateral_input = tc.unlocked_collateral_input
  let output_ref = tc.unlocked_collateral_output_ref

  let redeemer = WithdrawCollateral

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      extra_signatories: [tc.user_payment_keyhash],
    }
  collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test withdraw_fail() {
  let collateral_datum = tc.locked_collateral_datum
  // fail point: trying to withdraw a collateral used in an active loan
  let collateral_input = tc.locked_collateral_input
  let output_ref = tc.locked_collateral_output_ref

  let redeemer = WithdrawCollateral

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      extra_signatories: [tc.user_payment_keyhash],
    }
  False == collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test borrow_req_succeed() {
  let collateral_datum = tc.unlocked_collateral_datum
  let collateral_input = tc.unlocked_collateral_input
  let output_ref = tc.unlocked_collateral_output_ref

  let loan_amt = tc.loan_amt
  let loan_term = tc.loan_term
  let loan_asset = tc.loanable_asset

  let collateral_output = tc.loan_reqstd_collateral_input.output

  let redeemer = BorrowRequest { loan_amt, loan_term, loan_asset }

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      outputs: [collateral_output],
      extra_signatories: [tc.user_payment_keyhash],
    }

  collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test borrow_req_fail() {
  let collateral_datum = tc.unlocked_collateral_datum
  let collateral_input = tc.unlocked_collateral_input
  let output_ref = tc.unlocked_collateral_output_ref

  let loan_amt = tc.loan_amt
  let loan_term = tc.loan_term
  let loan_asset = tc.loanable_asset

  let collateral_output_datum =
    CollateralDatum {
      owner: tc.user_address,
      used_in: Some(
        LoanDatum {
          // fail point: wrong status set (should be `LoanRequested`)
          status: RepayRequested,
          borrowed_asset: loan_asset,
          borrowed_amt: loan_amt,
          interest_amt: 0,
          loan_term,
          maturity: 0,
        },
      ),
    }

  let collateral_output =
    Output {
      address: tc.collateral_script_address,
      // fail point: collateral output is less than input
      value: from_lovelace(1_000_000_000 - 1),
      datum: InlineDatum(collateral_output_datum),
      reference_script: None,
    }

  let redeemer = BorrowRequest { loan_amt, loan_term, loan_asset }

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      outputs: [collateral_output],
      extra_signatories: [tc.user_payment_keyhash],
    }

  False == collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test borrow_proc_succeed() {
  let collateral_datum = tc.loan_reqstd_collateral_datum
  let collateral_input = tc.loan_reqstd_collateral_input
  let output_ref = tc.unlocked_collateral_output_ref

  let lp_input = tc.lp_input

  let redeemer = BorrowProcess

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [],
      extra_signatories: [tc.user_payment_keyhash],
    }
  collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test borrow_proc_fail() {
  let collateral_datum = tc.loan_reqstd_collateral_datum
  let collateral_input = tc.loan_reqstd_collateral_input
  let output_ref = tc.unlocked_collateral_output_ref

  // fail point: loanable asset amt in lp_input is less than loan_amt
  let lp_input = tc.low_lp_input

  let redeemer = BorrowProcess

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [],
      extra_signatories: [tc.user_payment_keyhash],
    }
  False == collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test repay_req_succeed() {
  let collateral_datum = tc.locked_collateral_datum
  let collateral_input = tc.locked_collateral_input
  let output_ref = tc.locked_collateral_output_ref

  let collateral_output = tc.repay_reqstd_collateral_input.output

  let redeemer = RepayRequest

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      outputs: [collateral_output],
      extra_signatories: [tc.user_payment_keyhash],
    }
  collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test repay_req_fail() {
  let collateral_datum = tc.locked_collateral_datum
  let collateral_input = tc.locked_collateral_input
  let output_ref = tc.locked_collateral_output_ref

  let collateral_output_datum = tc.repay_reqstd_collateral_datum
  // Fail point: paid short
  let payable_amt = tc.loan_amt + tc.interest_amt - 1

  let redeemer = RepayRequest

  let payable_value =
    from_asset(
      tc.loanable_asset.policy_id,
      tc.loanable_asset.asset_name,
      payable_amt,
    )
  let collateral_output_value =
    merge(collateral_input.output.value, payable_value)
  let collateral_output =
    Output {
      address: tc.collateral_script_address,
      value: collateral_output_value,
      datum: InlineDatum(collateral_output_datum),
      reference_script: None,
    }

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input],
      outputs: [collateral_output],
      extra_signatories: [tc.user_payment_keyhash],
    }
  False == collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test repay_proc_succeed() {
  let collateral_datum = tc.repay_reqstd_collateral_datum
  let collateral_input = tc.repay_reqstd_collateral_input
  let output_ref = tc.locked_collateral_output_ref

  let redeemer = RepayProcess
  let collateral_output_datum = tc.unlocked_collateral_datum
  let payable_amt = tc.loan_amt + tc.interest_amt
  let payable_value =
    from_asset(
      tc.loanable_asset.policy_id,
      tc.loanable_asset.asset_name,
      payable_amt,
    )
  let collateral_output_value =
    payable_value |> negate |> merge(collateral_input.output.value)
  let collateral_output =
    Output {
      address: tc.collateral_script_address,
      value: collateral_output_value,
      datum: InlineDatum(collateral_output_datum),
      reference_script: None,
    }

  let lp_input = tc.lp_input
  let reserve_amt_output =
    tc.starting_reserve_amt + tc.loan_amt + tc.loan_req_datum.interest_amt
  let lp_output_value =
    merge(
      lp_input.output.value,
      from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        reserve_amt_output,
      ),
    )
  let lp_output =
    Output {
      address: tc.lending_pool_script_address,
      value: lp_output_value,
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lp_output],
      extra_signatories: [tc.user_payment_keyhash],
    }
  collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test repay_proc_fail() {
  let collateral_datum = tc.repay_reqstd_collateral_datum
  let collateral_input = tc.repay_reqstd_collateral_input
  let output_ref = tc.locked_collateral_output_ref

  let redeemer = RepayProcess

  let collateral_output_datum =
    CollateralDatum {
      owner: tc.user_address,
      // fail point: wrong datum (`used_in` should already be `None`)
      used_in: Some(
        LoanDatum {
          status: RepayRequested,
          borrowed_asset: tc.loanable_asset,
          borrowed_amt: tc.loan_amt,
          interest_amt: 0,
          loan_term: tc.loan_term,
          maturity: 0,
        },
      ),
    }
  let payable_amt = tc.loan_amt
  let payable_value =
    from_asset(
      tc.loanable_asset.policy_id,
      tc.loanable_asset.asset_name,
      payable_amt,
    )
  let collateral_output_value =
    payable_value |> negate |> merge(collateral_input.output.value)
  let collateral_output =
    Output {
      address: tc.collateral_script_address,
      value: collateral_output_value,
      datum: InlineDatum(collateral_output_datum),
      reference_script: None,
    }

  let lp_input = tc.lp_input
  let reserve_amt_output =
    tc.starting_reserve_amt + tc.loan_amt + tc.loan_req_datum.interest_amt
  let lp_output_value =
    merge(
      lp_input.output.value,
      from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        reserve_amt_output,
      ),
    )
  let lp_output =
    Output {
      address: tc.lending_pool_script_address,
      value: lp_output_value,
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lp_output],
      extra_signatories: [tc.user_payment_keyhash],
    }
  False == collateral.spend(
    tc.collateral_val_params,
    Some(collateral_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}
