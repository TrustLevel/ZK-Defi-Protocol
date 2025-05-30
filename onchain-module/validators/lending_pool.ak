//// Validator to hold the lending pool utxo which contains the loanable asset

use aiken/collection/list
use aiken/interval
use cardano/assets.{from_asset}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{
  InlineDatum, NoDatum, Output, OutputReference, Transaction, find_input,
  placeholder,
}
use functions.{
  calc_amt_user_can_borrow, get_collateral_amt_in_output, get_collateral_datum,
  get_protocol_outputs, get_script_hash_frm_output, get_upper_bound,
  is_collateral_locked, is_signed_by, validate_collateral_output_for_loan_proc,
  validate_lending_pool_output, validate_protocol_inputs,
  validate_tx_validity_range,
}
use test_constants as tc
use types.{
  BorrowProcess, CollateralDatum, LendingPoolDatum, LendingPoolValidatorParams,
  LoanRequested, ProtocolOutputs, RepayProcess, RepayRequested, UnifiedRedeemer,
  WithdrawLendingPool,
}

validator lending_pool(params: LendingPoolValidatorParams) {
  spend(
    datum: Option<LendingPoolDatum>,
    redeemer: UnifiedRedeemer,
    output_ref: OutputReference,
    this_tx: Transaction,
  ) {
    expect Some(lending_pool_datum) = datum
    expect Some(input_from_self) = this_tx.inputs |> find_input(output_ref)
    let own_hash =
      get_script_hash_frm_output(input_from_self.output, @"lending_pool::spend")

    when redeemer is {
      BorrowProcess -> {
        let (inputs_count_valid, protocol_inputs) =
          validate_protocol_inputs(
            redeemer,
            this_tx.inputs,
            lending_pool_datum.collateral_contract,
            own_hash,
          )
        expect Some(collateral_input) = list.head(protocol_inputs.collateral)
        let collateral_amt =
          get_collateral_amt_in_output(
            collateral_input.output,
            lending_pool_datum.collateral_asset,
          )
        expect Some(collateral_input_datum) =
          get_collateral_datum(collateral_input.output.datum)
        let collateral_is_unlocked =
          !is_collateral_locked(collateral_input_datum)
        expect Some(loan_req) = collateral_input_datum.used_in
        expect (loan_req.status == LoanRequested)?
        let loanable_amt =
          calc_amt_user_can_borrow(collateral_amt, lending_pool_datum)

        // trace @"loan_amt        ": loan_req.borrowed_amt
        // trace @"collateral_amt  ": collateral_amt
        // trace @"collateral_ratio": lending_pool_datum.collateral_ratio
        // trace @"loanable_amt    ": loanable_amt
        let protocol_outputs =
          get_protocol_outputs(
            this_tx.outputs,
            lending_pool_datum.collateral_contract,
            own_hash,
          )
        expect (1 == list.length(protocol_outputs.collateral))?
        expect (1 == list.length(protocol_outputs.lending_pool))?
        expect Some(collateral_output) = list.head(protocol_outputs.collateral)
        expect Some(lending_pool_output) =
          list.head(protocol_outputs.lending_pool)
        let validity_range_valid =
          validate_tx_validity_range(this_tx.validity_range)
        let (collateral_output_valid, loan) =
          validate_collateral_output_for_loan_proc(
            collateral_output,
            collateral_input_datum.owner,
            collateral_amt,
            loan_req,
            lending_pool_datum,
            this_tx.validity_range,
          )
        let lending_pool_output_valid =
          validate_lending_pool_output(
            input_from_self,
            lending_pool_output,
            lending_pool_datum,
            loan,
            redeemer,
          )

        and {
          inputs_count_valid?,
          collateral_is_unlocked?,
          (loan_req.borrowed_amt <= loanable_amt)?,
          validity_range_valid?,
          collateral_output_valid?,
          lending_pool_output_valid?,
        }
      }

      RepayProcess -> {
        let (inputs_count_valid, protocol_inputs) =
          validate_protocol_inputs(
            redeemer,
            this_tx.inputs,
            lending_pool_datum.collateral_contract,
            own_hash,
          )

        expect Some(collateral_input) = list.head(protocol_inputs.collateral)
        expect Some(collateral_input_datum) =
          get_collateral_datum(collateral_input.output.datum)
        expect Some(loan) = collateral_input_datum.used_in
        expect (loan.status == RepayRequested)?
        // Use upper bound of tx validity range as reckoning time of payment.
        // to counter back-dating of repayment transaction
        let repayment_time = get_upper_bound(this_tx.validity_range)

        trace @"repayment_time ": repayment_time
        trace @"loan.maturity  ": loan.maturity

        let protocol_outputs =
          get_protocol_outputs(
            this_tx.outputs,
            lending_pool_datum.collateral_contract,
            own_hash,
          )
        expect (1 == list.length(protocol_outputs.collateral))?
        expect (1 == list.length(protocol_outputs.lending_pool))?
        expect Some(lending_pool_output) =
          list.head(protocol_outputs.lending_pool)
        let validity_range_valid =
          validate_tx_validity_range(this_tx.validity_range)
        let lending_pool_output_valid =
          validate_lending_pool_output(
            input_from_self,
            lending_pool_output,
            lending_pool_datum,
            loan,
            redeemer,
          )
        and {
          inputs_count_valid?,
          lending_pool_output_valid?,
          validity_range_valid?,
          (repayment_time <= loan.maturity)?,
        }
      }
      WithdrawLendingPool ->
        // for admin only, when closing or withdrawing from the lending pool
        is_signed_by(this_tx.extra_signatories, params.admin_key_hash)
      _ -> fail @"Invalid redeemer"
    }
  }

  else(_ctx: ScriptContext) {
    False
  }
}

