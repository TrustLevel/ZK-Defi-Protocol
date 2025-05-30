# ZK Lending & Borrowing Onchain Components

    1. Collateral Management Logic
    2. Lending Pool (Issuance & Redemption logic) - incl. Interest Payment


## Building

```sh
aiken build

# Or:
aiken build -t verbose
```

## Testing

To run all tests:
```sh
aiken check
```

To run only tests matching the string `foo`, do:
```sh
aiken check -m foo
```

## Process

1. **Initialization**
    1. Protocol owner deploys the compiled _Plutus_ validators into `utxo`'s as reference scripts.
    1. Protocol owner deposits the loanable asset into the `lending_pool` contract address.

1. **Usage**
    1. User deposits their collateral asset into the `collateral` manager contract address.
    1. User may withdraw their deposited collateral if it is not locked in an active loan.
    1. User takes out a loan by:
       - Tx 1 (by user) User submits a loan request tx. This locks their collateral deposit and records the amount they want to borrow.
       - Tx 2 (chained to Tx 1 in the backend) A tx fulfilling the loan request of the user is automatically chained to the user's loan request. This spends the corresponding amount of loanable asset from the `lending_pool` contract and sends it to the requesting user.
    1. User repays an active loan through the same request-fulfill mechanism.

## Concurrency and Double-Satisfaction

To address the risk of [double-satisfaction](https://aiken-lang.org/fundamentals/common-design-patterns#problem-double-satisfaction) exploits, the loanable asset in the lending pool is contained in only 1 `utxo`.

As a consequence, only 1 transaction at a time can ever spend the lending pool's utxo and trigger its validation rules to be evaluated.

To allow users to concurrently take loans and repay active ones, the "loan" and "repayment" interactions
are broken up into 2 blockchain transactions. This is similar to the request-and-batching done by dexes.

In the first part, the user submits their request - either loan takeout or loan repayment. In this transaction, they will only be spending their own collateral utxo, so other users are not affected.

The second part, which is the fulfillment of the user's request, is done in the backend. This is where we immediately chain the transaction that spends the lending pool's only utxo, to send to the user the loaned asset they requested. The lending pool's new utxo will then be persistently stored, immediately ready to be used for the next fulfillment tx without waiting on the network for finality.


## Validator Operation

### UTXOs
The current design of this protocol involves 3 validators that hold the following UTXOs respectively.
1. `refscripts.ak`:

    UTXOs containing the protocol's compiled validator code as reference scripts.

1. `collateral.ak`:

    UTXOs containing users' collateral assets and their loan details in the datums, if used in an active loan.

1. `lending_pool.ak`:

    The single UTXO containing the loanable asset. The datum in this UTXO also contains the lending pool settings such as the collateral asset, its price, loan-to-value ratio, and the list of interest rates for different loan terms.


### Requirements when withdrawing collateral
Enforced by `collateral.ak`:
1. ✅ The collateral UTXO must not be used in an active loan.
1. ✅ The owner of the collateral must sign the transaction.

### Requirements when taking a loan
- Part 1: **User submits loan request**

    Enforced by `collateral.ak`:
    1. ✅ The owner of the collateral must sign the transaction.
    1. ✅ The collateral UTXO must not be used in an active loan.
    1. ✅ There must be only 1 collateral input UTXO.
    1. ✅ There must be no input UTXO from the `lending_pool` contract.
    1. ✅ The collateral asset must be returned back to the `collateral` contract address after the tx.
    1. ✅ The collateral UTXO datum must be updated with `LoanRequested` status, together with the loan details.

- Part 2: **Loan request fulfillment tx is chained**

    Enforced by `collateral.ak`:
    1. ✅ A utxo from the `lending_pool` contract must be spent in the transaction.
    1. ✅ The amount of loanable asset from the `lending_pool` contract must be sufficient for the borrowed amount.

    Enforced by `lending_pool.ak`:
    1. ✅ There must be 1 input utxo each from the `collateral` contract and the `lending_pool` contract.
    1. ✅ The collateral utxo datum must have the status `LoanRequested`.
    1. ✅ The collateral utxo must contain the required collateral asset.
    1. ✅ The collateral asset amount must be sufficient for the loan being taken, as determined by the provided loan-to-value ratio.
    1. ✅ The collateral asset must be returned back to the `collateral` contract address after the tx.
    1. ✅ The returned collateral must have an updated datum containing the following loan information. (This is what marks the collateral as being used in an active loan):
        1. Status of `LoanProcessed`
        1. Borrowed asset
        1. Borrowed amount
        1. Interest payable
        1. Loan term chosen
        1. Maturity date
    1. ✅ All excess loanable asset from the `lending_pool` utxo must be returned to the `lending_pool` contract address.
    1. ✅ The lending pool utxo datum must not change.
    1. ✅ The transaction validity range must be within the specified period (eg: 2 hours)

### Requirements when paying a loan

- Part 1: **User submits loan repayment request**

    Enforced by `collateral.ak`:
    1. ✅ The owner of the collateral must sign the transaction.
    1. ✅ The collateral utxo must be used in an active loan.
    1. ✅ There must be only 1 collateral input utxo.
    1. ✅ There must be no input utxo from the `lending_pool` contract.
    1. ✅ The _output_ collateral utxo must contain both the collateral asset and the repayment asset.
    1. ✅ The _output_ collateral utxo datum must be updated with `RepayRequested` status, together with the loan details.

- Part 2: **Loan repayment request fulfillment tx is chained**

    Enforced by `collateral.ak`:
    1. ✅ A utxo from the `lending_pool` contract must be spent in the transaction.
    1. ✅ The collateral asset must be returned back to the `collateral` contract.
    1. ✅ The returned collateral must have an updated datum that no longer contains any loan info.

    Enforced by `lending_pool.ak`:
    1. ✅ There must be 1 input utxo each from the `collateral` contract and the `lending_pool` contract.
    1. ✅ The collateral utxo datum must have the status `RepayRequested`.
    1. ✅ The tx validity range must be 2 hours or less only.
    1. ✅ The tx must be finalized not later than the maturity date and time.
    1. ✅ The lending pool utxo datum must not change.
    1. ✅ The amount of the loanable asset sent back to the `lending_pool` contract address should be the total of:
        1. ✅ The amount contained in the input utxo from the `lending_pool` contract
        1. ✅ The borrowed amount
        1. ✅ The interest amount
    
## References Used
- [Aiken Docs](https://aiken-lang.org/)
- [Aiken Standard Library](https://github.com/aiken-lang/stdlib/)
- [Strike Finance Forwards](https://github.com/strike-finance/forwards-smart-contracts)
