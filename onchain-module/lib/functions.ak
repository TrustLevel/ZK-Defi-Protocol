//// This module contains all the supporting functions that are used by the 2 validator scripts
//// that compose the lending protocol.

use aiken/builtin.{multiply_integer, quotient_integer}
use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use aiken/interval.{Finite}
use aiken/math.{pow}
use aiken/primitive/string
use cardano/address.{Address, Script}
use cardano/assets.{from_asset, lovelace_of, match, merge, negate, quantity_of}
use cardano/transaction.{Datum, InlineDatum, Input, Output, ValidityRange}
use types.{
  AssetClass, BorrowProcess, BorrowRequest, CollateralDatum, LendingPoolDatum,
  LoanDatum, LoanProcessed, LoanRequested, LoanStatus, ProtocolInputs,
  ProtocolOutputs, RepayProcess, RepayRequest, RepayRequested, UnifiedRedeemer,
}

/// Check if the given `signer` is included in the given list of required signers.
pub fn is_signed_by(
  reqd_signers: List<VerificationKeyHash>,
  signer: VerificationKeyHash,
) -> Bool {
  list.has(reqd_signers, signer)
}

/// From a given [`CollateralDatum`](./types.html#CollateralDatum), check if it is used in an active loan.
pub fn is_collateral_locked(datum: CollateralDatum) -> Bool {
  when datum.used_in is {
    None -> False
    Some(loan) ->
      when loan.status is {
        LoanRequested -> False
        LoanProcessed -> True
        RepayRequested -> True
      }
  }
}

/// Get the [`LoanStatus`](./types.html#LoanStatus) from a given [`CollateralDatum`](./types.html#CollateralDatum)
pub fn get_loan_status(datum: CollateralDatum) -> Option<LoanStatus> {
  when datum.used_in is {
    None -> None
    Some(loan) -> Some(loan.status)
  }
}

/// Get the validator `ScriptHash` from a given output.
/// Fails if the given output is not from a validator script.
/// `caller` string parameter is used for debugging.
pub fn get_script_hash_frm_output(output: Output, caller: String) -> ScriptHash {
  when output.address.payment_credential is {
    Script(script_hash) -> script_hash
    _ ->
      fail string.concat(
        caller,
        @": Given output is not locked in a script; get_script_hash_frm_output()",
      )
  }
}

/// From a given list of _Inputs_, Get the `Input` coming from the contract with the given script hash. 
pub fn get_input_from_contract(
  inputs: List<Input>,
  wanted_hash: ScriptHash,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      when input.output.address.payment_credential is {
        Script(script_hash) -> script_hash == wanted_hash
        _ -> False
      }
    },
  )
}

/// Downcast a given lending pool datum into [LendingPoolDatum](./types.html#LendingPoolDatum) type.
/// Returns `None` when the given datum is not an `InlineDatum` type, or if it doesn't have the `LendingPoolDatum` structure.
pub fn get_lending_pool_datum(datum: Datum) -> Option<LendingPoolDatum> {
  when datum is {
    InlineDatum(lender_datum) ->
      if lender_datum is lending_pool_datum: LendingPoolDatum {
        Some(lending_pool_datum)
      } else {
        None
      }
    _ -> None
  }
}

/// Downcast a given collateral utxo datum into `CollateralDatum` type.
/// Returns `None` when the given datum is not an `InlineDatum` type, or if it doesn't have the `CollateralDatum` structure.
pub fn get_collateral_datum(datum: Datum) -> Option<CollateralDatum> {
  when datum is {
    InlineDatum(collateral_datum) ->
      if collateral_datum is collateral_utxo_datum: CollateralDatum {
        Some(collateral_utxo_datum)
      } else {
        None
      }
    _ -> None
  }
}

/// Get the amount of the loanable asset contained in a given utxo at the lending pool validator.
/// Returns 0 if datum doesn't have the `LendingPoolDatum` structure.
pub fn get_loanable_asset_amt(
  output: Output,
  lp_datum: Option<LendingPoolDatum>,
) -> Int {
  let lending_pool_datum =
    when lp_datum is {
      Some(datum) -> Some(datum)
      None -> get_lending_pool_datum(output.datum)
    }
  when lending_pool_datum is {
    Some(datum) -> {
      let loanable_asset = datum.loanable_asset
      quantity_of(
        output.value,
        loanable_asset.policy_id,
        loanable_asset.asset_name,
      )
    }
    None -> 0
  }
}