test borrow_proc_succeed() {
  let collateral_input = tc.loan_reqstd_collateral_input
  let collateral_output = tc.locked_collateral_input.output

  let lp_input = tc.lp_input
  let output_ref = tc.lending_pool_output_ref
  let remaining_reserve_amt = tc.starting_reserve_amt - tc.loan_amt
  let lp_output =
    Output {
      address: tc.lending_pool_script_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        remaining_reserve_amt,
      ),
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let loan_proceeds_output =
    Output {
      address: tc.user_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        tc.loan_amt,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let redeemer = BorrowProcess

  let valid_til = tc.maturity_time - tc.loan_term
  // 2 hrs
  let valid_from = valid_til - 7_200_000
  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lp_output, loan_proceeds_output],
      validity_range: interval.between(valid_from, valid_til),
    }
  lending_pool.spend(
    tc.lending_pool_val_params,
    Some(tc.lp_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test borrow_proc_fail() {
  let collateral_input = tc.loan_reqstd_collateral_input
  let collateral_output = tc.locked_collateral_input.output

  let lp_input = tc.lp_input
  let output_ref = tc.lending_pool_output_ref
  // fail point: reserve output is less than expected
  let remaining_reserve_amt = tc.starting_reserve_amt - tc.loan_amt - 1
  let lp_output =
    Output {
      address: tc.lending_pool_script_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        remaining_reserve_amt,
      ),
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let loan_proceeds_output =
    Output {
      address: tc.user_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        tc.loan_amt,
      ),
      datum: NoDatum,
      reference_script: None,
    }

  let redeemer = BorrowProcess

  let valid_til = tc.maturity_time - tc.loan_term
  // 2 hrs
  let valid_from = valid_til - 7_200_000
  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lp_output, loan_proceeds_output],
      validity_range: interval.between(valid_from, valid_til),
    }
  False == lending_pool.spend(
    tc.lending_pool_val_params,
    Some(tc.lp_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}

test repay_proc_succeed() {
  let collateral_input = tc.repay_reqstd_collateral_input
  let collateral_output = tc.unlocked_collateral_input.output

  let lp_input = tc.lp_input
  let output_ref = tc.lending_pool_output_ref
  let new_reserve_amt = tc.starting_reserve_amt + tc.loan_amt + tc.interest_amt
  // trace @"input reserve: ": tc.starting_reserve_amt
  // trace @"borrowed_amt: ": tc.loan_req_datum.borrowed_amt
  // trace @"interest_amt": tc.loan_req_datum.interest_amt
  // trace @"new_reserve_amt: ": new_reserve_amt
  let lending_pool_output =
    Output {
      address: tc.lending_pool_script_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        new_reserve_amt,
      ),
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let redeemer = RepayProcess

  // 2 hrs
  let valid_til = tc.maturity_time - 2
  let valid_from = valid_til - 7_200_000
  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lending_pool_output],
      validity_range: interval.between(valid_from, valid_til),
    }
  let params = LendingPoolValidatorParams { admin_key_hash: tc.admin_key_hash }
  lending_pool.spend(params, Some(tc.lp_datum), redeemer, output_ref, this_tx)
}

test repay_proc_fail() {
  let collateral_input = tc.repay_reqstd_collateral_input
  let collateral_output = tc.unlocked_collateral_input.output

  let lp_input = tc.lp_input
  let output_ref = tc.lending_pool_output_ref
  // fail point: received loan payment amount is short
  let new_reserve_amt =
    tc.starting_reserve_amt + tc.loan_amt + tc.interest_amt - 1
  let lending_pool_output =
    Output {
      address: tc.lending_pool_script_address,
      value: from_asset(
        tc.loanable_asset.policy_id,
        tc.loanable_asset.asset_name,
        new_reserve_amt,
      ),
      datum: InlineDatum(tc.lp_datum),
      reference_script: None,
    }

  let redeemer = RepayProcess

  // fail point: tx validity upper bound is after the loan maturity
  let valid_til = tc.maturity_time + 1
  let valid_from = valid_til - 7_200_000
  let this_tx =
    Transaction {
      ..placeholder,
      inputs: [collateral_input, lp_input],
      outputs: [collateral_output, lending_pool_output],
      validity_range: interval.between(valid_from, valid_til),
    }
  let params = LendingPoolValidatorParams { admin_key_hash: tc.admin_key_hash }
  False == lending_pool.spend(
    params,
    Some(tc.lp_datum),
    redeemer,
    output_ref,
    this_tx,
  )
}
