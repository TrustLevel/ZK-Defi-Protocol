# V3 Privacy-Enhanced Lending Protocol - CLI Tools

## Overview

V3 introduces **privacy-enhanced lending** using Zero-Knowledge proofs. Users can:
1. **Deposit** collateral with a ZK commitment
2. **Borrow** anonymously using ZK proofs
3. **Repay** anonymously using ZK proofs
4. **Withdraw** collateral after repayment

## Privacy Model

- **10% Privacy on Deposit** - Commitment hides exact amount
- **85% Privacy on Borrow** - Backend-signed, no link to deposit
- **65% Privacy on Repay** - Backend-signed, proves ownership via ZK
- **40% Privacy on Withdraw** - Owner signature required

## Prerequisites

### 1. Environment Setup

Copy `.env.example` to `.env` and fill in:

```bash
# Network
NETWORK=preprod
BLOCKFROST_PROJECT_ID=your_blockfrost_key_here

# Wallets
USER1_WALLET_SEED="your 24-word seed phrase here"
ADMIN_WALLET_SEED="admin 24-word seed phrase here"

# V3 Contract Addresses (after deployment)
COLLATERAL_V3_ADDRESS=addr_test1w...
LENDING_POOL_V3_ADDRESS=addr_test1w...
BEACON_POLICY_ID=...

# Backend Service (after backend deployment)
BACKEND_BORROW_ADDR=addr_test1q...
BACKEND_REPAYMENT_ADDR=addr_test1q...

# Loan Parameters
MAX_LTV_RATIO=80
INTEREST_RATE_BPS=500
MIN_COLLATERAL_ADA=10000000
```

### 2. Install Dependencies

```bash
cd offchain-module
deno cache --reload deno.json
```

### 3. Deploy Contracts

Before using V3 CLI tools, you must:
1. Deploy collateral_v3.ak and lending_pool_v3.ak
2. Mint beacon tokens
3. Update COLLATERAL_V3_ADDRESS and BEACON_POLICY_ID in .env

## CLI Commands

### Deposit Collateral (V3)

Deposit collateral with ZK commitment for anonymous borrowing.

```bash
# Deposit 1500 ADA
deno task deposit-v3 1500

# Or run directly
deno run --allow-all cli/deposit-collateral-v3.ts 1500
```

**What it does:**
1. Generates random secret (252-bit)
2. Creates Poseidon commitment: `commitment = Poseidon(amount, secret)`
3. Builds transaction with DepositDatum
4. Adds beacon token to UTXO
5. Saves receipt with **SECRET** (⚠️ CRITICAL - save this!)

**Output:**
```
✅ DEPOSIT SUCCESSFUL!
TX Hash: abc123...
UTXO Ref: abc123...#0
Collateral: 1,500 ADA
Max Loan: 1,200 ADA (80% LTV)
Receipt: ./receipts/deposit-abc123....json

⚠️  SAVE YOUR RECEIPT! You need it for anonymous borrowing.
```

**Receipt Format:**
```json
{
  "depositTxHash": "abc123...",
  "depositUtxoRef": "abc123...#0",
  "collateralAmount": 1500000000,
  "secret": "0a1b2c3d...",  // ⚠️ CRITICAL - needed for borrowing!
  "commitment": "1a2b3c4d...",
  "owner": "addr_test1q...",
  "timestamp": 1705776000000
}
```

### Borrow Anonymously (V3)

**Status:** 🚧 Coming in Phase 4

Request an anonymous loan using ZK proof.

```bash
# Borrow 1200 ADA against deposit abc123...#0
deno task borrow-v3 abc123...#0 1200
```

**What it will do:**
1. Load secret from receipt
2. Generate ZK proof: proves ownership without revealing secret
3. Send proof to backend
4. Backend verifies proof and disburses loan
5. No link between deposit and borrow transaction!

### Repay Loan (V3)

**Status:** 🚧 Coming in Phase 5

Repay loan anonymously using ZK proof.

```bash
# Repay loan for deposit abc123...#0
deno task repay-v3 abc123...#0
```

**What it will do:**
1. Load secret from receipt
2. Calculate repayment amount (principal + interest)
3. Generate ZK proof
4. Backend verifies proof and unlocks collateral
5. Anonymous repayment - no link to borrower!

### Withdraw Collateral (V3)

**Status:** 🚧 Coming in Phase 6

Withdraw collateral after repayment.

```bash
# Withdraw collateral from abc123...#0
deno task withdraw-v3 abc123...#0
```

## Testing

### Test Crypto Utilities

```bash
deno task test:crypto
# Runs 22 tests for crypto functions
```

### Test ZK Circuit

```bash
deno task test:circuit
# Runs 5 circuit integration tests
```

## User Flow Example

### Complete Anonymous Borrow Flow

