# ZK Circuits - Collateral Proof

Zero-Knowledge circuit (Groth16 over BLS12-381) for private borrowing in the ZK
Private-Lending Protocol. The proof is verified on-chain by the Aiken v5 validators.

## Overview

This circuit proves that a user owns a UTXO with sufficient collateral **without revealing:**
- The secret value
- The exact collateral amount
- Which specific UTXO is being used

### How it Works

1. **Deposit:** User generates Poseidon commitment: `commitment = Poseidon(collateral_amount, secret)`
2. **Borrow:** User generates ZK proof: "I know a secret for a valid deposit with sufficient collateral"
3. **Verify:** Backend verifies proof without learning which deposit or the secret

### Circuit: collateral_proof.circom

**Public Inputs** (visible to verifier):
- `commitment` - The Poseidon commitment being proven
- `loan_amount` - Requested loan amount
- `collateral_ratio` - Required collateralization (e.g., 150%)

**Private Inputs** (witness - secret):
- `secret` - User's secret (random 253-bit value)
- `collateral_amount` - Actual collateral in UTXO

**Constraints:**
1. **Commitment verification:** `commitment == Poseidon(collateral_amount, secret)`
2. **Collateral check:** `collateral_amount * 100 >= loan_amount * collateral_ratio`
3. **Range checks:** Prevent overflow attacks

**Performance:**
- Constraints: ~50-100 (very simple!)
- Proof generation: ~25 seconds (Groth16)
- Proof verification: <1 second
- Proof size: ~200 bytes

---

## Quick Start

### Prerequisites

- **Circom** v2.1.9+ (circuit compiler)
- **snarkjs** v0.7.4+ (proof generation/verification)
- **Node.js** v18+ (for snarkjs)

### Installation

```bash
# 1. Install circom (choose one)
brew install circom                    # macOS
cargo install --git https://github.com/iden3/circom.git  # From source

# 2. Install snarkjs
npm install -g snarkjs

# 3. Install project dependencies
cd circuits/
npm install
```

### Compile Circuit

```bash
# Compile circuit to WASM + R1CS
circom collateral_proof.circom --r1cs --wasm --sym

# This generates:
# - collateral_proof_js/collateral_proof.wasm  (1.7MB)
# - collateral_proof.r1cs (constraints)
# - collateral_proof.sym (debug symbols)
```

### Setup Trusted Keys (First Time Only)

```bash
cd keys/

# Download Powers of Tau (18MB, one-time)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

# Generate proving key (~455 KB)
npx snarkjs groth16 setup \
  ../collateral_proof.r1cs \
  pot14_final.ptau \
  collateral_proof_0000.zkey

# Export verification key (~3 KB)
npx snarkjs zkey export verificationkey \
  collateral_proof_0000.zkey \
  verification_key.json
```

### Run Tests

The end-to-end gate test proves a valid case, checks the on-chain vkey/public
signals, and confirms that an under-collateralized proof is rejected:

```bash
node tests/gate-bls12381.cjs
```

Expected output:
```
GATE RESULT: 9 passed, 0 failed
```

To regenerate the on-chain proof fixture used by the Aiken tests:

```bash
node tests/gen-onchain-fixture.cjs
```

---

## Directory Structure

```
circuits/
├── collateral_proof.circom       # Circuit source code
├── collateral_proof_js/          # Compiled WASM (auto-generated, gitignored)
├── collateral_proof.r1cs         # Constraint system (auto-generated, gitignored)
├── collateral_proof.sym          # Debug symbols (auto-generated, gitignored)
│
├── lib/
│   ├── poseidon255.circom       # Poseidon hash over BLS12-381 scalar field
│   └── poseidon255_constants.circom
│
├── keys/
│   ├── collateral_proof_final.zkey # Proving key (gitignored)
│   ├── verification_key.json    # Verification key (committed)
│   └── README.md                # Key generation guide
│
├── tests/
│   ├── gate-bls12381.cjs        # End-to-end proof gate (9 checks)
│   ├── gen-onchain-fixture.cjs  # Generates the on-chain Aiken proof fixture
│   └── README.md                # Test documentation
│
├── circomlib/                   # Circuit libraries (gitignored, install via npm)
├── node_modules/                # NPM dependencies (gitignored)
├── package.json                 # NPM dependencies
└── README.md                    # This file
```

