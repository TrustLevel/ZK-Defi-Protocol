# Borrow V3 - Anonymous Borrowing Guide

**Last Updated:** 2026-01-27

---

## 🔐 Overview

The `borrow-v3-node.mjs` script allows you to borrow anonymously against your collateral deposit using Zero-Knowledge proofs.

**Privacy Level:** ~50-60% (when used correctly with fresh wallet)

---

## ⚠️  CRITICAL FOR PRIVACY

**You MUST use a FRESH wallet address that has NO connection to your deposit address!**

If you send the loan to your original wallet (the one that made the deposit), your deposit and loan will be publicly linked on-chain, destroying the privacy benefits.

---

## 📋 Prerequisites

1. **Completed Deposit:** You must have deposited collateral first
2. **Deposit Receipt:** Saved from deposit transaction (contains your secret)
3. **Fresh Wallet:** A NEW Cardano wallet address with no connection to your deposit
4. **Backend Running:** The backend service must be online at `http://localhost:3000`
5. **Node.js v18+:** Required for ZK proof generation

---

## 🚀 Usage

### Basic Command

```bash
node borrow-v3-node.mjs <receipt-file> <loan-amount-ada> <destination-address>
```

### Example

```bash
node cli/v3/borrow-v3-node.mjs \
  ./receipts/deposit-04fd9599bfb42a1eb0987fed8ea12c71dc765c80f495ce849eaec1a2b3316555.json \
  70 \
  addr_test1qz_YOUR_FRESH_WALLET_ADDRESS_HERE...
```

### Parameters

1. **receipt-file:** Path to your deposit receipt JSON
   - Contains: `txHash`, `secret`, `commitment`, `collateralAmount`
   - Location: `./receipts/deposit-<txHash>.json`

2. **loan-amount-ada:** Amount to borrow in ADA
   - Must be ≤ 80% of collateral (80% LTV)
   - Example: 100 ADA collateral → max 80 ADA loan

3. **destination-address:** Fresh Cardano address to receive loan
   - **MUST be a NEW wallet** with no connection to deposit
   - Must start with `addr_test1` (Preprod) or `addr1` (Mainnet)
   - Example: `addr_test1qz...`

---

## 🔐 Privacy Best Practices

### ✅ DO:

1. **Create a completely fresh wallet** before borrowing
   - Use a different wallet software installation
   - Or create a new account in your existing wallet
   - **No transaction history** with your deposit wallet

2. **Use the fresh wallet address** as destination
   - The loan goes to this fresh wallet
   - No on-chain link to your deposit

3. **Keep receipts secure**
   - Store in encrypted location
   - Backup securely
   - Don't share with anyone

### ❌ DON'T:

1. **Don't use your original deposit wallet** as destination
   - This creates an on-chain link
   - Reduces privacy to ~30%
   - Script will warn you if detected

2. **Don't reuse fresh wallets**
   - Each borrow should use a different fresh wallet
   - Reusing reduces anonymity set

3. **Don't share your secret or receipt**
   - Anyone with your secret can prove ownership
   - Keep receipts private

---

## 📊 What Happens Step-by-Step

### Step 1: Load Receipt
```
✅ Receipt loaded: ./receipts/deposit-04fd9599...json
   Deposit TX: 04fd9599...
   UTXO: 04fd9599...#0
   Collateral: 100 ADA
```

### Step 2: Validate Loan
```
✅ Requested Loan: 70 ADA
   Max Loan (80% LTV): 80 ADA
   Interest (5% APR): 3.5 ADA
   Total Repayment: 73.5 ADA
```

### Step 3: Generate ZK Proof
```
🔐 Generating ZK proof... (takes ~25 seconds)
   Collateral: 100 ADA
   Loan: 70 ADA
   LTV Ratio: 80%
✅ Proof generated in 24.3s
```

### Step 4: Submit to Backend
```
📤 Sending borrow request to backend...
   API: http://localhost:3000/api/v3/borrow
✅ Transaction submitted!
```

