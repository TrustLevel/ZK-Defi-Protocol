#!/usr/bin/env -S deno run --allow-net --allow-env --env --allow-read --allow-write
/**
 * V3 Anonymous Repay CLI Tool
 *
 * Allows users to repay their loan anonymously using ZK proofs.
 *
 * This script:
 * 1. Loads deposit receipt (contains secret and loan details)
 * 2. Calculates repayment amount (principal + interest)
 * 3. Generates ZK proof of collateral ownership
 * 4. Sends proof to backend API
 * 5. Backend verifies proof and unlocks deposit (signed by admin)
 * 6. Returns transaction hash
 *
 * Usage:
 *   deno run --allow-all cli/repay-anonymous-v3.ts <receipt-file>
 *
 * Example:
 *   deno run --allow-all cli/repay-anonymous-v3.ts ./receipts/deposit-abc123.json
 *   # Repays loan and unlocks collateral
 *
 * Arguments:
 *   receipt-file: Path to deposit receipt JSON
 *
 * Note: You must know the loan amount you borrowed.
 *       This should be saved or you can query the blockchain.
 */

import { initProofSystem, generateCollateralProof, validateProofInput } from "../lib/proof.ts";
import { calculateInterest, calculateRepaymentAmount } from "../lib/config.ts";
import type { DepositReceipt } from "../lib/types.ts";

// ============================================
// CONFIGURATION
// ============================================

const BACKEND_API_URL = Deno.env.get("BACKEND_API_URL") || "http://localhost:3000";

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
function parseArgs(): { receiptFile: string; loanAmountAda?: number } {
    if (Deno.args.length < 1) {
        console.error("❌ ERROR: Missing required argument\n");
        console.error("Usage: deno run --allow-all cli/repay-anonymous-v3.ts <receipt-file> [loan-amount]");
        console.error("Example: deno run --allow-all cli/repay-anonymous-v3.ts ./receipts/deposit-abc123.json 1200\n");
        console.error("If loan-amount is not provided, you'll be prompted to enter it.\n");
        Deno.exit(1);
    }

    const receiptFile = Deno.args[0];
    let loanAmountAda: number | undefined;

    if (Deno.args.length >= 2) {
        loanAmountAda = parseFloat(Deno.args[1]);
        if (isNaN(loanAmountAda) || loanAmountAda <= 0) {
            console.error("❌ ERROR: Loan amount must be a positive number\n");
            Deno.exit(1);
        }
    }

    return { receiptFile, loanAmountAda };
}

/**
 * Prompt user for loan amount
 */
async function promptLoanAmount(): Promise<number> {
    console.log("\n⚠️  Loan amount not provided as argument.");
    console.log("Please enter the loan amount you borrowed (in ADA):");
    console.log("(This should match the amount from your borrow transaction)\n");

    const input = prompt("Loan amount (ADA):");
    if (!input) {
        throw new Error("Loan amount is required");
    }

    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
        throw new Error("Invalid loan amount");
    }

    return amount;
}

/**
 * Send repay request to backend API
 */