**Note:** Most files are auto-generated and gitignored. Only source code and documentation are committed.

---

## Development Workflow

### 1. Edit Circuit

```bash
vim collateral_proof.circom
```

### 2. Compile

```bash
circom collateral_proof.circom --r1cs --wasm --sym
```

### 3. Generate Test Witness

```bash
node collateral_proof_js/generate_witness.js \
  collateral_proof_js/collateral_proof.wasm \
  tests/input_test.json \
  tests/witness.wtns
```

### 4. Generate Proof

```bash
npx snarkjs groth16 prove \
  keys/collateral_proof_0000.zkey \
  tests/witness.wtns \
  tests/proof.json \
  tests/public.json
```

### 5. Verify Proof

```bash
npx snarkjs groth16 verify \
  keys/verification_key.json \
  tests/public.json \
  tests/proof.json
```

---

## Integration with Offchain Code

The proof is generated and serialized for on-chain verification by the v5 CLI
(`offchain/cli/v5/`), which builds the proof, hashes the commitment with
Poseidon (BLS12-381), and submits it in the borrow transaction. The Aiken
validators verify the Groth16 proof on-chain against the committed
`verification_key.json` using the `modulo-p/ak-381` library.

---

## Troubleshooting

### "circom: command not found"

```bash
# Install circom
brew install circom

# Or from source
cargo install --git https://github.com/iden3/circom.git
```

### "snarkjs: command not found"

```bash
npm install -g snarkjs

# Or use npx
npx snarkjs --version
```

### "Powers of Tau file not found"

```bash
cd keys/
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau
```

### "Proving key not found"

The proving key is auto-generated locally (gitignored). Run setup:

```bash
cd keys/
npx snarkjs groth16 setup ../collateral_proof.r1cs pot14_final.ptau collateral_proof_0000.zkey
```

### Proof generation fails

```bash
# Check WASM was compiled
ls -lh collateral_proof_js/collateral_proof.wasm

# Should be ~1.7MB
# If missing, recompile:
circom collateral_proof.circom --wasm
```

---

## Security Considerations

### Trusted Setup

This circuit uses **Groth16** which requires a trusted setup ceremony. The Powers of Tau file (`pot14_final.ptau`) is from the Hermez ceremony.

**For Production:**
- Run a multi-party computation (MPC) ceremony for this specific circuit
- Or migrate to PLONK/STARK (no trusted setup required)

### Circuit Simplicity

The circuit is intentionally minimal (~50 constraints) to:
- Reduce attack surface
- Minimize audit complexity
- Improve performance

**Before Mainnet:** Professional circuit audit recommended.

---

## Performance Benchmarks

Tested on MacBook Pro M1:

| Operation | Time |
|-----------|------|
| Circuit compilation | ~2 seconds |
| Witness generation | ~100ms |
| Proof generation | ~25 seconds |
| Proof verification | <1 second |

---

## References

- **Circom Docs:** https://docs.circom.io/
- **snarkjs:** https://github.com/iden3/snarkjs
- **circomlib:** https://github.com/iden3/circomlib
- **Poseidon Hash:** https://www.poseidon-hash.info/
- **Groth16 Paper:** https://eprint.iacr.org/2016/260

---

## Contributing

This circuit is part of the ZK-DeFi Protocol for Cardano. For questions or contributions, see the main project repository.

**Last Updated:** 2026-01-22
**Circuit Version:** v3
**Circom Version:** 2.1.9
**snarkjs Version:** 0.7.4
