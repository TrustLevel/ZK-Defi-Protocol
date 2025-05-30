use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, Output}

pub type AssetClass {
  policy_id: PolicyId,
  asset_name: AssetName,
}

/// POSIX time in milliseconds
pub type PosixTime =
  Int

/// Loan status constructors, for [LoanDatum](#LoanDatum)
pub type LoanStatus {
  LoanRequested
  LoanProcessed
  RepayRequested
}

/// The loan info data structure that is present in [`CollateralDatum`](#CollateralDatum)
/// if the UTXO is used as collateral in an active loan.
pub type LoanDatum {
  status: LoanStatus,
  borrowed_asset: AssetClass,
  borrowed_amt: Int,
  interest_amt: Int,
  loan_term: Int,
  maturity: PosixTime,
}

/// The datum structure for `UTXO`s in the collateral manager contract. If the field `used_in` is
/// populated, the collateral is considered locked and cannot be withdrawn by its owner.
pub type CollateralDatum {
  owner: Address,
  used_in: Option<LoanDatum>,
}

/// The loan term expressed as a POSIX time duration `Int` (in milliseconds)
pub type Term =
  Int

/// The loan interest rate, expressed in whole number percentage figure (eg: `5` for 5%)
pub type IntRate =
  Int

/// A loan interest rate, expressed as a tuple containing the following items:
/// 1. The loan term ([`Term`](#Term))
/// 2. The loan interest rate ([`IntRate`](#IntRate))
pub type InterestRate =
  (Term, IntRate)

/// The price of the collateral asset denominated in the loanable asset.
///
/// Example: If we have a collateral in `ADA` and the loanable asset is `USDM`; and the
/// price of `ADA` is `0.812345 USDM`, this would be `812345`.
pub type Price =
  Int

/// The decimal digits of an asset's amount (especially applies to the loanable asset).
pub type DecimalDigits =
  Int

/// A tuple containg the price of the collateral asset denominated in the loanable asset, and the loanable asset's decimal digits.
pub type CollateralPrice =
  (Price, DecimalDigits)

/// The lending pool `UTXO` datum structure.
///
/// - `collateral_contract`: the `ScriptHash` of the collateral validator
/// - `loanable_asset`: the `AssetClass` of the stable coin or any asset that can be borrowed
/// - `collateral_asset`: the `AssetClass` of the asset that can be used as collateral
/// - `collateral_price`: the exchange rate of the collateral asset against the loanable asset
/// - `collateral_ratio`: the loan-to-value ratio of the collateral asset, expressed in whole number percentage figure (eg: `70` for 70%)
/// - `interest_rates`: the list of [`InterestRate`](#InterestRate) tuples
pub type LendingPoolDatum {
  collateral_contract: ScriptHash,
  loanable_asset: AssetClass,
  collateral_asset: AssetClass,
  collateral_price: CollateralPrice,
  collateral_ratio: Int,
  interest_rates: List<InterestRate>,
}

/// The data structure for the redeemer that can be used for both the collateral management contract
/// and the lending pool contract.
pub type UnifiedRedeemer {
  BorrowRequest { loan_amt: Int, loan_term: Int, loan_asset: AssetClass }
  BorrowProcess
  RepayRequest
  RepayProcess
  LiquidateCollateral
  WithdrawCollateral
  WithdrawLendingPool
}

/// The parameter for when compiling the parameterized collateral management contract
pub type CollateralValidatorParams {
  lending_pool: ScriptHash,
  admin_key_hash: VerificationKeyHash,
}

/// The parameter for when compiling the parameterized lending pool contract
pub type LendingPoolValidatorParams {
  admin_key_hash: VerificationKeyHash,
}

/// The return type from [get_protocol_inputs()](./functions.html#get_protocol_inputs) containing
/// grouped lists of `Input`s from the collateral management, and the lending pool contracts.
pub type ProtocolInputs {
  collateral: List<Input>,
  lending_pool: List<Input>,
}

/// The return type from [get_protocol_outputs()](./functions.html#get_protocol_outputs) containing
/// grouped lists of `Output`s from the collateral management, and the lending pool contracts.
pub type ProtocolOutputs {
  collateral: List<Output>,
  lending_pool: List<Output>,
}