async function sendRepayRequest(
    depositUtxoRef: string,
    repaymentAmount: number,
    proof: any,
    publicSignals: any,
): Promise<any> {
    const response = await fetch(`${BACKEND_API_URL}/api/v3/repay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            depositUtxoRef,
            repaymentAmount,
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
    console.log("🔐 V3 Anonymous Repay (Privacy-Enhanced)");
    console.log("═══════════════════════════════════════════════════════\n");

    // Parse arguments
    let { receiptFile, loanAmountAda } = parseArgs();

    // Step 1: Load receipt
    console.log("📄 Step 1: Loading deposit receipt...");
    const receipt = await loadReceipt(receiptFile);
    console.log(`   ✅ Receipt loaded: ${receiptFile}`);
    console.log(`   Deposit TX: ${receipt.depositTxHash}`);
    console.log(`   UTXO: ${receipt.depositUtxoRef}`);
    console.log(`   Collateral: ${formatAda(receipt.collateralAmount)}\n`);

    // Step 2: Get loan amount (from args or prompt)
    if (!loanAmountAda) {
        loanAmountAda = await promptLoanAmount();
    }

    const loanAmount = Math.floor(loanAmountAda * 1_000_000); // Convert to lovelace

    // Step 3: Calculate repayment
    console.log("📊 Step 2: Calculating repayment amount...");
    const interest = calculateInterest(loanAmount);
    const repaymentAmount = calculateRepaymentAmount(loanAmount);

    console.log(`   Loan Amount: ${formatAda(loanAmount)}`);
    console.log(`   Interest (5% APR): ${formatAda(interest)}`);
    console.log(`   Total Repayment: ${formatAda(repaymentAmount)}\n`);

    // Step 4: Initialize proof system
    console.log("🔐 Step 3: Initializing ZK proof system...");
    await initProofSystem();
    console.log("   ✅ Proof system ready\n");

    // Step 5: Validate proof input
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

    // Step 6: Generate ZK proof
    console.log("🔒 Step 5: Generating ZK proof...");
    console.log("   This proves you own the deposit without revealing your secret!");

    const proofResult = await generateCollateralProof({
        collateralAmount: receipt.collateralAmount,
        secret: receipt.secret,
        loanAmount: loanAmount,
    });

    console.log(`   ✅ ZK proof generated!`);
    console.log(`   Proof Hash: ${proofResult.proofHash.substring(0, 16)}...\n`);

    // Step 7: Send request to backend
    console.log("📤 Step 6: Sending repay request to backend...");
    console.log(`   Backend API: ${BACKEND_API_URL}`);
    console.log(`   Privacy: Backend will sign the transaction (not you!)`);
    console.log(`   This unlocks your deposit anonymously!\n`);

    try {
        const response = await sendRepayRequest(
            receipt.depositUtxoRef,
            repaymentAmount,
            proofResult.proof,
            proofResult.publicSignals,
        );

        if (!response.success) {
            throw new Error(response.error || "Backend rejected the request");
        }

        // Success!
        console.log("═══════════════════════════════════════════════════════");
        console.log("✅ REPAYMENT SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        console.log("📋 Transaction Details:");
        console.log(`   TX Hash: ${response.txHash}`);
        console.log(`   Collateral: ${formatAda(response.details.collateralAmount)}`);
        console.log(`   Loan Amount: ${formatAda(response.details.loanAmount)}`);
        console.log(`   Interest (5%): ${formatAda(response.details.interest)}`);
        console.log(`   Total Repaid: ${formatAda(response.details.repaymentAmount)}`);
        console.log(`   Deposit Unlocked: ${response.details.depositUnlocked ? "✅ YES" : "❌ NO"}\n`);

        console.log("🎯 Privacy Achieved:");
        console.log(`   ✅ Repay transaction signed by backend (admin wallet)`);
        console.log(`   ✅ NO onchain link between borrower and repayment`);
        console.log(`   ✅ Your identity is protected (~65% privacy)\n`);

        console.log("💰 Next Steps:");
        console.log(`   1. Wait for transaction confirmation (~20 seconds)`);
        console.log(`   2. Your collateral is now unlocked!`);
        console.log(`   3. Withdraw your ${formatAda(receipt.collateralAmount)}:`);
        console.log(`      deno task withdraw-v3 ${receipt.depositUtxoRef}`);
        console.log(`   4. Congratulations! Loan cycle complete! 🎉\n`);

        console.log("⚠️  IMPORTANT:");
        console.log(`   - You can now safely withdraw your collateral`);
        console.log(`   - Loan is fully repaid and closed`);
        console.log(`   - Pool liquidity has been restored\n`);

    } catch (error: any) {
        console.error("❌ Backend error:", error.message);
        console.error("\nPossible causes:");
        console.error("  - Backend service not running (start with: deno task backend-v3)");
        console.error("  - Insufficient repayment amount");
        console.error("  - Invalid proof");
        console.error("  - Deposit already unlocked");
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