/// Get the amount of the collateral asset contained in a given output.
pub fn get_collateral_amt_in_output(
  output: Output,
  collateral_asset: AssetClass,
) -> Int {
  quantity_of(
    output.value,
    collateral_asset.policy_id,
    collateral_asset.asset_name,
  )
}

/// Calculate the amount of loanable asset that a user can borrow, given their collateral asset amount.
/// This takes into account the price of the collateral asset to determine its value, and then applies 
/// the loan-to-value ratio to arrive at the amount the user can borrow.
pub fn calc_amt_user_can_borrow(
  collateral_amt: Int,
  lp_datum: LendingPoolDatum,
) -> Int {
  let price = lp_datum.collateral_price.1st
  let decimals = lp_datum.collateral_price.2nd
  let price_denom = pow(10, decimals)
  let collateral_value =
    multiply_integer(collateral_amt, price) |> quotient_integer(price_denom)

  multiply_integer(collateral_value, lp_datum.collateral_ratio)
    |> quotient_integer(100)
}

/// From a given list of inputs, get the inputs from the collateral management validator 
/// and the inputs from the lending pool validator
pub fn get_protocol_inputs(
  inputs: List<Input>,
  collateral_contract: ScriptHash,
  lending_pool: ScriptHash,
) -> ProtocolInputs {
  list.foldl(
    inputs,
    ProtocolInputs { collateral: [], lending_pool: [] },
    fn(input, accumulator: ProtocolInputs) {
      when input.output.address.payment_credential is {
        Script(script_hash) ->
          if script_hash == collateral_contract {
            ProtocolInputs {
              collateral: list.push(accumulator.collateral, input),
              lending_pool: accumulator.lending_pool,
            }
          } else if script_hash == lending_pool {
            ProtocolInputs {
              collateral: accumulator.collateral,
              lending_pool: list.push(accumulator.lending_pool, input),
            }
          } else {
            accumulator
          }
        _ -> accumulator
      }
    },
  )
}

/// From a given list of outputs, get the outputs going to the collateral management validator 
/// and the outputs going to the lending pool validator
pub fn get_protocol_outputs(
  outputs: List<Output>,
  collateral_contract: ScriptHash,
  lending_pool: ScriptHash,
) -> ProtocolOutputs {
  list.foldl(
    outputs,
    ProtocolOutputs { collateral: [], lending_pool: [] },
    fn(output, accumulator: ProtocolOutputs) {
      when output.address.payment_credential is {
        Script(script_hash) ->
          if script_hash == collateral_contract {
            ProtocolOutputs {
              collateral: list.push(accumulator.collateral, output),
              lending_pool: accumulator.lending_pool,
            }
          } else if script_hash == lending_pool {
            ProtocolOutputs {
              collateral: accumulator.collateral,
              lending_pool: list.push(accumulator.lending_pool, output),
            }
          } else {
            accumulator
          }
        _ -> accumulator
      }
    },
  )
}

/// From a given list of tx inputs, get the ones that come from the protocol contracts and then
/// check that there's only one UTXO coming from each, in order to avoid double-satisfaction exploits.
pub fn validate_protocol_inputs(
  redeemer: UnifiedRedeemer,
  inputs: List<Input>,
  collateral_contract: ScriptHash,
  lending_pool: ScriptHash,
) -> (Bool, ProtocolInputs) {
  let protocol_inputs =
    get_protocol_inputs(inputs, collateral_contract, lending_pool)
  when redeemer is {
    BorrowRequest { .. } | RepayRequest -> {
      let is_valid = and {
          (1 == list.length(protocol_inputs.collateral))?,
          (0 == list.length(protocol_inputs.lending_pool))?,
        }
      (is_valid, protocol_inputs)
    }
    BorrowProcess { .. } | RepayProcess -> {
      let is_valid = and {
          (1 == list.length(protocol_inputs.collateral))?,
          (1 == list.length(protocol_inputs.lending_pool))?,
        }
      (is_valid, protocol_inputs)
    }
    _ -> (False, ProtocolInputs { collateral: [], lending_pool: [] })
  }
}

