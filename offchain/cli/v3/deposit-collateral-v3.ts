#!/usr/bin/env -S deno run --allow-net --allow-env --env --allow-read --allow-write
/**
 * V3 Deposit Collateral Script
 *
 * Creates a privacy-enhanced collateral deposit with ZK commitment.
 *
 * This script:
 * 1. Generates a random secret (252-bit for BN254 field)
 * 2. Creates a Poseidon commitment: commitment = Poseidon(amount, secret)
 * 3. Builds and submits deposit transaction
 * 4. Saves receipt with SECRET (CRITICAL - needed for anonymous borrowing!)
 *
 * Usage:
 *   deno run --allow-all cli/deposit-collateral-v3.ts <amount-in-ada>
 *
 * Example:
 *   deno run --allow-all cli/deposit-collateral-v3.ts 1500
 *   # Deposits 1500 ADA with ZK commitment
 *
 * Arguments:
 *   amount-in-ada: Collateral amount in ADA (e.g., 1500)
 *
 * Output:
 *   - Transaction hash printed to console
 *   - Receipt saved to: receipts/deposit-{txHash}.json
 *   - ⚠️  SAVE THE RECEIPT! Contains your secret needed for borrowing!
 */

import { Lucid, Blockfrost, Data, getAddressDetails } from "@lucid-evolution/lucid";
import {
    createCommitment,
    generateRandomSecret,
    initPoseidon,
    validateSecret,
} from "../../lib/crypto.ts";
import {
    DepositDatumSchema,
    type DepositReceipt,
} from "../../lib/types.ts";
import {
    NETWORK,
    BLOCKFROST_ENDPOINT,
    BLOCKFROST_API_KEY,
    LUCID_NETWORK,
    USER1_WALLET_SEED,
    COLLATERAL_V3_ADDRESS,
    MIN_COLLATERAL_ADA,
    calculateMaxLoan,
} from "../../lib/config.ts";

// ============================================
// CONSTANTS
// ============================================

const RECEIPTS_DIR = "./receipts";

// ============================================
// UTILITIES
// ============================================

/**
 * Ensure receipts directory exists
 */
async function ensureReceiptsDir(): Promise<void> {
    try {
        await Deno.mkdir(RECEIPTS_DIR, { recursive: true });
    } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
            throw error;
        }
    }
}

/**
 * Save deposit receipt to file
 */
async function saveReceipt(receipt: DepositReceipt): Promise<string> {
    await ensureReceiptsDir();
    const filename = `${RECEIPTS_DIR}/deposit-${receipt.depositTxHash}.json`;
    await Deno.writeTextFile(filename, JSON.stringify(receipt, null, 2));
    return filename;
}

/**
 * Format lovelace to ADA
 */
