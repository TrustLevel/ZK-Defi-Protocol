# V3 Deployment Scripts

Complete deployment automation for V3 Privacy-Enhanced Lending Protocol.

## Overview

These scripts automate the deployment process from start to finish:

1. **Check Balance** - Verify admin wallet has sufficient funds
2. **Deploy Contracts** - Generate script addresses
3. **Mint Beacons** - Create beacon tokens
4. **Initialize Pool** - Set up lending pool with liquidity
5. **Configure Backend** - Set backend environment variables
6. **Verify Deployment** - Comprehensive system check

## Prerequisites

```bash
# 1. Environment configured
cp ../.env_sample ../.env
# Edit .env and set ADMIN_WALLET_SEED

# 2. Admin wallet funded
# Get test ADA from: https://docs.cardano.org/cardano-testnet/tools/faucet/

# 3. Smart contracts built
cd ../../onchain-module
aiken build
```

## Quick Start

### Option A: Run All Steps

```bash
cd /Users/dominiktilman/ZK-Defi-Protocol/offchain-module/scripts

# Run complete deployment
./deploy-all.sh
```

### Option B: Run Step-by-Step

```bash
cd /Users/dominiktilman/ZK-Defi-Protocol/offchain-module/scripts

# Step 1: Check balance (no blockchain TX)
deno run --allow-all --env 1-check-balance.ts

# Step 2: Deploy contracts (no blockchain TX - just generates addresses)
deno run --allow-all --env 2-deploy-contracts.ts

# Step 3: Mint beacon tokens (⚠️ BLOCKCHAIN TX)
deno run --allow-all --env 3-mint-beacons.ts

# Step 4: Initialize pool (⚠️ BLOCKCHAIN TX)
deno run --allow-all --env 4-initialize-pool.ts

# Step 5: Configure backend (no blockchain TX)
deno run --allow-all --env 5-configure-backend.ts

# Step 6: Verify everything
deno run --allow-all --env 6-verify-deployment.ts
```

## Script Details

### 1-check-balance.ts

**Purpose:** Verify admin wallet has sufficient funds

**Requirements:**
- ADMIN_WALLET_SEED in .env

**What it does:**
- Connects to Preprod
- Queries admin wallet balance
- Checks minimum 50 ADA (recommends 100+)

**Blockchain TX:** ❌ No
**Duration:** ~5 seconds

---

### 2-deploy-contracts.ts

**Purpose:** Generate script addresses for smart contracts

**Requirements:**
- plutus.json exists (run `aiken build` first)

**What it does:**
- Reads collateral_v3 and lending_pool_v3 from plutus.json
- Generates script addresses
- Saves addresses to .env

**Blockchain TX:** ❌ No
**Duration:** ~2 seconds

**Outputs:**
```
COLLATERAL_V3_ADDRESS=addr_test1wp...
LENDING_POOL_V3_ADDRESS=addr_test1wp...
```

---

### 3-mint-beacons.ts

**Purpose:** Mint beacon tokens

**Requirements:**
- Admin wallet funded (≥10 ADA for TX)

**What it does:**
- Creates minting policy
- Mints DEPOSIT token (qty: 1)
- Mints LENDINGPOOL token (qty: 1)
- Saves policy ID to .env

**Blockchain TX:** ✅ Yes (~3 ADA fee + min UTXO)
**Duration:** ~30 seconds

**Outputs:**
```
BEACON_POLICY_ID=9f8e7d6c5b4a...
```

---

### 4-initialize-pool.ts

**Purpose:** Create initial lending pool UTXO

**Requirements:**
- LENDING_POOL_V3_ADDRESS in .env
- BEACON_POLICY_ID in .env
- Admin wallet funded (≥1005 ADA: 1000 liquidity + 5 fees)

**What it does:**
- Creates pool datum (total_deposited=0, total_borrowed=0)
- Sends 1000 ADA to pool address
- Attaches LENDINGPOOL beacon token
- Creates inline datum

**Blockchain TX:** ✅ Yes (~1003 ADA: 1000 pool + 3 fee)
**Duration:** ~30 seconds

**Critical:** This locks 1000 ADA in the pool for test loans!

---