/// Checks the collateral output when submitting a loan request, for the following:
/// 1. That the datum is correctly updated to contain the loan info ([`LoanDatum`](./types.html#LoanDatum) type)
/// 1. That the collateral amount locked is the same as the input
pub fn validate_collateral_output_for_loan_req(
  collateral_output: Output,
  collateral_input: Input,
  input_datum: CollateralDatum,
  borrowed_amt: Int,
  loan_term: Int,
  loan_asset: AssetClass,
) -> Bool {
  let values_match =
    match(collateral_output.value, collateral_input.output.value, >=)
  let loan_datum =
    LoanDatum {
      status: LoanRequested,
      borrowed_asset: loan_asset,
      borrowed_amt,
      interest_amt: 0,
      loan_term,
      maturity: 0,
    }
  let expected_datum =
    CollateralDatum { owner: input_datum.owner, used_in: Some(loan_datum) }
  expect Some(output_datum) = get_collateral_datum(collateral_output.datum)
  and {
    values_match?,
    (output_datum == expected_datum)?,
  }
}

/// Checks the collateral output when fulfilling a loan request, for the following:
/// 1. That the datum contains the correctly updated loan info ([`LoanDatum`](./types.html#LoanDatum) type)
/// 1. That the collateral amount locked is the same as the input
pub fn validate_collateral_output_for_loan_proc(
  output: Output,
  owner: Address,
  input_collateral_amt: Int,
  loan_req: LoanDatum,
  lending_pool_datum: LendingPoolDatum,
  tx_validity_range: ValidityRange,
) -> (Bool, LoanDatum) {
  let LendingPoolDatum { loanable_asset, collateral_asset, interest_rates, .. } =
    lending_pool_datum
  let output_collateral_amt =
    get_collateral_amt_in_output(output, collateral_asset)

  expect Some(interest_tuple) =
    list.find(
      interest_rates,
      fn(rate_tuple) { rate_tuple.1st == loan_req.loan_term },
    )
  let interest_rate = interest_tuple.2nd
  let interest_amt =
    multiply_integer(loan_req.borrowed_amt, interest_rate)
      |> quotient_integer(100)
  let loan_start_time = get_upper_bound(tx_validity_range)
  let maturity = loan_start_time + loan_req.loan_term
  let loan_datum =
    LoanDatum {
      status: LoanProcessed,
      borrowed_asset: loanable_asset,
      borrowed_amt: loan_req.borrowed_amt,
      interest_amt,
      loan_term: loan_req.loan_term,
      maturity,
    }
  let expected_datum = CollateralDatum { owner, used_in: Some(loan_datum) }
  expect Some(output_datum) = get_collateral_datum(output.datum)

  trace @"Expected: "
  trace @"owner ": owner
  trace @"status ": loan_datum.status
  trace @"borrowed_asset ": loan_datum.borrowed_asset
  trace @"borrowed_amt ": loan_datum.borrowed_amt
  trace @"interest_amt ": loan_datum.interest_amt
  trace @"loan_term ": loan_datum.loan_term
  trace @"validTo ": loan_start_time
  trace @"maturity ": loan_datum.maturity
  trace @""

  trace @"Actual: "
  trace @"owner ": output_datum.owner
  expect Some(used_in) = output_datum.used_in
  trace @"status ": used_in.status
  trace @"borrowed_asset ": used_in.borrowed_asset
  trace @"borrowed_amt ": used_in.borrowed_amt
  trace @"interest_amt ": used_in.interest_amt
  trace @"loan_term ": used_in.loan_term
  trace @"validTo ": loan_start_time
  trace @"maturity ": used_in.maturity
  trace @""

  let is_valid = and {
      (output_datum == expected_datum)?,
      (output_collateral_amt == input_collateral_amt)?,
    }
  (is_valid, loan_datum)
}

/// Checks the collateral output when submitting a loan _repayment_ request, for the following:
/// 1. That the datum contains the correctly updated loan info ([`LoanDatum`](./types.html#LoanDatum) type)
/// 1. That the utxo contains both the collateral amount from the input, and the repayment asset in the correct amount
pub fn validate_collateral_output_for_repayment_req(
  collateral_output: Output,
  collateral_input: Input,
  input_datum: CollateralDatum,
) -> Bool {
  let input_value = collateral_input.output.value
  expect Some(loan) = input_datum.used_in
  let expected_repayment_amt = loan.borrowed_amt + loan.interest_amt
  let repayment_value =
    from_asset(
      loan.borrowed_asset.policy_id,
      loan.borrowed_asset.asset_name,
      expected_repayment_amt,
    )
  let expected_output_value = merge(input_value, repayment_value)
  let values_match = match(collateral_output.value, expected_output_value, >=)
  let new_loan_datum = LoanDatum { ..loan, status: RepayRequested }
  let expected_datum =
    CollateralDatum { owner: input_datum.owner, used_in: Some(new_loan_datum) }
  expect Some(output_datum) = get_collateral_datum(collateral_output.datum)
  and {
    values_match,
    (output_datum == expected_datum)?,
  }
}

