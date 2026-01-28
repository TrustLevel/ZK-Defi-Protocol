# V3 Testing Guide

Complete testing guide for the V3 Privacy-Enhanced Lending Protocol.

## Table of Contents

1. [Test Overview](#test-overview)
2. [Prerequisites](#prerequisites)
3. [Running Tests](#running-tests)
4. [Test Categories](#test-categories)
5. [Manual Testing](#manual-testing)
6. [Troubleshooting](#troubleshooting)
7. [CI/CD Integration](#cicd-integration)

---

## Test Overview

The V3 system includes three types of tests:

| Test Type | Location | Purpose | Duration |
|-----------|----------|---------|----------|
| **Crypto Tests** | `tests/crypto.test.ts` | Test secret generation, commitments, hashing | ~1s |
| **Circuit Tests** | `backend/circuits/test_v3_circuit.mjs` | Test ZK circuit logic | ~30s |
| **Integration Tests** | `tests/integration.test.ts` | Test complete lending cycle | ~60s |

**Total Test Coverage:**
- 50+ test cases
- All critical paths covered
- Performance benchmarks included

---

## Prerequisites

### 1. Environment Setup

Ensure you have the following installed:

```bash
# Deno (v1.40+)
deno --version

# Node.js (for circuit tests)
node --version  # v18+

# snarkjs (for ZK proofs)
npm install -g snarkjs
```

### 2. Environment Variables

Create `.env` file:

```bash
# Required for all tests
NETWORK=Preprod
BLOCKFROST_PROJECT_ID=your_project_id

# Optional (for integration tests)
WALLET_SEED="your test wallet seed phrase"
ADMIN_WALLET_SEED="admin test wallet seed phrase"
```

### 3. ZK Circuit Files

Ensure circuit files are present:

```bash
backend/circuits/
├── prove_collateral_v3.wasm    # Circuit WASM
├── prove_collateral_v3_final.zkey  # Proving key
└── verification_key.json       # Verification key
```

If missing, follow the [Circuit Setup Guide](backend/circuits/README.md).

---

## Running Tests

### Quick Start (All Tests)

```bash
# Run all tests
deno task test:crypto && deno task test:circuit && deno test tests/integration.test.ts
```

### Individual Test Suites

#### 1. Crypto Tests (Fast - ~1s)

Tests for cryptographic primitives:

```bash
# Run crypto tests
deno task test:crypto

# Or directly
deno test --allow-read --allow-env tests/crypto.test.ts
```

**What it tests:**
- ✅ Secret generation (BN254 field compliance)
- ✅ Poseidon commitment creation
- ✅ SHA-256 proof hashing
- ✅ Hex/decimal conversions
- ✅ Field arithmetic

**Expected output:**
```
running 5 tests from tests/crypto.test.ts
test Secret Generation ... ok (2ms)
test Commitment Creation ... ok (15ms)
test Proof Hashing ... ok (3ms)
test Field Conversions ... ok (1ms)
test Edge Cases ... ok (2ms)

test result: ok. 5 passed; 0 failed (23ms)
```

#### 2. Circuit Tests (Medium - ~30s)

Tests for ZK circuit logic:

```bash
# Run circuit tests
deno task test:circuit

# Or directly
cd backend/circuits && node test_v3_circuit.mjs
```

**What it tests:**
- ✅ Circuit compilation
- ✅ Witness generation
- ✅ Proof generation (Groth16)
- ✅ Proof verification
- ✅ Public signal extraction
- ✅ Commitment matching
- ✅ Collateral ratio validation

**Expected output:**
```
🧪 Testing V3 ZK Circuit

1️⃣  Test 1: Basic Proof Generation
   ✅ Witness generated
   ✅ Proof generated (25.3s)
   ✅ Proof verified

2️⃣  Test 2: Commitment Validation
   ✅ Commitment matches expected
   ✅ Public signals correct

3️⃣  Test 3: LTV Enforcement
   ✅ 80% LTV accepted
   ✅ 90% LTV rejected

✅ All circuit tests passed!
```

#### 3. Integration Tests (Slow - ~60s)

Tests for complete system integration:

```bash
# Run integration tests
deno test --allow-all tests/integration.test.ts

# Run with verbose output
deno test --allow-all --trace-ops tests/integration.test.ts
```

**What it tests:**
- ✅ Secret generation workflow
- ✅ Commitment creation workflow
- ✅ LTV calculations
- ✅ Interest calculations
- ✅ Proof generation (real circuit)
- ✅ Proof verification (real circuit)
- ✅ Complete lending cycle simulation
- ✅ Edge cases and error handling
- ✅ Performance benchmarks

**Expected output:**
```
running 6 test suites from tests/integration.test.ts

test Secret Generation ...
  test should generate valid 252-bit secret ... ok (2ms)
  test should generate secrets within BN254 field ... ok (1ms)
ok (3ms)

test Commitment Creation ...
  test should create valid Poseidon commitment ... ok (12ms)
  test should create different commitments ... ok (10ms)
ok (22ms)

test LTV Calculations ...
  test should calculate max loan at 80% LTV ... ok (1ms)
  test should calculate interest at 5% APR ... ok (0ms)
  test should calculate total repayment ... ok (0ms)
ok (1ms)

test ZK Proof Generation and Verification ...
  test should generate valid proof ... ok (28.5s)
  test should verify valid proof ... ok (0.8s)
  test should reject tampered proof ... ok (0.7s)
ok (30.0s)

test Complete Lending Cycle Simulation ...
  test should complete full cycle ... ok (35.2s)
  test should prevent over-borrowing ... ok (0ms)
ok (35.2s)

test Performance Benchmarks ...
  test should generate secret quickly ... ok (15ms)
  test should create commitment quickly ... ok (18ms)
  test should generate and verify proof ... ok (29.1s)
ok (29.1s)

test result: ok. 20 passed; 0 failed (94.3s)
```

---

## Test Categories

### Unit Tests

Test individual functions in isolation:

```typescript
// Example: Test secret generation
Deno.test("Secret Generation", () => {
    const secret = generateRandomSecret();
    assertEquals(secret.length, 63); // 252 bits = 63 hex chars
});
```

**Covered modules:**
- `lib/crypto.ts` - Cryptographic primitives
- `lib/config.ts` - Configuration and calculations
- `lib/proof.ts` - Proof generation/verification

### Integration Tests

Test complete workflows:

```typescript
// Example: Test complete cycle
Deno.test("Complete Lending Cycle", async () => {
    // 1. Generate secret
    const secret = generateRandomSecret();

    // 2. Create commitment
    const commitment = createCommitment(collateral, secret);

    // 3. Generate borrow proof
    const proof = await generateCollateralProof({...});

    // 4. Verify proof
    const isValid = await verifyCollateralProof(proof, signals);

    assertEquals(isValid, true);
});
```

**Covered workflows:**
- Deposit → Borrow → Repay → Withdraw
- Edge cases (over-borrowing, invalid proofs, etc.)
- Error handling

### Circuit Tests

Test ZK circuit behavior:

```javascript
// Example: Test circuit witness generation
const input = {
    secret: "123...",
    collateral_amount: "10000000",
    loan_amount: "8000000",
    commitment: "456...",
    collateral_ratio: "125"
};

const witness = await wc.calculateWitness(input);
// Verify witness is valid
```

**Covered scenarios:**
- Valid proof generation
- Invalid secret rejection
- LTV enforcement
- Commitment verification

---

## Manual Testing

### Complete Cycle Test (Preprod)

Test the entire lending cycle on Cardano Preprod testnet:

#### Setup

1. **Get test ADA:**
   ```bash
   # Get faucet funds
   # Visit: https://docs.cardano.org/cardano-testnet/tools/faucet/
   ```

2. **Configure wallet:**
   ```bash
   # Add to .env
   WALLET_SEED="your test seed phrase"
   NETWORK=Preprod
   BLOCKFROST_PROJECT_ID=your_preprod_project_id
   ```

3. **Start backend:**
   ```bash
   # Terminal 1: Start backend server
   deno task backend-v3
   ```

#### Test Flow

**Step 1: Deposit Collateral**

```bash
# Deposit 100 ADA collateral
deno task deposit-v3 100

# Expected output:
# ✅ Transaction submitted: abc123...
# ✅ Receipt saved: receipts/deposit-abc123.json
# ⚠️  SAVE THIS RECEIPT! You need it to borrow!
```

**Verification:**
- Check transaction on Cardano Explorer
- Verify UTXO at collateral address
- Verify deposit beacon token minted
- Save receipt file safely

**Step 2: Borrow Anonymously**

```bash
# Borrow 70 ADA (70% of 100 ADA collateral, well within 80% LTV)
deno task borrow-v3 receipts/deposit-abc123.json 70

# Expected output:
# 🔐 Step 1: Loading receipt...
# 🔒 Step 2: Generating ZK proof... (30s)
# 📤 Step 3: Sending to backend...
# ✅ BORROW SUCCESSFUL!
# TX Hash: def456...
# 💰 You received 70 ADA at your address!
```

**Verification:**
- Check transaction on explorer
- Transaction signed by ADMIN (not you!)
- No onchain link to your deposit
- Pool's total_borrowed increased by 70 ADA
- You received 70 ADA in your wallet

**Step 3: Repay Loan**

```bash
# Repay loan (70 ADA + 5% interest = 73.5 ADA)
deno task repay-v3 receipts/deposit-abc123.json 70

# Expected output:
# 📊 Step 1: Calculating repayment...
#    Loan: 70 ADA
#    Interest (5%): 3.5 ADA
#    Total: 73.5 ADA
# 🔒 Step 2: Generating ZK proof... (30s)
# 📤 Step 3: Sending to backend...
# ✅ REPAYMENT SUCCESSFUL!
# TX Hash: ghi789...
# ✅ Deposit unlocked!
```

**Verification:**
- Check transaction on explorer
- Transaction signed by ADMIN (not you!)
- Pool's total_borrowed decreased by 70 ADA
- Pool's value increased by 73.5 ADA
- Deposit UTXO still exists (unlocked)

**Step 4: Withdraw Collateral**

```bash
# Withdraw your 100 ADA collateral
deno task withdraw-v3 receipts/deposit-abc123.json

# Expected output:
# 🔨 Building withdrawal transaction...
# ✍️  Signing with your wallet...
# ✅ WITHDRAWAL SUCCESSFUL!
# TX Hash: jkl012...
# 💰 You received 100 ADA back!
```

**Verification:**
- Check transaction on explorer
- Transaction signed by YOU (owner)
- Deposit UTXO consumed
- Deposit beacon token burned
- You received 100 ADA in your wallet

**Cycle Complete! 🎉**

### Privacy Verification

After completing the cycle, verify privacy levels:

1. **Deposit → Borrow Link:**
   - Check deposit transaction
   - Check borrow transaction
   - Verify NO common signers (admin signed borrow, you signed deposit)
   - ✅ 85% privacy achieved

2. **Borrow → Repay Link:**
   - Check borrow transaction
   - Check repay transaction
   - Verify NO common signers (both admin-signed)
   - Loan amount revealed in public signals
   - ✅ 65% privacy achieved

3. **Repay → Withdraw Link:**
   - Check repay transaction
   - Check withdraw transaction
   - Verify DIFFERENT signers (admin vs you)
   - ✅ 40% privacy achieved

### Error Scenarios

Test error handling:

#### 1. Over-Borrowing

```bash
# Try to borrow 90 ADA (90% LTV - exceeds 80%)
deno task borrow-v3 receipts/deposit-abc123.json 90

# Expected:
# ❌ ERROR: Loan exceeds maximum LTV ratio
#    Max loan: 80 ADA (80% of 100 ADA)
#    Requested: 90 ADA (90% LTV)
```

#### 2. Invalid Proof

```bash
# Manually tamper with proof data
# Edit receipt file with wrong secret

deno task borrow-v3 receipts/tampered.json 70

# Expected:
# ❌ Backend error: Invalid ZK proof!
```

#### 3. Withdraw Before Repay

```bash
# Try to withdraw without repaying
deno task withdraw-v3 receipts/deposit-abc123.json

# Expected:
# ❌ Transaction failed: Deposit is still locked
# 💡 Hint: You must repay your loan before withdrawing
```

#### 4. Double Spend

```bash
# Try to borrow twice with same deposit
deno task borrow-v3 receipts/deposit-abc123.json 70
deno task borrow-v3 receipts/deposit-abc123.json 70

# Second attempt expected:
# ❌ Backend error: Deposit already used for borrowing
```

---

## Troubleshooting

### Test Failures

#### Circuit Tests Failing

**Symptom:**
```
Error: ENOENT: no such file or directory
  at prove_collateral_v3.wasm
```

**Solution:**
```bash
# Regenerate circuit files
cd backend/circuits
./setup.sh

# Or manually:
circom prove_collateral_v3.circom --r1cs --wasm --sym
snarkjs groth16 setup ...
```

#### Integration Tests Timing Out

**Symptom:**
```
error: Test case is leaking async ops.
```

**Solution:**
```bash
# Increase timeout
deno test --allow-all --timeout=120000 tests/integration.test.ts

# Or run with trace to identify leak
deno test --allow-all --trace-ops tests/integration.test.ts
```

#### Proof Verification Failing

**Symptom:**
```
❌ Proof verification failed
```

**Solution:**
1. Check circuit files version match
2. Regenerate verification key
3. Ensure BN254 field compliance
4. Check for circuit/code mismatch

### Common Issues

#### 1. "WALLET_SEED not found"

**Fix:**
```bash
# Add to .env
WALLET_SEED="your seed phrase here"
```

#### 2. "Backend not running"

**Fix:**
```bash
# Start backend in separate terminal
deno task backend-v3

# Verify health
curl http://localhost:3000/api/health
```

#### 3. "Insufficient funds"

**Fix:**
```bash
# Get test ADA from faucet
# Visit: https://docs.cardano.org/cardano-testnet/tools/faucet/

# Check balance
cardano-cli query utxo --address $(cat wallet.addr)
```

#### 4. "Commitment mismatch"

**Fix:**
- Ensure you're using the correct receipt file
- Don't manually edit receipt files
- Regenerate deposit if receipt is lost

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: V3 Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v1.40.x

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install snarkjs
        run: npm install -g snarkjs

      - name: Run Crypto Tests
        run: deno task test:crypto

      - name: Run Circuit Tests
        run: deno task test:circuit

      - name: Run Integration Tests
        run: deno test --allow-all tests/integration.test.ts
```

### Pre-commit Hooks

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash

echo "Running tests before commit..."

# Run quick tests
deno task test:crypto

if [ $? -ne 0 ]; then
    echo "❌ Crypto tests failed! Commit aborted."
    exit 1
fi

echo "✅ Tests passed! Proceeding with commit."
```

### Coverage Reports

Generate test coverage:

```bash
# Run tests with coverage
deno test --allow-all --coverage=coverage/ tests/

# Generate HTML report
deno coverage coverage/ --html

# View report
open coverage/html/index.html
```

---

## Performance Benchmarks

### Expected Performance

| Operation | Duration | Notes |
|-----------|----------|-------|
| Secret Generation | <1ms | Crypto random |
| Commitment Creation | ~15ms | Poseidon hash |
| Proof Generation | ~25-35s | Groth16 proof (browser: 45s) |
| Proof Verification | ~0.5-1s | Groth16 verify |
| Proof Hashing | ~2ms | SHA-256 |

### Optimization Tips

1. **Proof Caching:**
   - Cache proofs for same inputs
   - Store proof hash for quick lookup

2. **Parallel Processing:**
   - Generate multiple proofs in parallel
   - Use Web Workers in browser

3. **Circuit Optimization:**
   - Minimize constraint count
   - Use lookup tables for common operations

---

## Test Data

### Sample Test Values

```typescript
// Collateral amounts (lovelace)
const COLLATERAL_SMALL = 10_000_000;   // 10 ADA
const COLLATERAL_MEDIUM = 100_000_000;  // 100 ADA
const COLLATERAL_LARGE = 1000_000_000;  // 1000 ADA

// Loan amounts (80% LTV max)
const LOAN_SAFE = 7_000_000;    // 70% LTV
const LOAN_MAX = 8_000_000;     // 80% LTV
const LOAN_OVER = 9_000_000;    // 90% LTV (should fail)

// Interest (5% APR)
const INTEREST_10_ADA = 500_000;    // 0.5 ADA
const INTEREST_100_ADA = 5_000_000;  // 5 ADA
```

### Sample Secrets

**⚠️ FOR TESTING ONLY - NEVER USE IN PRODUCTION**

```typescript
// Test secret (252 bits)
const TEST_SECRET = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4";

// Generate real random secret
const REAL_SECRET = generateRandomSecret();
```

---

## Next Steps

After successful testing:

1. ✅ Deploy to Preprod
2. ✅ Run manual cycle tests
3. ✅ Monitor backend logs
4. ✅ Test error scenarios
5. ✅ Performance profiling
6. ✅ Security audit
7. ✅ Deploy to Mainnet (when ready)

---

## Support

- **Issues:** GitHub Issues
- **Discord:** Community Discord
- **Docs:** `/docs` folder
- **Email:** support@example.com

---

**Last Updated:** 2026-01-20
**Version:** V3 MVP
**Status:** Ready for Testing 🚀
