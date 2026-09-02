# On-Chain Contracts (v6 private model)

Aiken validators for the ZK Private-Lending Protocol. Groth16 proofs (BLS12-381) are
verified **on-chain** to authorize private borrowing, repayment and unlock — no owner
or admin signature on any value-moving path. The proof *is* the authorization.

## Build & test

```sh
aiken build     # compile validators -> plutus.json
aiken check     # on-chain proof + adversarial tests (17/17, 0 warnings)
```

## Validators

Two spend validators live in `validators/v5/`.

**`lending_pool_v5`** — the shared liquidity pool. Redeemer `PoolRedeemerV5`:

- `Deposit` — anyone may add liquidity (pool value must increase; datum continues).
- `SetGroupRoot { new_root }` — admin-only: publishes the Merkle root of the deposit
  commitment set (the deposit anonymity set is admin-curated for M3). Moves no value.
- `BorrowAnonymous { proof, loan_amount, loan_nullifier }` — verifies a membership proof
  on-chain (`[group_root, nullifier, loan, ratio, ext]`); no collateral UTxO is
  referenced (deposit↔borrow unlinkable); records the nullifier; releases the loan.
- `RepayAnonymous { proof, repay_amount, loan_nullifier, repay_nullifier, append_proof }`
  — re-attests membership, pays principal + interest, removes the nullifier, and
  **self-appends** the repayment nullifier `R` into `repaid_root` via an on-chain append
  proof (permissionless — no admin).

Datum `PoolDatumV5 { total_deposited, total_borrowed, interest_rate, collateral_ratio,
vkey_ref, settlement_vkey_ref, append_vkey_ref, group_root, repaid_root, next_index,
external_nullifier, repay_external_nullifier, loan_denomination, open_loans, admin,
last_updated }`.

**`collateral_v5`** (parameterised by the pool script hash) — holds one user deposit and
its Poseidon commitment. Redeemer `CollateralRedeemerV5`:

- `UnlockDeposit { proof, pool_ref }` — unlock via a **settlement proof**: binds the
  spent commitment and proves membership of the private `R` in the pool's `repaid_root`
  (read from `pool_ref`). No signature, and no value shared with the borrow.

Datum `DepositDatumV5 { commitment, timestamp }` — `commitment` is a BLS12-381 field
element (Poseidon255 of amount + secret) stored as an `Int`. No owner, no on-chain amount.

Shared modules in `lib/`: `types_v5.ak` (datum/redeemer types), `zk.ak`
(`verify_borrow_proof` / `verify_settlement_proof` / `verify_append_proof` + `get_vkey`),
and the generated on-chain fixtures `semaphore_onchain_test.ak` / `zk_onchain_test.ak`.

## How on-chain verification works

- The three verification keys are parked once as inline datums on an unspendable
  reference UTxO and pinned in the pool datum (`vkey_ref`, `settlement_vkey_ref`,
  `append_vkey_ref`); the validator reads them via read-only reference inputs.
- Public signals are reconstructed from **trusted on-chain state** (the pool datum) and
  redeemer-supplied values are cross-checked against the loan set, the pool value delta,
  and (on repay) the append proof — a spender cannot feed the verifier convenient inputs.
- Verification calls `groth_verify(vkey, proof, public)` from
  [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381). No `extra_signatories` check on
  borrow / repay / unlock; the admin signs only `SetGroupRoot`.

See [`../circuits/`](../circuits/) for the three circuits (borrow membership, settlement,
append) and [`../docs/MILESTONE3.md`](../docs/MILESTONE3.md) for the full design.

## Deployed (Preprod)

| Validator | Script hash |
|-----------|-------------|
| `lending_pool_v5` | `75317267a9fa7d8fcb09c62d371bcf8160c7991eba6637c221f22ff2` |
| `collateral_v5`   | `f2813e76cfb431d80ad5a50682e16d64524c6c3372b6bee4800f881d` |

A full deposit → borrow → repay → unlock cycle is confirmed live on Preprod — see
[`../docs/MILESTONE3-EVIDENCE.md`](../docs/MILESTONE3-EVIDENCE.md).

## Implementation note

Aiken's `spend` handler receives the raw `Transaction` as its 4th argument (not a
`ScriptContext`); the validators take the spent input from the handler's own
`OutputReference`. Declaring that argument as `ScriptContext` compiles but fails at
spend time with a `PlutusData` deserialization error.

## References

- [Aiken](https://aiken-lang.org/) · [stdlib](https://github.com/aiken-lang/stdlib/) · [modulo-p/ak-381](https://github.com/modulo-p/ak-381)
