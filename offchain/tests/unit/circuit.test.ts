/**
 * Tests for ZK Circuit Integration with V3
 *
 * This test verifies:
 * 1. Our lib/crypto.ts commitment generation works with the circuit
 * 2. Proof generation succeeds with snarkjs
 * 3. Proof verification works
 * 4. Circuit correctly validates collateral sufficiency
 *
 * Run with: deno test --allow-read --allow-write --allow-env --allow-run tests/circuit.test.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import { groth16 } from "snarkjs";
import {
    createCommitment,
    generateRandomSecret,
    initPoseidon,
    poseidonHash,
} from "../lib/crypto.ts";

// Test-specific config (avoid loading full config which requires env vars)
const MAX_LTV_RATIO = 80; // 80% LTV
const INTEREST_RATE_BPS = 500; // 5% APR

function calculateMaxLoan(collateralAmount: number): number {
    return Math.floor((collateralAmount * MAX_LTV_RATIO) / 100);
}

// Initialize Poseidon before tests
await initPoseidon();

// ============================================
// CIRCUIT PATHS (from config)
// ============================================

const CIRCUIT_WASM = "../../circuits/collateral_proof_js/collateral_proof.wasm";
const PROVING_KEY = "../../circuits/keys/collateral_proof_0000.zkey";
const VERIFICATION_KEY = "../../circuits/keys/verification_key.json";

// ============================================
// HELPER: Generate Proof
// ============================================

async function generateProof(
    collateralAmount: number,
    secret: string,
    loanAmount: number,
    collateralRatio: number,
): Promise<{ proof: any; publicSignals: string[] }> {
    // Create commitment (returns hex string)
    const commitmentHex = createCommitment(collateralAmount, secret);

    // Convert hex to decimal string (circuit expects decimal BigInt)
    const commitmentBigInt = BigInt("0x" + commitmentHex);
    const secretBigInt = BigInt("0x" + secret);

    // Prepare circuit inputs (all as decimal strings)
    const inputs = {
        commitment: commitmentBigInt.toString(),
        loan_amount: loanAmount.toString(),
        collateral_ratio: collateralRatio.toString(),
        secret: secretBigInt.toString(),
        collateral_amount: collateralAmount.toString(),
    };

    // Generate witness and proof
    const { proof, publicSignals } = await groth16.fullProve(
        inputs,
        CIRCUIT_WASM,
        PROVING_KEY,
    );

    return { proof, publicSignals };
}

// ============================================
// HELPER: Verify Proof
// ============================================

async function verifyProof(
    proof: any,
    publicSignals: string[],
): Promise<boolean> {
    // Load verification key
    const vkeyJson = await Deno.readTextFile(VERIFICATION_KEY);
    const vkey = JSON.parse(vkeyJson);

    // Verify proof
    return await groth16.verify(vkey, publicSignals, proof);
}

// ============================================
// TEST 1: Basic Commitment Verification
// ============================================

Deno.test("Circuit verifies commitment correctly", async () => {
    // Setup: 100 ADA collateral, 70 ADA loan, 125% collateral ratio (80% LTV)
    const collateralAmount = 100_000_000; // 100 ADA
    const secret = generateRandomSecret();
    const loanAmount = 70_000_000; // 70 ADA
    const collateralRatio = 125; // 125% = 80% LTV

    // Calculate expected commitment
    const expectedCommitmentHex = createCommitment(collateralAmount, secret);
    const expectedCommitmentDecimal = BigInt("0x" + expectedCommitmentHex).toString();

    // Generate proof
    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio,
    );

    // Verify proof
    const isValid = await verifyProof(proof, publicSignals);

    assertEquals(isValid, true, "Proof should be valid");

    // Check public signals match (public signals are in decimal format)
    assertEquals(
        publicSignals[0],
        expectedCommitmentDecimal,
        "Public commitment should match",
    );
    assertEquals(
        publicSignals[1],
        loanAmount.toString(),
        "Public loan amount should match",
    );
    assertEquals(
        publicSignals[2],
        collateralRatio.toString(),
        "Public collateral ratio should match",
    );

    console.log("✅ Circuit verified commitment successfully!");
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Loan: ${loanAmount / 1_000_000} ADA`);
    console.log(`   Ratio: ${collateralRatio}%`);
});

// ============================================
// TEST 2: V3 LTV Compatibility
// ============================================

Deno.test("Circuit works with V3 LTV ratio (80%)", async () => {
    // V3 uses 80% LTV, which means 125% collateral ratio
    const collateralAmount = 1000_000_000; // 1000 ADA
    const secret = generateRandomSecret();

    // Calculate max loan using V3 config (80% LTV)
    const maxLoan = calculateMaxLoan(collateralAmount); // Should be 800 ADA

    // For circuit, we need collateral ratio = 100 / LTV
    // 100 / 80 = 1.25 = 125%
    const collateralRatio = Math.floor(100 / (MAX_LTV_RATIO / 100));

    console.log(`V3 Config: LTV=${MAX_LTV_RATIO}%, Ratio=${collateralRatio}%`);

    // Test with max loan (should pass)
    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        maxLoan,
        collateralRatio,
    );

    const isValid = await verifyProof(proof, publicSignals);
    assertEquals(isValid, true, "Proof should be valid for max loan");

    console.log("✅ V3 LTV ratio (80%) works correctly!");
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Max Loan: ${maxLoan / 1_000_000} ADA`);
});

// ============================================
// TEST 3: Circuit Rejects Insufficient Collateral
// ============================================

Deno.test("Circuit rejects insufficient collateral", async () => {
    // Setup: 100 ADA collateral, but requesting 90 ADA loan (90% LTV)
    // With 125% ratio (80% LTV), max loan should be 80 ADA
    const collateralAmount = 100_000_000; // 100 ADA
    const secret = generateRandomSecret();
    const loanAmount = 90_000_000; // 90 ADA (too much!)
    const collateralRatio = 125;

    // This should fail during proof generation (circuit constraint violation)
    try {
        await generateProof(collateralAmount, secret, loanAmount, collateralRatio);
        throw new Error("Should have thrown due to constraint violation");
    } catch (error: any) {
        // Expected: Circuit should reject this input
        const errorMsg = error.message || error.toString();
        console.log(`✅ Circuit correctly rejected insufficient collateral`);
        console.log(`   Error: ${errorMsg.substring(0, 100)}...`);

        // Proof generation should fail due to unsatisfied constraint
        assertEquals(
            errorMsg.includes("Error") || errorMsg.includes("assert"),
            true,
            "Should fail with constraint error",
        );
    }
});

// ============================================
// TEST 4: Realistic V3 Scenario
// ============================================

Deno.test("Full V3 scenario: 1500 ADA collateral, 1200 ADA loan", async () => {
    // Realistic scenario from V3 design
    const collateralAmount = 1500_000_000; // 1500 ADA
    const secret = generateRandomSecret();

    // User wants to borrow 1200 ADA
    const requestedLoan = 1200_000_000; // 1200 ADA

    // V3 max LTV = 80%, so max loan = 1500 * 0.8 = 1200 ADA
    const maxLoan = calculateMaxLoan(collateralAmount);
    assertEquals(maxLoan, requestedLoan, "Max loan should be 1200 ADA");

    // Circuit collateral ratio for 80% LTV
    const collateralRatio = 125;

    // Generate and verify proof
    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        requestedLoan,
        collateralRatio,
    );

    const isValid = await verifyProof(proof, publicSignals);
    assertEquals(isValid, true, "Proof should be valid");

    // Calculate interest (5% APR from config)
    const interest = Math.floor((requestedLoan * INTEREST_RATE_BPS) / 10000);
    const repaymentAmount = requestedLoan + interest;

    console.log("✅ Full V3 scenario verified!");
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Loan: ${requestedLoan / 1_000_000} ADA`);
    console.log(`   Interest: ${interest / 1_000_000} ADA (${INTEREST_RATE_BPS / 100}%)`);
    console.log(`   Repayment: ${repaymentAmount / 1_000_000} ADA`);
    console.log(`   LTV: ${MAX_LTV_RATIO}%`);
});

// ============================================
// TEST 5: Deterministic Proofs
// ============================================

Deno.test("Same inputs produce valid proofs consistently", async () => {
    const collateralAmount = 500_000_000;
    const secret = "0abc123456789abcdef0123456789abcdef0123456789abcdef0123456789abc";
    const loanAmount = 400_000_000;
    const collateralRatio = 125;

    // Generate first proof
    const { proof: proof1, publicSignals: signals1 } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio,
    );

    // Generate second proof with same inputs
    const { proof: proof2, publicSignals: signals2 } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio,
    );

    // Public signals should be identical
    assertEquals(signals1, signals2, "Public signals should be identical");

    // Both proofs should verify
    const isValid1 = await verifyProof(proof1, signals1);
    const isValid2 = await verifyProof(proof2, signals2);

    assertEquals(isValid1, true, "First proof should be valid");
    assertEquals(isValid2, true, "Second proof should be valid");

    console.log("✅ Deterministic proof generation works!");
});

// ============================================
// TEST 6: Integration Test
// ============================================

Deno.test("Integration: crypto.ts + circuit workflow", async () => {
    console.log("\n=== V3 INTEGRATION TEST ===\n");

    // Step 1: User generates secret
    const secret = generateRandomSecret();
    console.log("1. Generated secret:", secret.substring(0, 16) + "...");

    // Step 2: User creates commitment
    const collateralAmount = 2000_000_000; // 2000 ADA
    const commitment = createCommitment(collateralAmount, secret);
    console.log("2. Created commitment:", commitment.substring(0, 16) + "...");

    // Step 3: User deposits collateral onchain (commitment stored in datum)
    console.log(`3. Deposit ${collateralAmount / 1_000_000} ADA with commitment`);

    // Step 4: User wants to borrow
    const loanAmount = 1600_000_000; // 1600 ADA (80% LTV)
    console.log(`4. Request ${loanAmount / 1_000_000} ADA loan`);

    // Step 5: Generate ZK proof
    const collateralRatio = 125; // 80% LTV
    const { proof, publicSignals } = await generateProof(
        collateralAmount,
        secret,
        loanAmount,
        collateralRatio,
    );
    console.log("5. Generated ZK proof");

    // Step 6: Verify proof (backend does this)
    const isValid = await verifyProof(proof, publicSignals);
    assertEquals(isValid, true, "Proof must be valid");
    console.log("6. Proof verified successfully!");

    // Step 7: Backend can now safely disburse loan
    console.log(
        `7. Backend disburses ${loanAmount / 1_000_000} ADA to user anonymously`,
    );

    console.log("\n✅ INTEGRATION TEST PASSED!\n");
});