### 5-configure-backend.ts

**Purpose:** Set backend service addresses

**Requirements:**
- ADMIN_WALLET_SEED in .env

**What it does:**
- Gets admin wallet address
- Sets BACKEND_BORROW_ADDR in .env
- Sets BACKEND_REPAYMENT_ADDR in .env

**Blockchain TX:** ❌ No
**Duration:** ~2 seconds

---

### 6-verify-deployment.ts

**Purpose:** Comprehensive system verification

**Requirements:**
- All previous scripts completed

**What it checks:**
- ✅ All environment variables set
- ✅ Blockchain connectivity
- ✅ Admin wallet balance
- ✅ Beacon tokens in wallet
- ✅ Lending pool UTXO exists
- ✅ Pool datum correct
- ✅ Backend API responding

**Blockchain TX:** ❌ No (queries only)
**Duration:** ~10 seconds

---

## Troubleshooting

### Error: "ADMIN_WALLET_SEED not set"

**Fix:**
```bash
# Edit .env and add your seed phrase
echo 'ADMIN_WALLET_SEED="your 24-word seed phrase"' >> ../.env
```

---

### Error: "Insufficient funds"

**Fix:**
```bash
# Get test ADA from faucet
# Visit: https://docs.cardano.org/cardano-testnet/tools/faucet/
# Enter your admin address (shown in error message)
```

---

### Error: "plutus.json not found"

**Fix:**
```bash
cd ../../onchain-module
aiken build
```

---

### Error: "Pool UTXO not found"

**Fix:**
```bash
# Run script 4 again
deno run --allow-all --env 4-initialize-pool.ts
```

---

## Cost Breakdown

| Script | ADA Cost | Recoverable? |
|--------|----------|--------------|
| 1. Check Balance | 0 | - |
| 2. Deploy Contracts | 0 | - |
| 3. Mint Beacons | ~3 ADA | ❌ No (TX fees) |
| 4. Initialize Pool | ~1003 ADA | ⚠️ Partially (1000 in pool) |
| 5. Configure Backend | 0 | - |
| 6. Verify | 0 | - |
| **TOTAL** | **~1006 ADA** | **~1000 recoverable** |

**Net Cost:** ~6 ADA for deployment + fees

---

## After Deployment

Once all scripts complete successfully:

### 1. Start Backend

```bash
cd /Users/dominiktilman/ZK-Defi-Protocol/offchain-module

# Terminal 1: Start backend
deno task backend-v3

# Keep this terminal open!
```

### 2. Run Integration Tests

```bash
# Terminal 2: Run tests

# Test 1: Deposit 100 ADA
deno task deposit-v3 100

# Test 2: Borrow 70 ADA (anonymous)
RECEIPT=$(ls -t receipts/*.json | head -1)
deno task borrow-v3 $RECEIPT 70

# Test 3: Repay loan (anonymous)
deno task repay-v3 $RECEIPT 70

# Test 4: Withdraw collateral
deno task withdraw-v3 $RECEIPT
```

### 3. Verify Privacy

```bash
# Check transaction links on Preprod explorer
# Deposit TX signed by: USER
# Borrow TX signed by: ADMIN (different = 85% privacy!)
# Repay TX signed by: ADMIN (different = 65% privacy!)
# Withdraw TX signed by: USER
```

---

## Clean Up (Optional)

To reset and redeploy:

```bash
# 1. Stop backend
pkill -f "deno.*backend"

# 2. Clear receipts
rm -rf ../receipts/*.json

# 3. Remove deployment vars from .env
# Edit .env and remove:
# - COLLATERAL_V3_ADDRESS
# - LENDING_POOL_V3_ADDRESS
# - BEACON_POLICY_ID
# - BACKEND_BORROW_ADDR
# - BACKEND_REPAYMENT_ADDR

# 4. Re-run deployment scripts
./deploy-all.sh
```

---

## Support

- **Deployment Guide:** `/docs/DEPLOYMENT-GUIDE.md`
- **Testing Guide:** `/docs/TESTING-PLAN.md`
- **Implementation Status:** `/docs/implementation-status.md`

---

**Version:** 1.0
**Last Updated:** 2026-01-21
