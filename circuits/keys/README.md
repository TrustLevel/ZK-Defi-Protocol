# ZK Circuit Keys (BLS12-381)

Groth16 keys for the protocol circuits. Because the proofs are verified **on-chain**
by the Aiken validators, everything targets the **BLS12-381** curve (Cardano's
on-chain pairing builtins), not BN254.

## Files

| File | Committed | Purpose |
|------|-----------|---------|
| `collateral_semaphore_final.zkey` / `verification_key_semaphore.json` | yes | Borrow circuit (4 public signals) |
| `repay_proof_final.zkey` / `verification_key_repay.json` | yes | Repay circuit (5 public signals) |
| `settlement_proof_final.zkey` / `verification_key_settlement.json` | yes | Unlock circuit (3 public signals) |
| `append_proof_final.zkey` / `verification_key_append.json` | yes | Append circuit (4 public signals) |
| `lender_withdraw_final.zkey` / `verification_key_lender_withdraw.json` | yes | Lender withdraw circuit (4 public signals) |
| `collateral_proof_final.zkey` / `verification_key.json` | yes | Legacy fixture circuit |
| `pot14b_final.ptau` | no (gitignored) | BLS12-381 Powers of Tau (power 14; large enough for every circuit) |

The `verification_key_*.json` files are what the deployed vkey reference UTxOs hold.
The proving keys are committed so testers can reproduce proofs that verify against the
deployment without a fresh setup.

> **Important:** a fresh trusted setup gives a *new* key pair whose proofs do **not**
> verify against the committed verification keys or the deployed vkey UTxOs. After a
> new setup, the vkeys must be parked again and a new pool initialised.

## Regenerate the keys

Example for the borrow circuit. The other circuits
work the same way with their own `.r1cs`.

```bash
# Compile first (from circuits/):
#   circom collateral_semaphore.circom --r1cs --wasm --prime bls12381 -l . -l node_modules
cd circuits/keys/
SNARKJS="npx snarkjs"

# 1. Powers of Tau — BLS12-381, phase 1 (once)
$SNARKJS powersoftau new bls12-381 14 pot14_0000.ptau
$SNARKJS powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="dev" -e="<random entropy>"
$SNARKJS powersoftau prepare phase2 pot14_0001.ptau pot14b_final.ptau

# 2. Circuit-specific setup — phase 2
$SNARKJS groth16 setup ../collateral_semaphore.r1cs pot14b_final.ptau sem_0000.zkey
$SNARKJS zkey contribute sem_0000.zkey collateral_semaphore_final.zkey --name="dev-phase2" -e="<random entropy>"
$SNARKJS zkey verify ../collateral_semaphore.r1cs pot14b_final.ptau collateral_semaphore_final.zkey
$SNARKJS zkey export verificationkey collateral_semaphore_final.zkey verification_key_semaphore.json
```

Check the ptau curve: `groth16 setup` refuses a ptau of another curve
(`r1cs curve does not match powers of tau ceremony curve`).

## Trusted-setup note

The committed key pairs come from a **single-contributor development ceremony**.
That is acceptable for Preprod and testing, **not** for mainnet. For production, run a
real multi-party Powers-of-Tau and phase-2 ceremony (security holds as long as one
participant is honest and destroys their toxic waste), or move to a setup-free proving
system (PLONK / STARK).

## References

- snarkjs — https://github.com/iden3/snarkjs
- Groth16 — https://eprint.iacr.org/2016/260
