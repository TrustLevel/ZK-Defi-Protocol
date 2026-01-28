# Admin Tools - Proving Service

Admin-only CLI tools for the ZK-DeFi Protocol.

## Overview

This directory contains admin-side tools that handle backend operations for anonymous borrowing:
1. Generates ZK proofs for borrow requests (on behalf of users)
2. Verifies proofs off-chain
3. Builds and signs transactions with admin key
4. Issues loans to user-specified destination addresses

**Note:** This is an **alternative workflow** to the production HTTP API (`../../backend/services/borrow.ts`).

### Two Workflows

**Admin Workflow (This Tool):**
- User gives admin their secret
- Admin generates proof and signs transaction
- **Use Case:** Development, testing, or full-service approach

**Production Workflow (HTTP API):**
- User generates proof themselves
- User sends proof via `POST /api/v3/borrow`
- Backend only verifies and signs
- **Use Case:** True anonymity (user keeps secret private)

## Architecture

```
User → Creates borrow request (with secret, collateral UTXO, loan details)
     ↓
User → Submits request to Backend (JSON file or API)
     ↓
Backend → Generates ZK Proof (using circuit + proving key)
Backend → Verifies Proof (using verification key)
Backend → Builds Transaction (BorrowAnonymous redeemer)
Backend → Signs Transaction (with admin key)
Backend → Submits to Blockchain
     ↓
Blockchain → Loan issued to destination address (anonymous!)
```

## Files

- `prove-and-borrow.ts` - Main proving service script
- `admin-wallet.json` - Admin signing key (**gitignored, SENSITIVE!**)
- `.gitignore` - Ignore sensitive files
- `README.md` - This file

## Usage

### Setup Admin Wallet

First, create an admin wallet:

```bash
# Generate admin wallet (using cardano-cli or similar)
# Save to admin-wallet.json with format:
{
  "type": "PaymentSigningKeyShelley_ed25519",
  "description": "Payment Signing Key",
  "cborHex": "5820..."
}
```

⚠️ **IMPORTANT:** Never commit `admin-wallet.json` to git!

### Process Borrow Request

```bash
# User creates request file
cat > borrow-request.json <<EOF
{
  "secret": "123456789012345678901234567890",
  "collateral_utxo": "abc123def456...#0",
  "loan_amount": "700000000",
  "loan_term": "3888000000",
  "destination": "addr_test1qz..."
}
EOF

# Admin runs proving service
deno task admin:prove-and-borrow borrow-request.json
```

### What Happens

1. **Load Request:** Read borrow request from JSON file
2. **Fetch Collateral:** Query blockchain for collateral UTXO
3. **Calculate Commitment:** `commitment = Poseidon(collateral_amount, secret)`
4. **Generate Witness:** Create circuit witness from inputs
5. **Generate Proof:** Create ZK proof (takes ~1 second)
6. **Verify Proof:** Verify proof locally before submitting
7. **Build Transaction:** Create BorrowAnonymous transaction
8. **Sign & Submit:** Sign with admin key and submit to chain

## Request Format

### Input: `borrow-request.json`

```json
{
  "secret": "string",              // User's secret (256-bit number as string)
  "collateral_utxo": "string",     // Format: "txHash#index"
  "loan_amount": "string",         // Amount in lovelace (e.g., "700000000")
  "loan_term": "string",           // Term in milliseconds (e.g., "3888000000")
  "destination": "string"          // Cardano address (where loan goes)
}
```

### Output

The script will:
- Generate proof files (witness, proof, public signals)
- Build and submit transaction
- Print transaction hash
- Return success/error status

## Security Considerations

### Admin Key Security

⚠️ The admin key is **HIGHLY SENSITIVE**:
- Can sign transactions that issue loans
- Must be kept secure (HSM in production)
- Never commit to version control
- Rotate regularly in production

### Proof Verification

✅ Proofs are verified **BEFORE** transaction submission:
- Ensures commitment is valid
- Ensures collateral is sufficient
- Prevents invalid loan requests

### Request Validation

The service validates:
- Collateral UTXO exists on-chain
- Collateral is not already locked
- Loan amount doesn't exceed limits
- Collateral ratio is met

## Development

### Testing Locally

```bash
# 1. Generate test secret
deno task generate-secret

# 2. Create test request with generated secret
cat > test-request.json <<EOF
{
  "secret": "<from .data/secrets.json>",
  "collateral_utxo": "<your test UTXO>",
  "loan_amount": "700000000",
  "loan_term": "3888000000",
  "destination": "<your test address>"
}
EOF

# 3. Run service
deno task admin:prove-and-borrow test-request.json
```

### Circuit Paths

The service uses these circuit files:
- Circuit: `../../circuits/collateral_proof_js/collateral_proof.wasm`
- Proving Key: `../../circuits/keys/collateral_proof_0000.zkey`
- Verification Key: `../../circuits/keys/verification_key.json`

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `Admin wallet not found` | Missing `admin-wallet.json` | Create admin wallet |
| `Collateral UTXO not found` | Invalid UTXO reference | Check UTXO exists on-chain |
| `Proof verification failed` | Invalid secret or amounts | Check request parameters |
| `Insufficient collateral` | Collateral too low | Increase collateral amount |
| `Transaction failed` | Various on-chain errors | Check transaction logs |

## Production Deployment

For production use:

1. **HSM Integration:** Store admin key in Hardware Security Module
2. **API Endpoint:** Expose as REST API instead of CLI
3. **Rate Limiting:** Prevent abuse of proving service
4. **Monitoring:** Log all proof generations and transactions
5. **Backup:** Regular backups of transaction history
6. **Key Rotation:** Rotate admin keys periodically

## Performance

Expected performance:
- **Proof Generation:** ~1 second
- **Proof Verification:** ~100ms
- **Transaction Building:** ~500ms
- **Total Time:** ~2-3 seconds per request

## Future Enhancements

Possible improvements:
- Batch processing of multiple requests
- API server instead of CLI
- Database for request tracking
- Automated collateral monitoring
- Multi-sig admin keys
- Integration with monitoring tools
