#!/usr/bin/env node
/**
 * V3 Anonymous Borrow - Node.js Script
 *
 * Borrows anonymously against collateral deposit using ZK proofs.
 * This script runs in Node.js to avoid Deno/snarkjs Web Worker incompatibility.
 *
 * Usage:
 *   node borrow-v3-node.mjs <receipt-file> <loan-amount-ada> <destination-address>
 *
 * Example:
 *   node borrow-v3-node.mjs ./receipts/deposit-abc123.json 70 addr_test1qz...
 *
 * Arguments:
 *   receipt-file: Path to deposit receipt JSON (contains secret)
 *   loan-amount-ada: Loan amount in ADA (e.g., 70)
 *   destination-address: Fresh Cardano address to receive loan (REQUIRED for privacy!)
 *
 * ⚠️  PRIVACY WARNING:
 *   Use a FRESH wallet address that has NO connection to your deposit address!
 *   If you use your original wallet, your deposit and loan will be publicly linked.
 *
 * Requirements:
 *   - Node.js v18+
 *   - npm packages: circomlibjs, snarkjs
 */

import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";
import { readFile } from "fs/promises";

// ============================================
// CONFIGURATION
// ============================================

const CIRCUIT_WASM = "../circuits/collateral_proof_js/collateral_proof.wasm";
const PROVING_KEY = "../circuits/keys/collateral_proof_0000.zkey";

const BACKEND_API_URL = process.env.BACKEND_API_URL || "http://localhost:3000";
const MAX_LTV_RATIO = 80; // 80% LTV = 125% collateral ratio
const COLLATERAL_RATIO = 125; // 125% = 80% LTV

// ============================================
// CRYPTO UTILITIES
// ============================================

let poseidonInstance = null;

async function initPoseidon() {
    if (!poseidonInstance) {
        poseidonInstance = await buildPoseidon();
    }
}

function poseidonHash(inputs) {
    if (!poseidonInstance) {
        throw new Error("Poseidon not initialized");
    }
    const hash = poseidonInstance.F.toString(poseidonInstance(inputs));
    return BigInt(hash).toString(16).padStart(64, "0");
}

function createCommitment(collateralAmount, secret) {
    const amountBigInt = BigInt(collateralAmount);
    const secretBigInt = BigInt("0x" + secret);
    return poseidonHash([amountBigInt, secretBigInt]);
}

// ============================================
// ZK PROOF GENERATION
// ============================================

async function generateProof(collateralAmount, secret, loanAmount) {
    console.log(`\n🔐 Generating ZK proof:`);
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Loan: ${loanAmount / 1_000_000} ADA`);
    console.log(`   LTV Ratio: ${MAX_LTV_RATIO}%`);
    console.log(`   Collateral Ratio: ${COLLATERAL_RATIO}%`);

    // Create commitment (hex)
    const commitmentHex = createCommitment(collateralAmount, secret);

    // Convert to decimal strings for circuit
    const commitmentDecimal = BigInt("0x" + commitmentHex).toString();
    const secretDecimal = BigInt("0x" + secret).toString();

    const inputs = {
        commitment: commitmentDecimal,
        loan_amount: loanAmount.toString(),
        collateral_ratio: COLLATERAL_RATIO.toString(),
        secret: secretDecimal,
        collateral_amount: collateralAmount.toString(),
    };

    console.log(`   📊 Generating proof... (this takes ~25 seconds)`);
    const startTime = Date.now();

    const { proof, publicSignals } = await groth16.fullProve(inputs, CIRCUIT_WASM, PROVING_KEY);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Proof generated in ${duration}s`);

    return { proof, publicSignals };
}

// ============================================
// RECEIPT HANDLING
// ============================================

async function loadReceipt(filename) {
    try {
        const content = await readFile(filename, "utf8");
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to load receipt: ${error.message}`);
    }
}

// ============================================
// BACKEND API
// ============================================

async function submitBorrowRequest(depositUtxo, loanAmount, destinationAddress, proof, publicSignals) {
    const requestBody = {
        depositUtxoRef: depositUtxo,
        loanAmount: loanAmount,
        destinationAddress: destinationAddress,
        proof: proof,
        publicSignals: {
            commitment: publicSignals[0],
            loan_amount: publicSignals[1],
            collateral_ratio: publicSignals[2],
        },
    };

    console.log(`\n📤 Sending borrow request to backend...`);
    console.log(`   API: ${BACKEND_API_URL}/api/v3/borrow`);

    const response = await fetch(`${BACKEND_API_URL}/api/v3/borrow`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend request failed (${response.status}): ${errorText}`);
    }

    return await response.json();
}

// ============================================
// VALIDATION
// ============================================

function validateLoanAmount(collateralAmount, loanAmount) {
    const maxLoan = Math.floor((collateralAmount * MAX_LTV_RATIO) / 100);

    if (loanAmount > maxLoan) {
        throw new Error(
            `Loan amount ${loanAmount / 1_000_000} ADA exceeds max loan ${maxLoan / 1_000_000} ADA (${MAX_LTV_RATIO}% LTV)`
        );
    }

    if (loanAmount <= 0) {
        throw new Error("Loan amount must be greater than 0");
    }

    return maxLoan;
}

// ============================================
// MAIN
// ============================================

