# ZK Circuits (BLS12-381)

Groth16 circuits for private lending. The proofs are verified **on-chain** by the
Aiken validators (see [`../contracts/`](../contracts/)), so everything targets the
**BLS12-381** scalar field, and all circuits hash with Poseidon255
(`lib/poseidon255.circom`, from `poseidon-bls12381-circom`).

## Circuits

| Circuit | Used by | Public signals | Proves |
|---|---|---|---|
| `collateral_semaphore.circom` | Borrow | `[group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier, recipient]` | The commitment `Poseidon255(collateral_amount, secret)` is a member of the commitment set (depth 10); `loan_nullifier = Poseidon255(secret, external_nullifier)`; `collateral_amount·100 ≥ loan_amount·collateral_ratio`; range checks; the proof is bound to `recipient` (payout key hash as an integer, constrained via `recipient²`). |
| `repay_proof.circom` | Repay | `[group_merkle_root, loan_nullifier, repay_nullifier, loan_amount, collateral_ratio, external_nullifier, repay_external_nullifier]` | Membership and sufficiency as in the borrow circuit, plus `loan_nullifier` **and** `repay_nullifier = Poseidon255(secret, repay_external_nullifier)` from the same secret, so the `R` a repay appends belongs to the loan it settles. Own verification key. |
| `settlement_proof.circom` | Unlock | `[commitment, repaid_root, repay_external_nullifier]` | Knowledge of the secret behind `commitment`, and membership of the private `R = Poseidon255(secret, repay_external_nullifier)` in the repaid set (depth 10). |
| `append_proof.circom` | Deposit, Repay | `[old_root, new_root, leaf, index]` | `leaf` was inserted at the empty position `index`, taking the root from `old_root` to `new_root` (depth 10). |
| `collateral_proof.circom` | none (legacy fixture) | `[commitment, loan_amount, collateral_ratio]` | Commitment opening + sufficiency; kept for the `zk_onchain_test` fixture. |

Private inputs (`secret`, `collateral_amount`, Merkle paths) never touch the chain.
The borrow circuit has 7,992 constraints, the repay circuit 8,615.

## Prerequisites

- circom ≥ 2.2 (must support `--prime bls12381`)
- Node.js 18+, then `cd circuits && npm install`

## Compile

```bash
circom collateral_semaphore.circom --r1cs --wasm --prime bls12381 -l . -l node_modules
circom repay_proof.circom          --r1cs --wasm --prime bls12381 -l . -l node_modules
circom settlement_proof.circom     --r1cs --wasm --prime bls12381 -l . -l node_modules
circom append_proof.circom         --r1cs --wasm --prime bls12381 -l . -l node_modules
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
cd ../offchain/cli && node v5/test-semaphore-proof.mjs   # borrow proof + tampered loan / recipient
```

## Layout

```
collateral_semaphore.circom    borrow circuit
repay_proof.circom             repay circuit
settlement_proof.circom        unlock circuit
append_proof.circom            append circuit (commitment set + repaid set)
collateral_proof.circom        legacy circuit (fixture only)
*_js/                          compiled witness generators (wasm)
lib/poseidon255*.circom        BLS12-381 Poseidon
keys/                          proving + verification keys
tests/                         fixture generators + gate test
```

## Security

Groth16 requires a trusted setup. The committed keys come from a dev-only
single-contributor ceremony (see [`keys/README.md`](keys/README.md)) and are not
suitable for mainnet. A professional circuit audit is recommended before mainnet.

## References

- circom — https://docs.circom.io/
- snarkjs — https://github.com/iden3/snarkjs
- poseidon-bls12381-circom — https://github.com/modulo-p/poseidon-bls12381-circom
- Groth16 — https://eprint.iacr.org/2016/260
