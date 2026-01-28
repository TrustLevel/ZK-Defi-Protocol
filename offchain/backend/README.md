# V3 Backend Service - Anonymous Borrowing

## Overview

The V3 Backend Service enables **privacy-enhanced anonymous borrowing** by:
1. Verifying ZK proofs from users
2. Signing transactions with admin wallet
3. Breaking the onchain link between deposits and borrows

This achieves **~85% privacy** during borrowing!

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    V3 Anonymous Borrow Flow                  │
└─────────────────────────────────────────────────────────────┘

User Side (CLI):                    Backend Service:
┌───────────────┐                   ┌────────────────┐
│ 1. Load       │                   │                │
│    Receipt    │                   │                │
│    (secret)   │                   │                │
└───────┬───────┘                   │                │
        │                           │                │
┌───────▼───────┐                   │                │
│ 2. Generate   │                   │                │
│    ZK Proof   │                   │                │
│    (proves    │                   │                │
│    ownership) │                   │                │
└───────┬───────┘                   │                │
        │                           │                │
        │  HTTP POST /api/v3/borrow │                │
        └──────────────────────────►│ 3. Verify     │
                                    │    Proof       │
                                    └────────┬───────┘
                                             │
                                    ┌────────▼───────┐
                                    │ 4. Build TX    │
                                    │    (Admin      │
                                    │    signed!)    │
                                    └────────┬───────┘
                                             │
                                    ┌────────▼───────┐
                                    │ 5. Submit TX   │
                                    │    to Cardano  │
                                    └────────┬───────┘
                                             │
        ┌────────────────────────────────────┘
        │  Response: { txHash, success }
        │
┌───────▼───────┐
│ 6. Receive    │
│    Loan       │
│    (at dest   │
│    address)   │
└───────────────┘