async function main() {
    console.log("═══════════════════════════════════════════════════════");
    console.log("🔐 V3 Anonymous Borrow (Node.js)");
    console.log("═══════════════════════════════════════════════════════\n");

    // Parse command line arguments
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error("❌ ERROR: Missing required arguments\n");
        console.log("Usage:");
        console.log("  node borrow-v3-node.mjs <receipt-file> <loan-amount-ada> <destination-address>\n");
        console.log("Example:");
        console.log("  node borrow-v3-node.mjs ./receipts/deposit-abc123.json 70 addr_test1qz...\n");
        console.log("⚠️  PRIVACY WARNING:");
        console.log("  Use a FRESH wallet address that has NO connection to your deposit!");
        console.log("  Using your original wallet will publicly link your deposit and loan.\n");
        process.exit(1);
    }

    const receiptFile = args[0];
    const loanAmountADA = parseFloat(args[1]);
    const destinationAddress = args[2];
    const loanAmount = Math.floor(loanAmountADA * 1_000_000); // Convert to lovelace

    if (isNaN(loanAmountADA) || loanAmountADA <= 0) {
        console.error("❌ ERROR: Invalid loan amount. Must be a positive number.\n");
        process.exit(1);
    }

    // Validate destination address format
    if (!destinationAddress || !destinationAddress.startsWith("addr")) {
        console.error("❌ ERROR: Invalid destination address format.\n");
        console.error("   Address must start with 'addr' (e.g., addr_test1qz...)\n");
        process.exit(1);
    }

    try {
        // Step 1: Load deposit receipt
        console.log("📄 Step 1: Loading deposit receipt...");
        const receipt = await loadReceipt(receiptFile);
        console.log(`   ✅ Receipt loaded: ${receiptFile}`);
        console.log(`   Deposit TX: ${receipt.depositTxHash}`);
        console.log(`   UTXO: ${receipt.depositUtxoRef}`);
        console.log(`   Collateral: ${receipt.collateralAmount / 1_000_000} ADA`);

        // Extract data from receipt
        const collateralAmount = receipt.collateralAmount; // Already in lovelace
        const secret = receipt.secret;
        const depositUtxo = receipt.depositUtxoRef;

        // Destination address is from command line argument (validated above)
        // ⚠️ Privacy note: This should be a FRESH wallet, not the deposit wallet!
        console.log(`\n🎯 Destination Address (where loan will be sent):`);
        console.log(`   ${destinationAddress}`);

        // Warning if destination looks like it might be the original wallet
        if (destinationAddress === receipt.owner) {
            console.log(`\n⚠️  WARNING: Destination address matches deposit owner!`);
            console.log(`   This reduces privacy. Consider using a fresh wallet.`);
        }

        // Step 2: Validate loan amount
        console.log("\n📊 Step 2: Validating loan amount...");
        const maxLoan = validateLoanAmount(collateralAmount, loanAmount);
        console.log(`   Requested Loan: ${loanAmount / 1_000_000} ADA`);
        console.log(`   Max Loan (${MAX_LTV_RATIO}% LTV): ${maxLoan / 1_000_000} ADA`);

        const interestRateBPS = 500; // 5% APR
        const interest = Math.floor((loanAmount * interestRateBPS) / 10000);
        const repaymentAmount = loanAmount + interest;

        console.log(`   Interest (5% APR): ${interest / 1_000_000} ADA`);
        console.log(`   Total Repayment: ${repaymentAmount / 1_000_000} ADA`);
        console.log(`   ✅ Loan amount valid`);

        // Step 3: Initialize ZK proof system
        console.log("\n🔐 Step 3: Initializing ZK proof system...");
        await initPoseidon();
        console.log("   ✅ Proof system initialized");

        // Step 4: Generate ZK proof
        console.log("\n🔒 Step 4: Generating ZK proof...");
        console.log("   This proves you own the deposit without revealing your secret!");

        const { proof, publicSignals } = await generateProof(collateralAmount, secret, loanAmount);

        // Step 5: Submit to backend
        console.log("\n📤 Step 5: Submitting borrow request to backend...");
        const result = await submitBorrowRequest(depositUtxo, loanAmount, destinationAddress, proof, publicSignals);

        console.log("   ✅ Transaction submitted!");

        // Display result
        console.log("\n═══════════════════════════════════════════════════════");
        console.log("✅ BORROW SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        console.log("📋 Summary:");
        console.log(`   TX Hash: ${result.txHash}`);
        console.log(`   Loan Amount: ${loanAmount / 1_000_000} ADA`);
        console.log(`   Interest (5% APR): ${interest / 1_000_000} ADA`);
        console.log(`   Total Repayment: ${repaymentAmount / 1_000_000} ADA`);
        console.log(`   Destination: ${destinationAddress.substring(0, 30)}...${destinationAddress.substring(destinationAddress.length - 10)}`);

        console.log("\n🔗 View on Explorer:");
        console.log(`   https://preprod.cardanoscan.io/transaction/${result.txHash}`);

        console.log("\n🔐 Privacy Notes:");
        console.log("   ✅ You borrowed anonymously using a ZK proof");
        console.log("   ✅ The blockchain doesn't reveal which deposit you used");
        console.log("   ✅ Transaction signed by backend (not your wallet)");
        if (destinationAddress !== receipt.owner) {
            console.log("   ✅ Loan sent to fresh wallet (good for privacy!)");
        } else {
            console.log("   ⚠️  Loan sent to deposit owner wallet (reduces privacy)");
        }

        console.log("\n⚠️  IMPORTANT:");
        console.log(`   - Remember to repay ${repaymentAmount / 1_000_000} ADA to unlock your collateral`);
        console.log("   - Keep your deposit receipt safe (needed for repayment)");

        console.log("\n🔗 Next Steps:");
        console.log("   1. Wait for transaction confirmation (~20 seconds)");
        console.log("   2. Check your wallet for the borrowed funds");
        console.log("   3. Use 'repay-anonymous-v3' when ready to repay");

    } catch (error) {
        console.error("\n❌ ERROR:", error.message);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