### Step 5: Success
```
✅ BORROW SUCCESSFUL!

📋 Summary:
   TX Hash: abc123...
   Loan Amount: 70 ADA
   Interest (5% APR): 3.5 ADA
   Total Repayment: 73.5 ADA
   Destination: addr_test1qz...

🔐 Privacy Notes:
   ✅ You borrowed anonymously using a ZK proof
   ✅ The blockchain doesn't reveal which deposit you used
   ✅ Transaction signed by backend (not your wallet)
   ✅ Loan sent to fresh wallet (good for privacy!)
```

---

## 🔍 What's Happening On-Chain

### Transaction Inputs:
1. **Lending Pool UTXO** (spending)
   - 1000 ADA → 930 ADA
   - `total_borrowed` updated

2. **Your Deposit UTXO** (reference only)
   - **NOT spent or modified!**
   - Only used to prove collateral exists
   - Remains at collateral contract

### Transaction Outputs:
1. **Updated Lending Pool**
   - 930 ADA
   - Updated datum with new `total_borrowed`

2. **Loan Payment**
   - 70 ADA → Your fresh wallet
   - **No on-chain link to deposit!**

### Privacy Achieved:
- ✅ Your deposit UTXO is unchanged
- ✅ ZK proof proves ownership without revealing secret
- ✅ Backend signed (your wallet didn't sign)
- ✅ Loan to fresh wallet (no graph link)
- ✅ On-chain: "Someone with valid collateral borrowed 70 ADA"
- ✅ Not revealed: "Which deposit was used"

---

## 🚨 Troubleshooting

### Error: "Missing required arguments"
```bash
# You need all 3 arguments:
node borrow-v3-node.mjs <receipt> <amount> <destination>
```

### Error: "Invalid destination address format"
```bash
# Address must start with "addr"
# Preprod: addr_test1...
# Mainnet: addr1...
```

### Error: "Loan amount exceeds max loan"
```bash
# You can only borrow up to 80% of collateral
# 100 ADA collateral = max 80 ADA loan
```

### Error: "Insufficient liquidity in pool"
```bash
# Pool doesn't have enough ADA available
# Try borrowing less, or wait for pool to be refunded
```

### Error: "Invalid ZK proof"
```bash
# Your proof verification failed
# Check that:
# - Receipt file is correct and not corrupted
# - Deposit still exists on-chain
# - Circuit files are present in ../circuits/
```

### Warning: "Destination address matches deposit owner"
```bash
# You're sending loan to same wallet as deposit!
# Privacy reduced to ~30%
# Use a fresh wallet for better privacy
```

---

## 📈 Privacy Levels

| Destination | Privacy Level | Recommendation |
|-------------|---------------|----------------|
| Fresh Wallet (no connection) | ~60% | ✅ Recommended |
| Fresh Wallet (same software) | ~50% | ⚠️ OK |
| Original Deposit Wallet | ~30% | ❌ Not Recommended |
| Reused Fresh Wallet | ~40% | ⚠️ Suboptimal |

---

## 🔗 Next Steps

After successful borrow:

1. **Wait for confirmation** (~20 seconds)
   - Check transaction on explorer
   - Verify loan received in fresh wallet

2. **Keep receipt safe**
   - You need it for repayment
   - Contains your secret

3. **Plan repayment**
   - Total repayment: Loan + 5% interest
   - 70 ADA loan → 73.5 ADA repayment
   - Use `repay-anonymous-v3` script when ready

---

## 🔐 Security Notes

- Your **secret** never leaves your machine
- ZK proof is generated **locally** on your computer
- Backend **only verifies** the proof (doesn't see your secret)
- Backend **signs** the transaction (you don't sign with your wallet)
- Deposit UTXO **remains unchanged** (privacy preserved)

---

## 📚 Related Documentation

- [FLOW-ANALYSIS.md](../../../docs/FLOW-ANALYSIS.md) - Detailed flow explanation
- [BORROW-ANALYSIS.md](../../../docs/BORROW-ANALYSIS.md) - Technical analysis
- [v3-zk-privacy-design.md](../../../docs/v3-zk-privacy-design.md) - Design document
- [README-V3.md](./README-V3.md) - V3 CLI overview

---

**For Issues:** Report at https://github.com/your-org/ZK-Defi-Protocol/issues
