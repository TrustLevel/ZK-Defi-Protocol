#!/bin/bash
#
# V3 Complete Deployment Script
#
# Runs all deployment steps in sequence:
# 1. Check balance
# 2. Deploy contracts
# 3. Mint beacons
# 4. Initialize pool
# 5. Configure backend
# 6. Verify deployment
#

set -e  # Exit on error

echo "═══════════════════════════════════════════════════════"
echo "🚀 V3 COMPLETE DEPLOYMENT"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "This script will:"
echo "  1. Check admin wallet balance"
echo "  2. Deploy smart contracts (generate addresses)"
echo "  3. Mint beacon tokens (⚠️ BLOCKCHAIN TX)"
echo "  4. Initialize pool with 1000 ADA (⚠️ BLOCKCHAIN TX)"
echo "  5. Configure backend service"
echo "  6. Verify complete deployment"
echo ""
echo "⚠️  WARNING: Steps 3-4 will submit transactions to Preprod!"
echo "   Cost: ~1006 ADA (1000 ADA in pool + 6 ADA fees)"
echo ""

# Confirm
read -p "Continue with deployment? (yes/no) " -n 3 -r
echo
if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "Starting deployment..."
echo "═══════════════════════════════════════════════════════"
echo ""

# Step 1: Check Balance
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1/6: Checking Admin Wallet Balance"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

deno run --allow-all --env 1-check-balance.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Balance check failed! Please fund your wallet."
    exit 1
fi

echo ""
read -p "Press ENTER to continue to Step 2..." -r
echo ""

# Step 2: Deploy Contracts
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2/6: Deploying Smart Contracts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

deno run --allow-all --env 2-deploy-contracts.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Contract deployment failed!"
    exit 1
fi

echo ""
read -p "Press ENTER to continue to Step 3..." -r
echo ""

# Step 3: Mint Beacons (BLOCKCHAIN TX!)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3/6: Minting Beacon Tokens"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  This will submit a transaction to Preprod!"
echo "   Cost: ~3 ADA (TX fees)"
echo ""

read -p "Continue? (yes/no) " -n 3 -r
echo
if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Deployment cancelled at Step 3."
    exit 1
fi

deno run --allow-all --env 3-mint-beacons.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Beacon minting failed!"
    exit 1
fi

echo ""
read -p "Press ENTER to continue to Step 4..." -r
echo ""

# Step 4: Initialize Pool (BLOCKCHAIN TX!)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 4/6: Initializing Lending Pool"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  This will submit a transaction to Preprod!"
echo "   Cost: ~1003 ADA (1000 ADA pool liquidity + 3 ADA fees)"
echo "   The 1000 ADA will be locked in the pool for test loans."
echo ""

read -p "Continue? (yes/no) " -n 3 -r
echo
if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Deployment cancelled at Step 4."
    exit 1
fi

deno run --allow-all --env 4-initialize-pool.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Pool initialization failed!"
    exit 1
fi

echo ""
read -p "Press ENTER to continue to Step 5..." -r
echo ""

# Step 5: Configure Backend
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 5/6: Configuring Backend Service"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

deno run --allow-all --env 5-configure-backend.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Backend configuration failed!"
    exit 1
fi

echo ""
read -p "Press ENTER to continue to Step 6..." -r
echo ""

# Step 6: Verify Deployment
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 6/6: Verifying Complete Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

deno run --allow-all --env 6-verify-deployment.ts

if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  Verification found issues!"
    echo "   Check output above for details."
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "📋 Deployment Summary:"
echo "   ✅ Smart contracts deployed"
echo "   ✅ Beacon tokens minted"
echo "   ✅ Lending pool initialized (1000 ADA)"
echo "   ✅ Backend configured"
echo "   ✅ All systems verified"
echo ""
echo "💡 Next Steps:"
echo ""
echo "   1. Start backend service:"
echo "      cd .."
echo "      deno task backend-v3"
echo ""
echo "   2. Run integration tests:"
echo "      deno task deposit-v3 100"
echo "      deno task borrow-v3 <receipt> 70"
echo "      deno task repay-v3 <receipt> 70"
echo "      deno task withdraw-v3 <receipt>"
echo ""
echo "   3. View deployment log:"
echo "      cat deployment-$(date +%Y%m%d).log"
echo ""
echo "═══════════════════════════════════════════════════════"
