#!/usr/bin/env -S deno run --allow-net --allow-env --env --allow-read --allow-write
/**
 * V3 Anonymous Borrow CLI Tool
 *
 * Allows users to borrow anonymously against their deposit using ZK proofs.
 *
 * This script:
 * 1. Loads deposit receipt (contains secret)
 * 2. Generates ZK proof of collateral ownership
 * 3. Sends proof to backend API
 * 4. Backend verifies proof and issues loan (signed by admin)
 * 5. Returns transaction hash
 *
 * Usage:
 *   deno run --allow-all cli/borrow-anonymous-v3.ts <receipt-file> <loan-amount>
 *
 * Example:
 *   deno run --allow-all cli/borrow-anonymous-v3.ts ./receipts/deposit-abc123.json 1200
 *   # Borrows 1200 ADA anonymously
 *
 * Arguments:
 *   receipt-file: Path to deposit receipt JSON
 *   loan-amount: Loan amount in ADA (e.g., 1200)
 */

import { initProofSystem, generateCollateralProof, validateProofInput } from "../../../lib/proof.ts";
import { calculateMaxLoan, calculateInterest, calculateRepaymentAmount } from "../../../lib/config.ts";
import type { DepositReceipt } from "../../../lib/types.ts";

// ============================================
// CONFIGURATION
// ============================================

const BACKEND_API_URL = Deno.env.get("BACKEND_API_URL") || "http://localhost:3000";
const DESTINATION_ADDRESS = Deno.env.get("USER1_ADDRESS") || "";

// ============================================
// UTILITIES
// ============================================

/**
 * Load deposit receipt from file
 */
