# ZK Circuit Keys

This directory contains cryptographic keys required for ZK proof generation and verification.

## Files

### Auto-Generated (Gitignored)

These files are **NOT committed to git** and must be generated locally:

**`pot14_final.ptau` (18 MB)**
- Powers of Tau ceremony file from Hermez
- Used for trusted setup
- Common across many circuits (universal setup)
- Download once, reuse for all circuits

**`collateral_proof_0000.zkey` (455 KB)**
- Circuit-specific proving key
- Generated from: `collateral_proof.r1cs` + `pot14_final.ptau`
- Required for proof generation
- Large binary file (gitignored)

### Committed (Small)

**`verification_key.json` (3 KB)**
- Public verification key
- Extracted from proving key
- Required for proof verification
- Small JSON file (committed to repo)

---

## Setup Instructions

### First-Time Setup

Run these commands to generate the keys locally:

```bash
cd circuits/keys/

# 1. Download Powers of Tau (one-time, 18MB)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -O pot14_final.ptau

# Or use curl
curl -o pot14_final.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

# 2. Verify download (optional but recommended)
ls -lh pot14_final.ptau
# Should be ~18 MB

# 3. Generate proving key (~30 seconds)
npx snarkjs groth16 setup \
  ../collateral_proof.r1cs \
  pot14_final.ptau \
  collateral_proof_0000.zkey

# 4. Extract verification key
npx snarkjs zkey export verificationkey \
  collateral_proof_0000.zkey \
  verification_key.json

# 5. Verify files exist
ls -lh
# collateral_proof_0000.zkey  ~455 KB
# pot14_final.ptau            ~18 MB
# verification_key.json       ~3 KB
```

### Verifying the Setup

```bash
# Generate a test proof to verify keys work
cd ..
npm test
```

If tests pass, your keys are set up correctly!

---

## File Sizes Reference

| File | Size | Committed | Purpose |
|------|------|-----------|---------|
| `pot14_final.ptau` | 18 MB | ❌ No | Universal trusted setup |
| `collateral_proof_0000.zkey` | 455 KB | ❌ No | Proving key |
| `verification_key.json` | 3 KB | ✅ Yes | Verification key |

---

## Trusted Setup Details

### What is Powers of Tau?

A **multi-party computation (MPC) ceremony** where many participants contribute randomness. As long as one participant is honest and destroys their secret, the setup is secure.

**Hermez Powers of Tau Ceremony:**
- Circuit size: 2^14 constraints (~16,000)
- Participants: 200+
- More info: https://github.com/iden3/snarkjs#7-prepare-phase-2

### Circuit-Specific Setup

The proving key (`collateral_proof_0000.zkey`) is generated from:
1. **Powers of Tau** (universal, reusable)
2. **Circuit R1CS** (circuit-specific constraints)

This is **Phase 2** of the trusted setup.

### Security Considerations

**For Development/Testing:**
- Using Hermez's Powers of Tau is acceptable
- Widely used in production (Hermez, Polygon Hermez)

**For Production/Mainnet:**
- Consider running your own MPC ceremony
- Or use PLONK/STARK (no trusted setup required)

---

## Troubleshooting

### "pot14_final.ptau: No such file or directory"

**Solution:** Download the Powers of Tau file:

```bash
cd circuits/keys/
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau
```

### "collateral_proof_0000.zkey: No such file or directory"

**Solution:** Generate the proving key:

```bash
cd circuits/keys/
npx snarkjs groth16 setup ../collateral_proof.r1cs pot14_final.ptau collateral_proof_0000.zkey
```

**Note:** Make sure you compiled the circuit first (`circom collateral_proof.circom --r1cs`)

### "Error: invalid groth16 parameters"

**Cause:** Proving key doesn't match the circuit

**Solution:** Regenerate the proving key after recompiling the circuit:

```bash
# 1. Recompile circuit
cd circuits/
circom collateral_proof.circom --r1cs --wasm --sym

# 2. Regenerate proving key
cd keys/
rm collateral_proof_0000.zkey
npx snarkjs groth16 setup ../collateral_proof.r1cs pot14_final.ptau collateral_proof_0000.zkey
```

### Download fails or is slow

**Alternative mirrors:**

```bash
# Original Hermez
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

# Alternative: IPFS
ipfs get QmUgjB4DJJo6SD4Y46qxBGSNa7WFsZvYy6Vw8f8pFVCG6B
```

---

## Advanced: Custom Trusted Setup

For production deployment, consider running your own MPC ceremony:

```bash
# 1. Start new ceremony (powers of tau phase 1)
npx snarkjs powersoftau new bn128 14 pot14_0000.ptau -v

# 2. Contribute entropy (repeat with multiple participants)
npx snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau \
  --name="First contribution" -v

# 3. Apply random beacon
npx snarkjs powersoftau beacon pot14_0001.ptau pot14_beacon.ptau \
  <random-beacon-hash> 10 -n="Final Beacon"

# 4. Prepare phase 2
npx snarkjs powersoftau prepare phase2 pot14_beacon.ptau pot14_final.ptau -v

# 5. Use your custom pot14_final.ptau for circuit setup
npx snarkjs groth16 setup ../collateral_proof.r1cs pot14_final.ptau collateral_proof_0000.zkey
```

See [snarkjs documentation](https://github.com/iden3/snarkjs#powers-of-tau) for full ceremony guide.

---

## References

- **snarkjs Trusted Setup Guide:** https://github.com/iden3/snarkjs#7-prepare-phase-2
- **Powers of Tau Ceremony:** https://medium.com/coinmonks/announcing-the-perpetual-powers-of-tau-ceremony-to-benefit-all-zk-snark-projects-c3da86af8377
- **Groth16 Paper:** https://eprint.iacr.org/2016/260
- **Hermez Ceremony Details:** https://blog.hermez.io/hermez-cryptographic-setup/

---

**Last Updated:** 2026-01-22
**Circuit:** collateral_proof v3
**Powers of Tau Size:** 2^14 (16K constraints)
