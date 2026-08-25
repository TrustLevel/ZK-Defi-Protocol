# On-Chain Contracts (v5)

Aiken validators for the ZK Private-Lending Protocol. A Groth16 proof (BLS12-381)
is verified **on-chain** to authorize private borrowing and repayment — there is
no admin signature and no trusted backend in the authorization path. The proof
*is* the authorization.

## Build & test

```sh
aiken build     # compile validators -> plutus.json
aiken check     # on-chain tests: a real proof verifies, a tampered one is rejected (2/2)
```

## Validators

Two spend validators live in `validators/v5/`.

**`lending_pool_v5`** — the shared liquidity pool. Redeemer `PoolRedeemerV5`:

- `Deposit` — anyone may add liquidity (pool value must increase; datum continues).
- `BorrowAnonymous { collateral_ref, proof, loan_amount }` — verifies the proof on-chain, then releases the loan and updates the pool.
- `RepayAnonymous { deposit_ref, proof, repay_amount }` — verifies the proof on-chain, then accepts the repayment.

Datum `PoolDatumV5 { total_deposited, total_borrowed, interest_rate, collateral_ratio, vkey_ref, last_updated }`.

**`collateral_v5`** — holds one user deposit and its Poseidon commitment. Redeemer `CollateralRedeemerV5`:

- `Withdraw` — owner reclaims un-loaned collateral (owner signature).
- `UsedAsCollateral { loan_id }` — collateral continues, locked for a loan.
- `UnlockDeposit { proof, vkey_ref }` — unlock via a ZK ownership proof (no signature).

Datum `DepositDatumV5 { owner, collateral_amount, commitment, timestamp }` — `commitment` is a BLS12-381 field element stored as an `Int`.

Shared modules in `lib/`: `types_v5.ak` (datum/redeemer types), `zk.ak` (Groth16 wrapper + verification-key resolver), `helpers.ak`, and `zk_onchain_test.ak` (the on-chain proof tests).

## How on-chain verification works

- The verification key is parked once as an inline datum on a reference UTxO and pinned in the pool datum (`vkey_ref`). The validator reads it via a read-only reference input.
- On borrow / repay / unlock the validator reconstructs the ZK public signals **from trusted on-chain state**, never blindly from the redeemer:
  - `commitment` — from the referenced collateral UTxO's datum
  - `loan_amount` / `repay_amount` — from the redeemer, cross-checked against the actual pool balance delta
  - `collateral_ratio` — from the pool datum (protocol config)
- It then calls `groth_verify(vkey, proof, [commitment, loan_amount, collateral_ratio])` from [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381). There is no `extra_signatories` admin check.

The circuit proves, for a hidden `secret` and `collateral_amount`, that
`commitment = Poseidon(collateral_amount, secret)` **and**
`collateral_amount * 100 >= loan_amount * collateral_ratio`. See [`../circuits/`](../circuits/).

## Deployed (Preprod)

| Validator | Script hash |
|-----------|-------------|
| `lending_pool_v5` | `0686aaaf136fde2af6aa1f78af30bc67d0aa410461c4bfb5877eb199` |
| `collateral_v5`   | `f88347ff9ee0ffbdbb575d94c76803ca319e1471fe2c2697ce852aef` |

A full deposit → borrow → repay → unlock cycle is confirmed live on Preprod — see
[`../docs/MILESTONE3-EVIDENCE.md`](../docs/MILESTONE3-EVIDENCE.md).

## Implementation note

Aiken's `spend` handler receives the raw `Transaction` as its 4th argument (not a
`ScriptContext`); the v5 validators take the spent input from the handler's own
`OutputReference`. Declaring that argument as `ScriptContext` compiles but fails
at spend time with a `PlutusData` deserialization error — this was the historical
blocker before v5.

## References

- [Aiken](https://aiken-lang.org/) · [stdlib](https://github.com/aiken-lang/stdlib/) · [modulo-p/ak-381](https://github.com/modulo-p/ak-381)
