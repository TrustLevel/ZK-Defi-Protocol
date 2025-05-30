//// This module contains constant values that are used by the unit tests for the validators

use aiken/builtin.{multiply_integer, quotient_integer}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{
  ada_asset_name, ada_policy_id, from_asset, from_lovelace, merge,
}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use types.{
  AssetClass, CollateralDatum, CollateralPrice, CollateralValidatorParams,
  InterestRate, LendingPoolDatum, LendingPoolValidatorParams, LoanDatum,
  LoanProcessed, LoanRequested, PosixTime, RepayRequested,
}

pub const collateral_script_hash =
  #"00a0b79a29bb50da169ef9ee302aa8acca1dd62ba2d7fa57331847f0"

pub const lending_pool_script_hash =
  #"00a0b79a29bb50da169ef9ee302aa8acca1dd62ba2d7fa57331847f1"

pub const collateral_script_address =
  Address {
    payment_credential: Script(collateral_script_hash),
    stake_credential: None,
  }

pub const lending_pool_script_address =
  Address {
    payment_credential: Script(lending_pool_script_hash),
    stake_credential: None,
  }

pub const admin_key_hash =
  #"da299558c70a8970781806dca93d1801ba2f3b3894227a7b284786e4"

pub const user_payment_keyhash =
  #"d48838fee1e840857dab28a04dd88193aec8c297b85d8150c0a1f5cc"

pub const user_staking_keyhash =
  #"6313a1d2c296eb3341e159b6c5c6991de11e81062b95108c9aa024ad"

pub const user_address =
  Address {
    payment_credential: VerificationKey(user_payment_keyhash),
    stake_credential: Some(Inline(VerificationKey(user_staking_keyhash))),
  }

pub const collateral_asset =
  AssetClass { policy_id: ada_policy_id, asset_name: ada_asset_name }

pub const loanable_asset =
  AssetClass {
    policy_id: #"c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad",
    asset_name: #"0014df105553444d",
  }

pub const unlocked_collateral_output_ref =
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }

pub const locked_collateral_output_ref =
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000001",
    output_index: 0,
  }

pub const lending_pool_output_ref =
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000002",
    output_index: 0,
  }

pub const collateral_val_params =
  CollateralValidatorParams {
    lending_pool: lending_pool_script_hash,
    admin_key_hash,
  }

pub const lending_pool_val_params =
  LendingPoolValidatorParams { admin_key_hash }

/// April 3, 2025 12:00:00 PM GMT, in [`PosixTime`](./types.html#PosixTime)
pub const maturity_time: PosixTime = 1_743_681_600_000

/// 3hrs, in [`PosixTime`](./types.html#PosixTime) interval
pub const loan_term = 3_888_000_000

pub const loan_amt = 525_000_000

pub const interest_rate = 25

pub const interest_amt =
  multiply_integer(loan_amt, interest_rate)
    |> quotient_integer(100)

pub const loan_req_datum =
  LoanDatum {
    status: LoanRequested,
    borrowed_asset: loanable_asset,
    borrowed_amt: loan_amt,
    interest_amt: 0,
    loan_term,
    maturity: 0,
  }

pub const loan_reqstd_collateral_datum =
  CollateralDatum { owner: user_address, used_in: Some(loan_req_datum) }

pub const locked_collateral_datum =
  CollateralDatum {
    owner: user_address,
    used_in: Some(
      LoanDatum {
        status: LoanProcessed,
        borrowed_asset: loanable_asset,
        borrowed_amt: loan_amt,
        interest_amt,
        loan_term,
        maturity: maturity_time,
      },
    ),
  }

pub const repay_reqstd_collateral_datum =
  CollateralDatum {
    owner: user_address,
    used_in: Some(
      LoanDatum {
        status: RepayRequested,
        borrowed_asset: loanable_asset,
        borrowed_amt: loan_amt,
        interest_amt,
        loan_term,
        maturity: maturity_time,
      },
    ),
  }

pub const unlocked_collateral_datum =
  CollateralDatum { owner: user_address, used_in: None }

pub const loan_reqstd_collateral_input =
  Input {
    output_reference: unlocked_collateral_output_ref,
    output: Output {
      address: collateral_script_address,
      value: from_lovelace(1_000_000_000),
      datum: InlineDatum(loan_reqstd_collateral_datum),
      reference_script: None,
    },
  }

pub const locked_collateral_input =
  Input {
    output_reference: locked_collateral_output_ref,
    output: Output {
      address: collateral_script_address,
      value: from_lovelace(1_000_000_000),
      datum: InlineDatum(locked_collateral_datum),
      reference_script: None,
    },
  }

pub const repay_reqstd_collateral_input =
  Input {
    output_reference: locked_collateral_output_ref,
    output: Output {
      address: collateral_script_address,
      value: from_lovelace(1_000_000_000)
        |> merge(
            from_asset(
              loanable_asset.policy_id,
              loanable_asset.asset_name,
              loan_amt + interest_amt,
            ),
          ),
      datum: InlineDatum(repay_reqstd_collateral_datum),
      reference_script: None,
    },
  }

pub const unlocked_collateral_input =
  Input {
    output_reference: unlocked_collateral_output_ref,
    output: Output {
      address: collateral_script_address,
      value: from_lovelace(1_000_000_000),
      datum: InlineDatum(unlocked_collateral_datum),
      reference_script: None,
    },
  }

/// List of interest rates [`List<InterestRate>`](./types.html#InterestRate) for 3 hrs, 7 days, 14 days, 30 days, and 45 days
pub const interest_rates: List<InterestRate> =
  [
    (10_800_000, 5), (604_800_000, 8), (1_209_600_000, 10), (2_592_000_000, 15),
    (3_888_000_000, 25),
  ]

/// Suppose we have ADA as our collateral, and that the price is 0.75 USDM
/// ([`CollateralPrice`](./types.html#CollateralPrice))
pub const collateral_price: CollateralPrice = (750_000, 6)

pub const lp_datum =
  LendingPoolDatum {
    collateral_contract: collateral_script_hash,
    loanable_asset,
    collateral_asset,
    collateral_price,
    collateral_ratio: 70,
    interest_rates,
  }

pub const starting_reserve_amt = 1_000_000_000_000

pub const lp_input =
  Input {
    output_reference: lending_pool_output_ref,
    output: Output {
      address: lending_pool_script_address,
      value: from_asset(
        loanable_asset.policy_id,
        loanable_asset.asset_name,
        starting_reserve_amt,
      ),
      datum: InlineDatum(lp_datum),
      reference_script: None,
    },
  }

pub const low_lp_input =
  Input {
    output_reference: lending_pool_output_ref,
    output: Output {
      address: lending_pool_script_address,
      value: from_asset(
        loanable_asset.policy_id,
        loanable_asset.asset_name,
        100_000_000,
      ),
      datum: InlineDatum(lp_datum),
      reference_script: None,
    },
  }
