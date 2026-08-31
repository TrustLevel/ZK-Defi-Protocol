# ZK Circuit Keys (BLS12-381)

Groth16 keys for `collateral_proof.circom`. Because the proof is verified
**on-chain** by the Aiken validators, everything targets the **BLS12-381** curve
(Cardano's on-chain pairing builtins) — not BN254.

## Files

| File | Committed | Purpose |
|------|-----------|---------|
| `verification_key.json` | yes | Public verification key. This is what the on-chain validator checks against (and what the deployed VKey reference UTxO holds). |
| `collateral_proof_final.zkey` | yes — committed (~788 KB, via `!` negation in `.gitignore`) | Proving key, committed for turnkey testing so reviewers can reproduce proofs without a fresh setup. |
| `pot12_final.ptau` | no — gitignored | BLS12-381 Powers of Tau. Regenerate locally. |

> **Important:** the committed `verification_key.json` corresponds to a specific
> proving key. If you run a fresh trusted setup you get a *new* key pair, whose
> proofs will **not** verify against the committed `verification_key.json` or the
> deployed contract. To reproduce proofs that match the deployment you need the
> original `collateral_proof_final.zkey` (ask the maintainers, or commit it).

## Regenerate the keys

The circuit is small (~1,100 constraints), so a power-12 BLS12-381 setup is enough.

```bash
# Compile the circuit first (from circuits/):
#   circom collateral_proof.circom --r1cs --prime bls12381 -l . -l node_modules
cd circuits/keys/
SNARKJS="npx snarkjs"

# 1. Powers of Tau — BLS12-381, phase 1
$SNARKJS powersoftau new bls12-381 12 pot12_0000.ptau
$SNARKJS powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="dev" -e="<random entropy>"
$SNARKJS powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau

# 2. Circuit-specific setup — phase 2
$SNARKJS groth16 setup ../collateral_proof.r1cs pot12_final.ptau collateral_proof_0000.zkey
$SNARKJS zkey contribute collateral_proof_0000.zkey collateral_proof_final.zkey --name="dev-phase2" -e="<random entropy>"
$SNARKJS zkey export verificationkey collateral_proof_final.zkey verification_key.json
```

Verify the keys work:

```bash
cd .. && node tests/gate-bls12381.cjs      # 9/9 checks pass
```

## Trusted-setup note

The committed key pair was produced with a **single-contributor development
ceremony** (fixed entropy) — acceptable for Preprod/testing, **not** for mainnet.
For production run a real multi-party Powers-of-Tau ceremony (security holds as
long as one participant is honest and destroys their toxic waste), or move to a
setup-free proving system (PLONK / STARK).

## References

- snarkjs — https://github.com/iden3/snarkjs
- Groth16 — https://eprint.iacr.org/2016/260