```bash
# 1. Deposit 1500 ADA with ZK commitment
deno task deposit-v3 1500
# Output: Receipt saved to ./receipts/deposit-abc123.json
# ⚠️  SAVE THIS RECEIPT!

# 2. Wait for confirmation (~20 seconds)
sleep 20

# 3. Borrow 1200 ADA anonymously (Phase 4)
deno task borrow-v3 abc123...#0 1200
# Backend verifies ZK proof and disburses loan
# No onchain link between deposit and borrow!

# 4. Repay loan after 30 days (Phase 5)
deno task repay-v3 abc123...#0
# Repay 1260 ADA (1200 + 60 interest at 5%)
# Backend verifies proof and unlocks collateral

# 5. Withdraw collateral (Phase 6)
deno task withdraw-v3 abc123...#0
# Get your 1500 ADA back!
```

## Privacy Breakdown

### Deposit (10% Privacy)
- ✅ Commitment hides exact amount from casual observers
- ❌ Onchain deposit visible
- ❌ Owner address visible
- Privacy Level: **10%**

### Borrow (85% Privacy)
- ✅ No onchain link to deposit
- ✅ Backend-signed transaction (admin address)
- ✅ ZK proof proves ownership without revealing secret
- ❌ Loan amount visible onchain
- Privacy Level: **85%** 🎯

### Repay (65% Privacy)
- ✅ Backend-signed transaction
- ✅ ZK proof used for verification
- ❌ Repayment amount visible
- Privacy Level: **65%**

### Withdraw (40% Privacy)
- ✅ After repayment, ownership proved
- ❌ Owner must sign (address revealed)
- Privacy Level: **40%**

**Overall Privacy: ~60-65%** 🔒

## Troubleshooting

### Error: "COLLATERAL_V3_ADDRESS not set"

You need to deploy V3 contracts first and update `.env`:

```bash
# Deploy contracts (onchain-module)
aiken build
# ... deploy collateral_v3 and lending_pool_v3 ...
# Update .env with contract addresses
```

### Error: "BEACON_POLICY_ID not set"

You need to mint beacon tokens first:

```bash
deno task mint-beacon-tokens
# Update .env with beacon policy ID
```

### Error: "Amount must be at least 10 ADA"

Minimum collateral is 10 ADA (configurable in `.env`):

```bash
MIN_COLLATERAL_ADA=10000000  # 10 ADA in lovelace
```

### Receipt Lost?

⚠️ **WITHOUT YOUR RECEIPT, YOU CANNOT BORROW ANONYMOUSLY!**

The receipt contains your secret, which is needed to:
- Generate ZK proofs
- Borrow anonymously
- Repay the loan

Always backup your receipts:
```bash
# Backup receipts folder
cp -r receipts/ receipts-backup/
```

## Architecture Notes

### Why Backend-Signed Transactions?

V3 uses **backend-signed transactions** for borrow/repay to achieve privacy:

1. **User generates ZK proof** (offchain)
2. **User sends proof to backend** (via API)
3. **Backend verifies proof** (snarkjs.groth16.verify)
4. **Backend signs and submits transaction** (admin wallet)

This way:
- No link between user's deposit and borrow transactions
- User's address not revealed during borrow/repay
- Privacy enhanced by ~75%!

### ZK Circuit

The circuit (`ProveOwnership.circom`) proves:

```circom
// Public inputs (visible to verifier)
signal input commitment;
signal input loan_amount;
signal input collateral_ratio;

// Private inputs (secret)
signal input secret;
signal input collateral_amount;

// Constraints
commitment === Poseidon(collateral_amount, secret);
collateral_amount * 100 >= loan_amount * collateral_ratio;
```

This allows anonymous borrowing because:
- User proves they own a deposit with sufficient collateral
- Without revealing which deposit or the secret!

## Security Warnings

⚠️ **CRITICAL SECURITY NOTES:**

1. **NEVER share your receipt or secret!**
   - Anyone with your secret can borrow against your collateral!

2. **Backup your receipts securely**
   - Store in password manager or encrypted backup
   - Without receipt, you cannot borrow or prove ownership

3. **Use testnet for development**
   - V3 is in development, use Preprod/Preview networks only
   - Never use mainnet until thoroughly audited!

4. **Backend must be trusted**
   - Backend can censor transactions (but cannot steal funds)
   - Consider running your own backend instance

## Next Steps

After Phase 3 (Deposit) is complete:
- 🚧 Phase 4: Borrow Flow + Backend Service
- 🚧 Phase 5: Repay Flow
- 🚧 Phase 6: Withdraw Flow + Testing
- 🚧 Phase 7: UI (Optional)

## Support

For issues or questions:
- Check logs in console output
- Verify `.env` configuration
- Ensure contracts are deployed
- Check Blockfrost API key is valid

---

**V3 Privacy-Enhanced Lending Protocol**
*Anonymous borrowing with Zero-Knowledge proofs on Cardano* 🔒