function formatAda(lovelace: number | bigint): string {
    const ada = Number(lovelace) / 1_000_000;
    return `${ada.toLocaleString()} ADA`;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { amountAda: number } {
    if (Deno.args.length < 1) {
        console.error("❌ ERROR: Missing required argument\n");
        console.error("Usage: deno run --allow-all cli/deposit-collateral-v3.ts <amount-in-ada>");
        console.error("Example: deno run --allow-all cli/deposit-collateral-v3.ts 1500\n");
        Deno.exit(1);
    }

    const amountAda = parseFloat(Deno.args[0]);
    if (isNaN(amountAda) || amountAda <= 0) {
        console.error("❌ ERROR: Amount must be a positive number\n");
        Deno.exit(1);
    }

    return { amountAda };
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
    console.log("═══════════════════════════════════════════════════════");
    console.log("🏦 V3 Deposit Collateral (Privacy-Enhanced)");
    console.log("═══════════════════════════════════════════════════════\n");

    // Parse arguments
    const { amountAda } = parseArgs();
    const collateralAmount = Math.floor(amountAda * 1_000_000); // Convert to lovelace

    console.log(`📊 Deposit Details:`);
    console.log(`   Amount: ${formatAda(collateralAmount)}`);
    console.log(`   Network: ${NETWORK}`);
    console.log(`   Min Collateral: ${formatAda(MIN_COLLATERAL_ADA)}\n`);

    // Validate amount
    if (collateralAmount < MIN_COLLATERAL_ADA) {
        console.error(`❌ ERROR: Amount must be at least ${formatAda(MIN_COLLATERAL_ADA)}\n`);
        Deno.exit(1);
    }

    // Initialize Poseidon hash
    console.log("🔐 Initializing cryptography...");
    await initPoseidon();
    console.log("   ✅ Poseidon hash initialized\n");

    // Step 1: Generate secret
    console.log("🎲 Step 1: Generating random secret...");
    const secret = generateRandomSecret();

    // Validate secret
    if (!validateSecret(secret)) {
        throw new Error("Generated secret is invalid!");
    }

    console.log(`   ✅ Secret: ${secret.substring(0, 16)}...${secret.substring(48)}`);
    console.log(`   ⚠️  SAVE THIS SECRET! You need it for anonymous borrowing!\n`);

    // Step 2: Create commitment
    console.log("🔒 Step 2: Creating Poseidon commitment...");
    const commitment = createCommitment(collateralAmount, secret);
    console.log(`   ✅ Commitment: ${commitment.substring(0, 16)}...${commitment.substring(48)}`);
    console.log(`   Formula: Poseidon(${collateralAmount}, secret)\n`);

    // Step 3: Calculate max loan
    const maxLoan = calculateMaxLoan(collateralAmount);
    console.log(`💰 Borrowing Power:`);
    console.log(`   Max Loan (80% LTV): ${formatAda(maxLoan)}\n`);

    // Step 4: Initialize Lucid
    console.log("🌐 Step 3: Connecting to Cardano network...");
    const lucid = await Lucid(
        new Blockfrost(
            BLOCKFROST_ENDPOINT,
            BLOCKFROST_API_KEY
        ),
        LUCID_NETWORK
    );
    console.log("   ✅ Connected to network\n");

    // Step 5: Load wallet
    console.log("👛 Step 4: Loading wallet...");
    lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    const userAddress = await lucid.wallet().address();
    console.log(`   ✅ Address: ${userAddress.substring(0, 20)}...${userAddress.substring(userAddress.length - 10)}\n`);

    // Get user payment credential (owner)
    const userDetails = getAddressDetails(userAddress);
    const ownerPubKeyHash = userDetails.paymentCredential?.hash;

    if (!ownerPubKeyHash) {
        throw new Error("Failed to extract payment credential from address");
    }

    // Step 6: Build datum
    console.log("📝 Step 5: Building deposit datum...");
    const timestamp = Date.now();
    const datum = Data.to({
        owner: ownerPubKeyHash,
        collateral_amount: BigInt(collateralAmount),
        commitment: commitment,
        deposited_at: BigInt(timestamp),
    }, DepositDatumSchema);
    console.log(`   ✅ Datum created with timestamp: ${new Date(timestamp).toISOString()}\n`);

    // Step 7: Build transaction
    console.log("🔨 Step 6: Building transaction...");

    // Validate addresses
    if (!COLLATERAL_V3_ADDRESS) {
        throw new Error("COLLATERAL_V3_ADDRESS not set in config! Please deploy contracts first.");
    }

    const tx = await lucid
        .newTx()
        .pay.ToContract(
            COLLATERAL_V3_ADDRESS,
            { kind: "inline", value: datum },
            {
                lovelace: BigInt(collateralAmount),
            }
        )
        .complete();

    console.log("   ✅ Transaction built\n");

    // Step 8: Sign transaction
    console.log("✍️  Step 7: Signing transaction...");
    const signedTx = await tx.sign.withWallet().complete();
    const txHash = signedTx.toHash();
    console.log(`   ✅ Transaction signed`);
    console.log(`   📋 TX Hash: ${txHash}`);

    // Show tx details
    const txJson = signedTx.toJSON();
    const txFee = parseInt(txJson.body.fee) / 1_000_000;
    const txSize = signedTx.toCBOR().length / 2048;
    console.log(`   💸 Fee: ${txFee.toFixed(6)} ADA`);
    console.log(`   📦 Size: ${txSize.toFixed(2)} KB\n`);

    // Step 9: Submit transaction
    console.log("📤 Step 8: Submitting transaction to blockchain...");
    await signedTx.submit();
    console.log(`   ✅ Transaction submitted!\n`);

    // Step 10: Create and save receipt
    console.log("💾 Step 9: Creating deposit receipt...");
    const depositUtxoRef = `${txHash}#0`; // First output is deposit

    const receipt: DepositReceipt = {
        depositTxHash: txHash,
        depositUtxoRef: depositUtxoRef,
        collateralAmount: collateralAmount,
        secret: secret,
        commitment: commitment,
        owner: userAddress,
        timestamp: timestamp,
    };

    const receiptFile = await saveReceipt(receipt);
    console.log(`   ✅ Receipt saved: ${receiptFile}\n`);

    // Summary
    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ DEPOSIT SUCCESSFUL!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("📋 Summary:");
    console.log(`   TX Hash: ${txHash}`);
    console.log(`   UTXO Ref: ${depositUtxoRef}`);
    console.log(`   Collateral: ${formatAda(collateralAmount)}`);
    console.log(`   Max Loan: ${formatAda(maxLoan)} (80% LTV)`);
    console.log(`   Receipt: ${receiptFile}\n`);
    console.log("⚠️  IMPORTANT:");
    console.log("   - Your deposit is now locked with a ZK commitment");
    console.log("   - SAVE YOUR RECEIPT! You need it for anonymous borrowing");
    console.log("   - Your secret is: " + secret);
    console.log("   - Without the secret, you CANNOT borrow anonymously!\n");
    console.log("🔗 Next Steps:");
    console.log("   1. Wait for transaction confirmation (~20 seconds)");
    console.log("   2. Use 'borrow-anonymous-v3' to borrow against this deposit");
    console.log("   3. Keep your receipt safe!\n");
}

// ============================================
// RUN
// ============================================

main().catch((error) => {
    console.error("\n❌ ERROR:", error.message);
    console.error("\nStack trace:");
    console.error(error.stack);
    Deno.exit(1);
});
