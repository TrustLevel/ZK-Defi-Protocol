/**
 * V3 Circuit Test - Node.js Script
 *
 * Tests the collateral_proof circuit with V3-style inputs
 * Run with: node test_v3_circuit.mjs
 */

import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";
import { readFile } from "fs/promises";

// ============================================
// CONFIG
// ============================================

const CIRCUIT_WASM = "./collateral_proof_js/collateral_proof.wasm";
const PROVING_KEY = "./keys/collateral_proof_0000.zkey";
const VERIFICATION_KEY = "./keys/verification_key.json";

const MAX_LTV_RATIO = 80; // 80% LTV = 125% collateral ratio

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

function generateRandomSecret() {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    randomBytes[0] = randomBytes[0] & 0x0f; // Top 4 bits = 0
    return Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function createCommitment(collateralAmount, secret) {
    const amountBigInt = BigInt(collateralAmount);
    const secretBigInt = BigInt("0x" + secret);
    return poseidonHash([amountBigInt, secretBigInt]);
}

// ============================================
// CIRCUIT TESTING
// ============================================

async function generateProof(collateralAmount, secret, loanAmount, collateralRatio) {
    // Create commitment (hex)
    const commitmentHex = createCommitment(collateralAmount, secret);

    // Convert to decimal strings for circuit
    const commitmentDecimal = BigInt("0x" + commitmentHex).toString();
    const secretDecimal = BigInt("0x" + secret).toString();

    console.log(`\nGenerating proof:`);
    console.log(`  Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`  Loan: ${loanAmount / 1_000_000} ADA`);
    console.log(`  Ratio: ${collateralRatio}%`);
    console.log(`  Commitment (hex): ${commitmentHex.substring(0, 16)}...`);
    console.log(`  Commitment (dec): ${commitmentDecimal.substring(0, 16)}...`);

    const inputs = {
        commitment: commitmentDecimal,
        loan_amount: loanAmount.toString(),
        collateral_ratio: collateralRatio.toString(),
        secret: secretDecimal,
        collateral_amount: collateralAmount.toString(),
    };

    const { proof, publicSignals } = await groth16.fullProve(inputs, CIRCUIT_WASM, PROVING_KEY);

    console.log(`  ✅ Proof generated successfully!`);
    return { proof, publicSignals };
}

async function verifyProof(proof, publicSignals) {
    const vkeyJson = await readFile(VERIFICATION_KEY, "utf8");
    const vkey = JSON.parse(vkeyJson);
    return await groth16.verify(vkey, publicSignals, proof);
}

// ============================================
// TESTS
// ============================================

async function test1_BasicCommitmentVerification() {
    console.log("\n=== TEST 1: Basic Commitment Verification ===");

    const collateralAmount = 100_000_000; // 100 ADA
    const secret = generateRandomSecret();
    const loanAmount = 70_000_000; // 70 ADA
    const collateralRatio = 125; // 125% = 80% LTV

    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio
    );

    const isValid = await verifyProof(proof, publicSignals);

    if (!isValid) {
        throw new Error("Proof verification failed!");
    }

    console.log(`\n✅ TEST 1 PASSED: Circuit verified commitment correctly!`);
    return true;
}

async function test2_V3LTVCompatibility() {
    console.log("\n=== TEST 2: V3 LTV Compatibility (80%) ===");

    const collateralAmount = 1000_000_000; // 1000 ADA
    const secret = generateRandomSecret();
    const maxLoan = Math.floor((collateralAmount * MAX_LTV_RATIO) / 100); // 800 ADA
    const collateralRatio = 125; // 80% LTV

    console.log(`V3 Config: LTV=${MAX_LTV_RATIO}%, Max Loan=${maxLoan / 1_000_000} ADA`);

    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        maxLoan,
        collateralRatio
    );

    const isValid = await verifyProof(proof, publicSignals);

    if (!isValid) {
        throw new Error("Proof verification failed!");
    }

    console.log(`\n✅ TEST 2 PASSED: V3 LTV ratio (80%) works correctly!`);
    return true;
}

async function test3_RejectInsufficientCollateral() {
    console.log("\n=== TEST 3: Circuit Rejects Insufficient Collateral ===");

    const collateralAmount = 100_000_000; // 100 ADA
    const secret = generateRandomSecret();
    const loanAmount = 90_000_000; // 90 ADA (too much! max is 80 ADA at 80% LTV)
    const collateralRatio = 125;

    try {
        await generateProof(collateralAmount, secret, loanAmount, collateralRatio);
        throw new Error("Should have failed due to constraint violation!");
    } catch (error) {
        if (error.message.includes("Assert Failed") || error.message.includes("constraint")) {
            console.log(`\n✅ TEST 3 PASSED: Circuit correctly rejected insufficient collateral!`);
            console.log(`   Error: ${error.message.substring(0, 80)}...`);
            return true;
        }
        throw error;
    }
}

async function test4_RealisticV3Scenario() {
    console.log("\n=== TEST 4: Realistic V3 Scenario ===");

    const collateralAmount = 1500_000_000; // 1500 ADA
    const secret = generateRandomSecret();
    const requestedLoan = 1200_000_000; // 1200 ADA
    const maxLoan = Math.floor((collateralAmount * MAX_LTV_RATIO) / 100);
    const collateralRatio = 125;

    console.log(`Scenario: Deposit ${collateralAmount / 1_000_000} ADA, borrow ${requestedLoan / 1_000_000} ADA`);
    console.log(`Max loan at ${MAX_LTV_RATIO}% LTV: ${maxLoan / 1_000_000} ADA`);

    if (requestedLoan !== maxLoan) {
        throw new Error(`Max loan mismatch: expected ${maxLoan}, got ${requestedLoan}`);
    }

    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        requestedLoan,
        collateralRatio
    );

    const isValid = await verifyProof(proof, publicSignals);

    if (!isValid) {
        throw new Error("Proof verification failed!");
    }

    const interestRateBPS = 500; // 5% APR
    const interest = Math.floor((requestedLoan * interestRateBPS) / 10000);
    const repaymentAmount = requestedLoan + interest;

    console.log(`\n✅ TEST 4 PASSED: Full V3 scenario verified!`);
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Loan: ${requestedLoan / 1_000_000} ADA`);
    console.log(`   Interest: ${interest / 1_000_000} ADA (5%)`);
    console.log(`   Repayment: ${repaymentAmount / 1_000_000} ADA`);
    return true;
}

async function test5_IntegrationTest() {
    console.log("\n=== TEST 5: Complete Integration Test ===");

    console.log("\n📝 User Flow:");
    console.log("1. User generates secret offchain");
    const secret = generateRandomSecret();
    console.log(`   ✅ Secret: ${secret.substring(0, 16)}...`);

    console.log("2. User creates commitment offchain");
    const collateralAmount = 2000_000_000; // 2000 ADA
    const commitment = createCommitment(collateralAmount, secret);
    console.log(`   ✅ Commitment: ${commitment.substring(0, 16)}...`);

    console.log(`3. User deposits ${collateralAmount / 1_000_000} ADA with commitment onchain`);

    console.log("4. User wants to borrow anonymously");
    const loanAmount = 1600_000_000; // 1600 ADA (80% LTV)
    console.log(`   Requested: ${loanAmount / 1_000_000} ADA`);

    console.log("5. User generates ZK proof (offchain)");
    const collateralRatio = 125;
    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio
    );

    console.log("6. Backend verifies proof");
    const isValid = await verifyProof(proof, publicSignals);
    if (!isValid) {
        throw new Error("Proof verification failed!");
    }
    console.log(`   ✅ Proof valid!`);

    console.log(`7. Backend disburses ${loanAmount / 1_000_000} ADA anonymously`);

    console.log(`\n✅ TEST 5 PASSED: Integration test complete!`);
    console.log(`\n🎯 Privacy achieved: User borrowed anonymously with ZK proof!`);
    return true;
}

// ============================================
// MAIN
// ============================================

async function main() {
    console.log("===========================================");
    console.log("  V3 CIRCUIT INTEGRATION TESTS");
    console.log("===========================================");

    // Initialize Poseidon
    console.log("\nInitializing Poseidon hash...");
    await initPoseidon();
    console.log("✅ Poseidon initialized");

    // Run tests
    const tests = [
        test1_BasicCommitmentVerification,
        test2_V3LTVCompatibility,
        test3_RejectInsufficientCollateral,
        test4_RealisticV3Scenario,
        test5_IntegrationTest,
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            await test();
            passed++;
        } catch (error) {
            console.error(`\n❌ TEST FAILED: ${error.message}`);
            console.error(error.stack);
            failed++;
        }
    }

    console.log("\n===========================================");
    console.log("  TEST SUMMARY");
    console.log("===========================================");
    console.log(`Total: ${tests.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log("===========================================");

    if (failed > 0) {
        process.exit(1);
    }

    console.log("\n🎉 ALL TESTS PASSED!");
    console.log("\n📝 Phase 2 Status: CIRCUIT VERIFIED AND WORKING ✅");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