/// Checks the collateral output when fulfilling a loan _repayment_ request, for the following:
/// 1. That the datum is correctly updated to no longer contain any loan info
/// 1. That the collateral amount is the same as the input
pub fn validate_collateral_output_for_repayment_proc(
  input: Input,
  output: Output,
  owner: Address,
  collateral_asset: AssetClass,
) -> Bool {
  let input_lovelace = lovelace_of(input.output.value)
  let output_lovelace = lovelace_of(output.value)
  let input_collateral_amt =
    get_collateral_amt_in_output(input.output, collateral_asset)
  let output_collateral_amt =
    get_collateral_amt_in_output(output, collateral_asset)
  let expected_datum = CollateralDatum { owner, used_in: None }
  expect Some(output_datum) = get_collateral_datum(output.datum)

  trace @"input_lovelace       ": input_lovelace
  trace @"output_lovelace      ": output_lovelace
  trace @"input_collateral_amt ": input_collateral_amt
  trace @"output_collateral_amt": output_collateral_amt

  and {
    (output_lovelace == input_lovelace)?,
    (output_collateral_amt == input_collateral_amt)?,
    (output_datum == expected_datum)?,
  }
}

/// Checks the new lending pool output for the following:
/// 1. That the amount of loanable asset contained in the utxo is as expected
/// 1. That there is no change in the datum
pub fn validate_lending_pool_output(
  input: Input,
  output: Output,
  lending_pool_datum: LendingPoolDatum,
  loan: LoanDatum,
  redeemer: UnifiedRedeemer,
) -> Bool {
  let loanable_asset = lending_pool_datum.loanable_asset
  let reserve_amt_input =
    get_loanable_asset_amt(input.output, Some(lending_pool_datum))
  let expected_reserve_amt_output =
    when redeemer is {
      BorrowProcess { .. } -> reserve_amt_input - loan.borrowed_amt
      RepayProcess -> reserve_amt_input + loan.borrowed_amt + loan.interest_amt
      _ -> 0
    }

  trace @"reserve_amt_input          ": reserve_amt_input
  let reserve_amt_output =
    get_loanable_asset_amt(output, Some(lending_pool_datum))
  trace @"reserve_amt_output         ": reserve_amt_output
  trace @"expected_reserve_amt_output": expected_reserve_amt_output
  let reserve_input_value =
    from_asset(
      loanable_asset.policy_id,
      loanable_asset.asset_name,
      reserve_amt_input,
    )
  let expected_reserve_output_value =
    from_asset(
      loanable_asset.policy_id,
      loanable_asset.asset_name,
      expected_reserve_amt_output,
    )
  let expected_output_value =
    reserve_input_value
      |> negate
      |> merge(input.output.value)
      |> merge(expected_reserve_output_value)

  let values_match = match(output.value, expected_output_value, >=)

  expect Some(reserve_output_datum) = get_lending_pool_datum(output.datum)

  and {
    values_match?,
    (reserve_output_datum == lending_pool_datum)?,
  }
}

/// Get the lower bound `IntervalBound` from given transaction validity range
/// (POSIXTime in milliseconds).
/// Fails if given validity range does not contain a `Finite` lower bound type
pub fn get_lower_bound(range: ValidityRange) -> Int {
  expect Finite(lower_bound) = range.lower_bound.bound_type
  lower_bound
}

/// Get the upper bound `IntervalBound` from given transaction validity range
/// (POSIXTime in milliseconds)
/// Fails if given validity range does not contain a `Finite` upper bound type
pub fn get_upper_bound(range: ValidityRange) -> Int {
  expect Finite(upper_bound) = range.upper_bound.bound_type
  upper_bound
}

/// Check if the given transaction validity range is within the pre-specified limit.
///
/// This is required for determining the maturity date of a loan. This is also used as basis
/// for determining the time of repayment, in the case of loan repayment transactions.
pub fn validate_tx_validity_range(range: ValidityRange) -> Bool {
  // To-do: Put this validity interval setting somewhere easily configurable; in the LendingPoolDatum maybe?
  // (hard-coded to 2 hours for now)
  let max_period: Int = 7_200_000
  let tx_validity_period = get_upper_bound(range) - get_lower_bound(range)
  tx_validity_period <= max_period
}
