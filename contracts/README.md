# On-Chain Contracts (v6 private model)

Aiken scripts for the ZK Private-Lending Protocol. Groth16 proofs (BLS12-381) are
verified **on-chain** to authorize private deposits, borrowing, repayment and unlock.
There is no admin and no signature on any path: the proof *is* the authorization.

## Build & test

```sh
aiken build     # compile -> plutus.json
aiken check     # on-chain proof + adversarial tests (107/107)
```

## Scripts

Three scripts live in `validators/v5/`, linked by their parameters:

```
pool_nft(seed) -> collateral_v5(pool_nft_policy, settlement_vkey_ref)
               -> lending_pool_v5(pool_nft_policy, collateral_hash, vkey_ref, repay_vkey_ref,
                                  append_vkey_ref)
```

**`pool_nft`** — one-shot minting policy. It mints exactly one token named `POOL`, and
only in the transaction that spends the `seed` UTxO, so exactly one pool NFT can ever
exist. It can never be burned. The pool UTxO carries it.

**`lending_pool_v5`** — the shared pool. It spends only the input holding the pool NFT
and finds the continuing output by the NFT at the same address. Redeemer
`PoolRedeemerV5`:

- `AddLiquidity` — anyone may add liquidity (pool value increases; sets and config frozen).
- `DepositCollateral { commitment, append_proof }` — the tx pays exactly
  `collateral_denomination` with `DepositDatumV5 { commitment, … }` to the collateral
  script, and the append proof inserts `commitment` into `group_root` at
  `group_next_index`. Permissionless; the pool value is unchanged.
- `BorrowAnonymous { proof, loan_amount, loan_nullifier, recipient }` — verifies a
  membership proof on-chain (`[group_root, nullifier, loan, ratio, ext, recipient]`).
  No collateral UTxO is referenced (deposit ↔ borrow unlinkable). It requires the
  nullifier never to have been used, the fixed loan denomination, and a collateral
  denomination that covers it. It records the nullifier in `open_loans` and
  `used_nullifiers`, and pays the loan to `recipient` (output tagged with the nullifier).
- `RepayAnonymous { proof, repay_amount, loan_nullifier, repay_nullifier, append_proof }`
  — verifies a **repay proof** on-chain (`[group_root, N, R, loan, ratio, ext,
  repay_ext]`) that derives the loan nullifier `N` and the repayment nullifier `R`
  from one secret; pays exactly principal + interest, removes `N` from `open_loans`,
  and appends that `R` into `repaid_root` via an on-chain append proof. A borrow proof
  is not a repay proof (own vkey), so a repay can only release its own deposit.

Datum `PoolDatumV5 { total_deposited, total_borrowed, interest_rate, collateral_ratio,
group_root, group_next_index, repaid_root, next_index, external_nullifier,
repay_external_nullifier, collateral_denomination, loan_denomination, open_loans,
used_nullifiers, last_updated }`.

**`collateral_v5`** — holds one deposit and its Poseidon commitment. Redeemer
`CollateralRedeemerV5`:

- `UnlockDeposit { proof, pool_ref }` — unlock via a **settlement proof**. It binds the
  spent commitment and proves membership of the private `R` in the `repaid_root` of
  the pool reference input, which must carry the pool NFT. The collateral is paid to
  the deposit's `unlock_to` address, in an output tagged with the deposit's reference.
  No signature, and no value shared with the borrow.

Datum `DepositDatumV5 { commitment, timestamp, unlock_to }`. `commitment` is a
BLS12-381 field element (Poseidon255 of amount + secret) stored as an `Int`; there is
no on-chain amount.

Shared modules in `lib/`:
- `types_v5.ak` — datum and redeemer types, `pool_nft_name`
- `zk.ak` — `verify_borrow_proof`, `verify_repay_proof`, `verify_settlement_proof`, `verify_append_proof`, `get_vkey`
- `semaphore_onchain_test.ak`, `zk_onchain_test.ak` — the generated on-chain fixtures

Tests in `validators/tests/` (`v6_validator_test.ak`, `pool_nft_test.ak`).

## How on-chain verification works

- **Verification keys.** The four keys are parked once as inline datums on an
  unspendable reference UTxO. Their references are **script parameters**, and the
  validators read them via read-only reference inputs.
- **Trusted public signals.** Public signals are reconstructed from trusted on-chain
  state: the NFT-bearing pool datum. Redeemer-supplied values are cross-checked against
  the nullifier sets, the fixed amounts, the pool value delta, the append proofs and
  the payout outputs. A spender cannot feed the verifier convenient inputs.
- **Verifier.** `groth_verify(vkey, proof, public)` from
  [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381). No `extra_signatories`
  check anywhere.

See [`../circuits/`](../circuits/) for the four circuits (borrow, repay, settlement,
append) and [`../docs/MILESTONE3.md`](../docs/MILESTONE3.md) for the full design.

## Deployed (Preprod)

| Script | Hash |
|-----------|-------------|
| `pool_nft` (pool 1, lends ADA) | `859075f221d672187f5fff95fc3a4be995238509ef124e8e2d85ffac` |
| `lending_pool_v5` (pool 1) | `5e40259d6bae4053e91bf2bbb21b5e5a1028ae60a712d39b59695a68` |
| `collateral_v5` (pool 1)   | `c9450bfc1cc5fe4b6bf5aa5a4c1bd347aa2ac38c455f8a2ebdb1e9dc` |

Pool 2 (lends the USD test token) and all addresses: `packages/protocol/deployments/`
and [`../docs/MILESTONE3.md`](../docs/MILESTONE3.md) §4.

The applied hashes are derived with Mesh `applyParamsToScript`
(`packages/protocol/src/scripts.mjs`, `deriveScripts`). `aiken blueprint apply` re-optimises
the applied program and yields different (equivalent) hashes. A full deposit →
borrow → repay → unlock cycle is confirmed live on Preprod; see
[`../docs/MILESTONE3-EVIDENCE.md`](../docs/MILESTONE3-EVIDENCE.md).

## Implementation note

Aiken's `spend` handler receives the raw `Transaction` as its 4th argument (not a
`ScriptContext`); the validators take the spent input from the handler's own
`OutputReference`. Declaring that argument as `ScriptContext` compiles but fails at
spend time with a `PlutusData` deserialization error.

## References

- [Aiken](https://aiken-lang.org/) · [stdlib](https://github.com/aiken-lang/stdlib/) · [modulo-p/ak-381](https://github.com/modulo-p/ak-381)
