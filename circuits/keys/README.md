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
| `pot14b_final.ptau` | no (release asset) | BLS12-381 Powers of Tau (power 14; large enough for every circuit). Published as an asset of the GitHub release `m3-poa-v6`; SHA-256 `ab5f500c289d09261dea09590bdd40e8694d1308aa68384c78acc5e045121a1d` |

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

## Verify the committed keys

With `pot14b_final.ptau` from the release (check its SHA-256 above), each proving key
can be checked against its circuit and the powers of tau, from `circuits/`:

```bash
for c in collateral_semaphore repay_proof settlement_proof append_proof lender_withdraw; do
  npx snarkjs zkey verify $c.r1cs keys/pot14b_final.ptau keys/${c}_final.zkey
done   # each prints "ZKey Ok!"
```

## Trusted-setup note

The committed key pairs come from a **development setup** for Preprod and testing.
Production keys come from a multi-party Powers-of-Tau ceremony as in M1 Appendix A,
with a multi-party phase-2 contribution per circuit; it is secure as long as one participant is honest and
destroys their toxic waste.

## References

- snarkjs — https://github.com/iden3/snarkjs
- Groth16 — https://eprint.iacr.org/2016/260