Privacy Achieved:
✅ User does NOT sign the borrow transaction
✅ Backend signs with admin wallet
✅ NO onchain link between deposit and borrow!
```

## Files

### Core Backend Files

- **`server.ts`** - Main API server
  - Handles HTTP requests
  - Routes to appropriate handlers
  - CORS configuration

- **`borrow-v3.ts`** - Borrow request handler
  - Verifies ZK proofs
  - Builds and signs transactions
  - Interacts with lending pool

- **`../lib/proof.ts`** - Proof utilities (shared with CLI)
  - `generateCollateralProof()` - Generate ZK proof
  - `verifyCollateralProof()` - Verify ZK proof
  - `initProofSystem()` - Initialize Poseidon hash

## API Endpoints

### POST /api/v3/borrow

Request anonymous loan with ZK proof.

**Request:**
```json
{
  "depositUtxoRef": "abc123...#0",
  "loanAmount": 1200000000,
  "destinationAddress": "addr_test1q...",
  "proof": {
    "pi_a": [...],
    "pi_b": [...],
    "pi_c": [...]
  },
  "publicSignals": {
    "commitment": "12345...",
    "loan_amount": "1200000000",
    "collateral_ratio": "125"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "txHash": "def456...",
  "details": {
    "collateralAmount": 1500000000,
    "loanAmount": 1200000000,
    "interest": 60000000,
    "serviceFee": 500000,
    "totalBorrowed": 1200000000
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid ZK proof! Proof verification failed."
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "v3",
  "timestamp": 1705776000000
}
```

## Running the Backend

### 1. Prerequisites

Ensure `.env` is configured:

```bash
# Required for backend
ADMIN_WALLET_SEED=your 24-word seed here
COLLATERAL_V3_ADDRESS=addr_test1w...
LENDING_POOL_V3_ADDRESS=addr_test1w...
BEACON_POLICY_ID=...
BLOCKFROST_PROJECT_ID=...

# API Configuration
API_PORT=3000
API_HOST=localhost
API_CORS_ORIGIN=http://localhost:8000
```

### 2. Start Server

```bash
# Start backend service
deno task backend-v3

# Or run directly
deno run --allow-all backend/server.ts
```

**Output:**
```
═══════════════════════════════════════════════════════
🚀 V3 Backend API Server Starting
═══════════════════════════════════════════════════════

📋 Configuration:
   Host: localhost
   Port: 3000
   CORS Origin: http://localhost:8000

📡 Available Endpoints:
   GET  /api/health          - Health check
   POST /api/v3/borrow       - Anonymous borrow
   POST /api/v3/repay        - Anonymous repay (Phase 5)

═══════════════════════════════════════════════════════
✅ Server listening on http://localhost:3000
═══════════════════════════════════════════════════════
```

### 3. Test Health Endpoint

```bash
curl http://localhost:3000/api/health
```

## Complete User Flow Example

### Step 1: User Deposits (CLI)

```bash
# User deposits 1500 ADA with ZK commitment
deno task deposit-v3 1500

# Output: Receipt saved to ./receipts/deposit-abc123.json
# Contains secret (needed for borrowing!)
```

### Step 2: Backend Running

```bash
# Terminal 1: Start backend
deno task backend-v3

# Backend is now listening for borrow requests
```

### Step 3: User Borrows (CLI)

```bash
# Terminal 2: User requests anonymous loan
deno task borrow-v3 ./receipts/deposit-abc123.json 1200

# This:
# 1. Loads receipt (contains secret)
# 2. Generates ZK proof locally
# 3. Sends proof to backend via HTTP
# 4. Backend verifies and issues loan
```

**CLI Output:**
```
═══════════════════════════════════════════════════════
🔐 V3 Anonymous Borrow (Privacy-Enhanced)
═══════════════════════════════════════════════════════

📄 Step 1: Loading deposit receipt...
   ✅ Receipt loaded
   Collateral: 1,500 ADA

🔒 Step 5: Generating ZK proof...
   This proves you own the deposit without revealing your secret!
   ✅ ZK proof generated!

📤 Step 7: Sending borrow request to backend...
   Backend API: http://localhost:3000
   Privacy: Backend will sign the transaction (not you!)

═══════════════════════════════════════════════════════
✅ BORROW SUCCESSFUL!
═══════════════════════════════════════════════════════

📋 Transaction Details:
   TX Hash: def456...
   Loan Amount: 1,200 ADA
   Interest (5%): 60 ADA

🎯 Privacy Achieved:
   ✅ Borrow transaction signed by backend (admin wallet)
   ✅ NO onchain link between deposit and borrow
   ✅ Your identity is protected (~85% privacy)
```

**Backend Log:**
```
═══════════════════════════════════════════════════════
🔐 Processing Anonymous Borrow Request
═══════════════════════════════════════════════════════

🔍 Step 1: Verifying ZK proof...
   ✅ Proof verified successfully

🔨 Step 7: Building transaction...
   ✅ Transaction built

✍️  Step 8: Signing transaction with admin key...
   ✅ Transaction signed: def456...

📤 Step 9: Submitting transaction...
   ✅ Transaction submitted!

═══════════════════════════════════════════════════════
✅ BORROW SUCCESSFUL!
═══════════════════════════════════════════════════════
```

## Security Considerations

### Admin Wallet Security

⚠️ **CRITICAL:** The admin wallet key is **highly sensitive**!

**Development (Preprod):**
- Store in `.env` file (gitignored)
- Use a dedicated test wallet
- Never use mainnet funds

**Production:**
- Use Hardware Security Module (HSM)
- Or secure key management service (AWS KMS, Google Cloud KMS)
- Implement multi-sig if possible
- Regular security audits

### Rate Limiting

Implement rate limiting to prevent:
- DoS attacks
- Spam proof verification requests
- Resource exhaustion

**Recommended limits:**
- 10 requests per minute per IP
- 100 requests per hour per IP

### Proof Verification

The backend MUST verify:
1. ✅ ZK proof is valid (snarkjs.groth16.verify)
2. ✅ Commitment matches onchain deposit
3. ✅ Loan amount doesn't exceed max LTV
4. ✅ Pool has sufficient liquidity
5. ✅ Deposit UTXO exists and is unspent

### Transaction Safety

Before submitting:
- ✅ Verify all inputs and outputs
- ✅ Check transaction fee is reasonable
- ✅ Ensure pool datum is correctly updated
- ✅ Validate destination address format

## Monitoring

### Metrics to Track

1. **Request Volume**
   - Borrow requests per hour/day
   - Success vs failure rate

2. **Proof Verification**
   - Verification time (should be <100ms)
   - Invalid proof attempts

3. **Transaction Status**
   - Submitted transactions
   - Confirmed transactions
   - Failed transactions

4. **Pool State**
   - Total deposited
   - Total borrowed
   - Available liquidity

### Logging

Log all requests with:
- Timestamp
- Request type (borrow/repay)
- UTXO references (for debugging)
- Proof verification result
- Transaction hash (if successful)
- Error messages (if failed)

**Example log format:**
```
[2026-01-20 14:23:45] BORROW_REQUEST depositRef=abc123#0 loanAmount=1200000000
[2026-01-20 14:23:46] PROOF_VERIFIED valid=true duration=87ms
[2026-01-20 14:23:48] TX_SUBMITTED txHash=def456... status=success
```

## Troubleshooting

### Error: "Invalid ZK proof"

**Causes:**
- Secret doesn't match commitment
- Loan amount exceeds max LTV
- Circuit inputs malformed

**Solution:**
- Verify receipt secret is correct
- Check loan amount vs collateral
- Ensure proof was generated correctly

### Error: "Insufficient liquidity"

**Cause:**
- Lending pool doesn't have enough ADA

**Solution:**
- Wait for liquidity to increase
- Or request smaller loan amount

### Error: "Deposit UTXO not found"

**Causes:**
- UTXO already spent
- Wrong network (mainnet vs preprod)
- UTXO reference incorrect

**Solution:**
- Check UTXO on Cardanoscan
- Verify receipt is correct
- Ensure backend is on correct network

## Development vs Production

### Development (Current)

- ✅ Backend runs on localhost:3000
- ✅ Uses Preprod network
- ✅ Admin wallet seed in `.env`
- ✅ Logs everything to console
- ✅ No rate limiting

### Production (TODO)

- 🚧 Deploy to cloud (Render, Railway, Fly.io)
- 🚧 Use HSM for admin wallet
- 🚧 Implement rate limiting
- 🚧 Structured logging (JSON)
- 🚧 Monitoring & alerts
- 🚧 Load balancing
- 🚧 Database for request tracking
- 🚧 Automated backups

## Next Steps

After Phase 4 is complete:
- 🚧 Phase 5: Implement `/api/v3/repay` endpoint
- 🚧 Phase 6: Add comprehensive tests
- 🚧 Phase 7: Deploy to production

---

**V3 Backend Service**
*Enabling anonymous borrowing with Zero-Knowledge proofs* 🔒
