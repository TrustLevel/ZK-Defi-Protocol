# ZK Circuits (BLS12-381)

Groth16 circuits for private lending. The proofs are verified **on-chain** by the
Aiken validators (see [`../contracts/`](../contracts/)), so everything targets the
**BLS12-381** scalar field, and all circuits hash with Poseidon255
(`lib/poseidon255.circom`, from `poseidon-bls12381-circom`).

## Circuits

| Circuit | Used by | Public signals | Proves |
|---|---|---|---|
| `collateral_semaphore.circom` | Borrow | `[group_merkle_root, loan_nullifier, external_nullifier, recipient]` | The leaf `Poseidon255(COLLATERAL_LEAF_TAG, secret)` is a member of the collateral set (depth 10), which holds the deposits of every accepted collateral asset; `loan_nullifier = Poseidon255(secret, external_nullifier)`; range check; the proof is bound to `recipient` (payout key hash as an integer, constrained via `recipient²`). No amount, ratio or asset: sufficiency is enforced on-chain by the fixed denominations. |
| `repay_proof.circom` | Repay | `[group_merkle_root, loan_nullifier, repay_nullifier, external_nullifier, repay_external_nullifier]` | Membership as in the borrow circuit, plus `loan_nullifier` **and** `repay_nullifier = Poseidon255(secret, repay_external_nullifier)` from the same secret, so the `R` a repay appends belongs to the loan it settles. Own verification key. |
| `settlement_proof.circom` | Unlock | `[commitment, repaid_root, repay_external_nullifier]` | Knowledge of the secret behind `commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)`, and membership of the private `R = Poseidon255(secret, repay_external_nullifier)` in the repaid set (depth 10). |
| `lender_withdraw.circom` | Lender withdraw | `[lender_root, withdraw_nullifier, lender_external_nullifier, recipient]` | The note leaf `Poseidon255(LENDER_LEAF_TAG, secret)` is a member of the lender set (depth 10); `withdraw_nullifier = Poseidon255(secret, lender_external_nullifier)`; bound to `recipient`. |
| `append_proof.circom` | Add liquidity, Deposit, Repay | `[old_root, new_root, leaf, index]` | `leaf` was inserted at the empty position `index`, taking the root from `old_root` to `new_root` (depth 10). |

The leaf tags (`COLLATERAL_LEAF_TAG = 5555`, `LENDER_LEAF_TAG = 6666`) must match
`packages/protocol/src/crypto.mjs`. Private inputs (secrets, Merkle paths) never touch
the chain.

## Prerequisites

- circom ≥ 2.2 (must support `--prime bls12381`)
- Node.js 18+, then `cd circuits && npm install`

## Compile

```bash
circom collateral_semaphore.circom --r1cs --wasm --prime bls12381 -l . -l node_modules
circom repay_proof.circom          --r1cs --wasm --prime bls12381 -l . -l node_modules
circom settlement_proof.circom     --r1cs --wasm --prime bls12381 -l . -l node_modules
circom append_proof.circom         --r1cs --wasm --prime bls12381 -l . -l node_modules
circom lender_withdraw.circom      --r1cs --wasm --prime bls12381 -l . -l node_modules
```

The `*_js/*.wasm` witness generators are committed; the `.r1cs` files are not.

## Keys

The proving keys (`keys/*_final.zkey`) and verification keys
(`keys/verification_key_*.json`) are committed for turnkey reproduction. See
[`keys/README.md`](keys/README.md) to regenerate them. A fresh setup produces new keys
that do not match the deployed vkey UTxOs.

## Test

```bash
node tests/gen-semaphore-fixture.cjs   # real proofs for all circuits -> ../contracts/lib/semaphore_onchain_test.ak
cd ../contracts && aiken check         # verifies them on-chain (+ tampered signals)
node --test tests/collateral-circuits.test.mjs tests/lender-withdraw.test.mjs   # real proofs, tampered signals, wrong witnesses
```

## Layout

```
collateral_semaphore.circom    borrow circuit
repay_proof.circom             repay circuit
settlement_proof.circom        unlock circuit
append_proof.circom            append circuit (commitment set + repaid set)
*_js/                          compiled witness generators (wasm)
lib/poseidon255*.circom        BLS12-381 Poseidon
keys/                          proving + verification keys
tests/                         fixture generators + gate test
```

## Security

Groth16 requires a trusted setup (see [`keys/README.md`](keys/README.md)).

## References

- circom — https://docs.circom.io/
- snarkjs — https://github.com/iden3/snarkjs
- poseidon-bls12381-circom — https://github.com/modulo-p/poseidon-bls12381-circom
- Groth16 — https://eprint.iacr.org/2016/260