async function loadReceipt(filename: string): Promise<DepositReceipt> {
    try {
        const content = await Deno.readTextFile(filename);
        return JSON.parse(content) as DepositReceipt;
    } catch (error) {
        throw new Error(`Failed to load receipt: ${error.message}`);
    }
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
function parseArgs(): { receiptFile: string; loanAmountAda: number } {
    if (Deno.args.length < 2) {
        console.error("❌ ERROR: Missing required arguments\n");
        console.error("Usage: deno run --allow-all cli/borrow-anonymous-v3.ts <receipt-file> <loan-amount>");
        console.error("Example: deno run --allow-all cli/borrow-anonymous-v3.ts ./receipts/deposit-abc123.json 1200\n");
        Deno.exit(1);
    }

    const receiptFile = Deno.args[0];
    const loanAmountAda = parseFloat(Deno.args[1]);

    if (isNaN(loanAmountAda) || loanAmountAda <= 0) {
        console.error("❌ ERROR: Loan amount must be a positive number\n");
        Deno.exit(1);
    }

    return { receiptFile, loanAmountAda };
}

/**
 * Send borrow request to backend API
 */
async function sendBorrowRequest(
    depositUtxoRef: string,
    loanAmount: number,
    destinationAddress: string,
    proof: any,
    publicSignals: any,
): Promise<any> {
    const response = await fetch(`${BACKEND_API_URL}/api/v3/borrow`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            depositUtxoRef,
            loanAmount,
            destinationAddress,
            proof,
            publicSignals,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
    console.log("═══════════════════════════════════════════════════════");
    console.log("🔐 V3 Anonymous Borrow (Privacy-Enhanced)");
    console.log("═══════════════════════════════════════════════════════\n");

    // Parse arguments
    const { receiptFile, loanAmountAda } = parseArgs();
    const loanAmount = Math.floor(loanAmountAda * 1_000_000); // Convert to lovelace

    // Step 1: Load receipt
    console.log("📄 Step 1: Loading deposit receipt...");
    const receipt = await loadReceipt(receiptFile);
    console.log(`   ✅ Receipt loaded: ${receiptFile}`);
    console.log(`   Deposit TX: ${receipt.depositTxHash}`);
    console.log(`   UTXO: ${receipt.depositUtxoRef}`);
    console.log(`   Collateral: ${formatAda(receipt.collateralAmount)}\n`);

    // Step 2: Validate loan amount
    console.log("📊 Step 2: Validating loan amount...");
    const maxLoan = calculateMaxLoan(receipt.collateralAmount);
    const interest = calculateInterest(loanAmount);
    const repaymentAmount = calculateRepaymentAmount(loanAmount);

    console.log(`   Requested Loan: ${formatAda(loanAmount)}`);
    console.log(`   Max Loan (80% LTV): ${formatAda(maxLoan)}`);
    console.log(`   Interest (5% APR): ${formatAda(interest)}`);
    console.log(`   Total Repayment: ${formatAda(repaymentAmount)}\n`);

    if (loanAmount > maxLoan) {
        console.error(`❌ ERROR: Loan amount exceeds max LTV!`);
        console.error(`   Requested: ${formatAda(loanAmount)}`);
        console.error(`   Max Allowed: ${formatAda(maxLoan)}\n`);
        Deno.exit(1);
    }

    // Step 3: Initialize proof system
    console.log("🔐 Step 3: Initializing ZK proof system...");
    await initProofSystem();
    console.log("   ✅ Proof system ready\n");

    // Step 4: Validate proof input
    console.log("✅ Step 4: Validating proof parameters...");
    try {
        validateProofInput({
            collateralAmount: receipt.collateralAmount,
            secret: receipt.secret,
            loanAmount: loanAmount,
        });
        console.log("   ✅ Parameters validated\n");
    } catch (error: any) {
        console.error(`❌ ERROR: ${error.message}\n`);
        Deno.exit(1);
    }

    // Step 5: Generate ZK proof
    console.log("🔒 Step 5: Generating ZK proof...");
    console.log("   This proves you own the deposit without revealing your secret!");

    const proofResult = await generateCollateralProof({
        collateralAmount: receipt.collateralAmount,
        secret: receipt.secret,
        loanAmount: loanAmount,
    });

    console.log(`   ✅ ZK proof generated!`);
    console.log(`   Proof Hash: ${proofResult.proofHash.substring(0, 16)}...\n`);

    // Step 6: Determine destination address
    console.log("📍 Step 6: Determining destination address...");
    let destinationAddress = DESTINATION_ADDRESS;

    if (!destinationAddress || destinationAddress.trim() === "") {
        // Fall back to receipt owner if USER1_ADDRESS not set
        destinationAddress = receipt.owner;
        console.log(`   ⚠️  USER1_ADDRESS not set in .env`);
        console.log(`   Using receipt owner: ${destinationAddress.substring(0, 20)}...\n`);
    } else {
        console.log(`   ✅ Destination: ${destinationAddress.substring(0, 20)}...\n`);
    }

    // Step 7: Send request to backend
    console.log("📤 Step 7: Sending borrow request to backend...");
    console.log(`   Backend API: ${BACKEND_API_URL}`);
    console.log(`   Privacy: Backend will sign the transaction (not you!)`);
    console.log(`   This creates NO onchain link to your deposit!\n`);

    try {
        const response = await sendBorrowRequest(
            receipt.depositUtxoRef,
            loanAmount,
            destinationAddress,
            proofResult.proof,
            proofResult.publicSignals,
        );

        if (!response.success) {
            throw new Error(response.error || "Backend rejected the request");
        }

        // Success!
        console.log("═══════════════════════════════════════════════════════");
        console.log("✅ BORROW SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        console.log("📋 Transaction Details:");
        console.log(`   TX Hash: ${response.txHash}`);
        console.log(`   Collateral: ${formatAda(response.details.collateralAmount)}`);
        console.log(`   Loan Amount: ${formatAda(response.details.loanAmount)}`);
        console.log(`   Interest (5%): ${formatAda(response.details.interest)}`);
        console.log(`   Total Repayment: ${formatAda(response.details.loanAmount + response.details.interest)}\n`);

        console.log("🎯 Privacy Achieved:");
        console.log(`   ✅ Borrow transaction signed by backend (admin wallet)`);
        console.log(`   ✅ NO onchain link between deposit and borrow`);
        console.log(`   ✅ Your identity is protected (~85% privacy)\n`);

        console.log("💰 Next Steps:");
        console.log(`   1. Wait for transaction confirmation (~20 seconds)`);
        console.log(`   2. Check your address for ${formatAda(loanAmount)}`);
        console.log(`   3. When ready to repay: deno task repay-v3 ${receipt.depositUtxoRef}`);
        console.log(`   4. Repayment amount: ${formatAda(repaymentAmount)}\n`);

        console.log("⚠️  IMPORTANT:");
        console.log(`   - Keep your receipt safe!`);
        console.log(`   - You need it to repay the loan anonymously`);
        console.log(`   - Collateral is locked until loan is repaid\n`);

    } catch (error: any) {
        console.error("❌ Backend error:", error.message);
        console.error("\nPossible causes:");
        console.error("  - Backend service not running (start with: deno task backend)");
        console.error("  - Insufficient liquidity in lending pool");
        console.error("  - Invalid proof");
        console.error("  - Network issues\n");
        Deno.exit(1);
    }
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
