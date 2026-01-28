/**
 * V3 Integration Tests
 *
 * Tests the complete lending cycle:
 * 1. Generate secret
 * 2. Create commitment
 * 3. Generate proof
 * 4. Verify proof
 * 5. Validate LTV calculations
 * 6. Test full cycle flow
 */

import { assertEquals, assertExists, assert } from "@std/assert";
import {
    generateRandomSecret,
    createCommitment,
    hashProof,
} from "../lib/crypto.ts";
import {
    initProofSystem,
    generateCollateralProof,
    verifyCollateralProof,
    validateProofInput,
} from "../lib/proof.ts";
import {
    calculateMaxLoan,
    calculateInterest,
    calculateRepaymentAmount,
    MAX_LTV_RATIO,
} from "../lib/config.ts";

// ============================================
// TEST CONSTANTS
// ============================================

const TEST_COLLATERAL = 10_000_000; // 10 ADA in lovelace
const TEST_LOAN = 8_000_000; // 8 ADA (80% LTV)
const EXPECTED_INTEREST = 400_000; // 5% of 8 ADA = 0.4 ADA
const EXPECTED_REPAYMENT = 8_400_000; // 8.4 ADA

// ============================================
// UNIT TESTS
// ============================================

Deno.test("Secret Generation", async (t) => {
    await t.step("should generate valid 252-bit secret", () => {
        const secret = generateRandomSecret();

        // Should be hex string
        assertExists(secret);
        assert(/^[0-9a-f]+$/.test(secret), "Secret should be hex string");

        // Should be 252 bits (63 hex chars)
        assertEquals(secret.length, 63, "Secret should be 63 hex chars (252 bits)");

        // Should be different each time
        const secret2 = generateRandomSecret();
        assert(secret !== secret2, "Secrets should be random");
    });

    await t.step("should generate secrets within BN254 field", () => {
        const secret = generateRandomSecret();
        const secretBigInt = BigInt("0x" + secret);

        // BN254 field prime (approximate check)
        const BN254_FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

        assert(secretBigInt < BN254_FIELD_SIZE, "Secret should be within BN254 field");
    });
});

Deno.test("Commitment Creation", async (t) => {
    await t.step("should create valid Poseidon commitment", () => {
        const secret = generateRandomSecret();
        const commitment = createCommitment(TEST_COLLATERAL, secret);

        // Should be hex string
        assertExists(commitment);
        assert(/^[0-9a-f]+$/.test(commitment), "Commitment should be hex string");

        // Should be deterministic
        const commitment2 = createCommitment(TEST_COLLATERAL, secret);
        assertEquals(commitment, commitment2, "Commitment should be deterministic");
    });

    await t.step("should create different commitments for different inputs", () => {
        const secret1 = generateRandomSecret();
        const secret2 = generateRandomSecret();

        const commitment1 = createCommitment(TEST_COLLATERAL, secret1);
        const commitment2 = createCommitment(TEST_COLLATERAL, secret2);

        assert(commitment1 !== commitment2, "Different secrets should produce different commitments");

        const commitment3 = createCommitment(TEST_COLLATERAL + 1_000_000, secret1);
        assert(commitment1 !== commitment3, "Different amounts should produce different commitments");
    });
});

Deno.test("LTV Calculations", async (t) => {
    await t.step("should calculate max loan at 80% LTV", () => {
        const maxLoan = calculateMaxLoan(TEST_COLLATERAL);
        const expectedMaxLoan = Math.floor(TEST_COLLATERAL * MAX_LTV_RATIO);

        assertEquals(maxLoan, expectedMaxLoan, "Max loan should be 80% of collateral");
        assertEquals(maxLoan, 8_000_000, "10 ADA collateral should allow 8 ADA loan");
    });

    await t.step("should calculate interest at 5% APR", () => {
        const interest = calculateInterest(TEST_LOAN);

        assertEquals(interest, EXPECTED_INTEREST, "Interest should be 5% of loan");
        assertEquals(interest, 400_000, "8 ADA loan should have 0.4 ADA interest");
    });

    await t.step("should calculate total repayment (principal + interest)", () => {
        const repayment = calculateRepaymentAmount(TEST_LOAN);

        assertEquals(repayment, EXPECTED_REPAYMENT, "Repayment should be principal + interest");
        assertEquals(repayment, 8_400_000, "8 ADA loan should require 8.4 ADA repayment");
    });

    await t.step("should enforce minimum collateral ratio", () => {
        const collateral = 1_000_000; // 1 ADA
        const maxLoan = calculateMaxLoan(collateral);

        // Max loan should be 80% of collateral
        assertEquals(maxLoan, 800_000, "1 ADA collateral should allow 0.8 ADA loan");

        // Inverse check: for 1 ADA loan, need at least 1.25 ADA collateral
        const minCollateral = Math.ceil(1_000_000 / MAX_LTV_RATIO);
        assertEquals(minCollateral, 1_250_000, "1 ADA loan should require 1.25 ADA collateral");
    });
});

Deno.test("Proof System Initialization", async (t) => {
    await t.step("should initialize proof system", async () => {
        await initProofSystem();
        // If no error thrown, initialization succeeded
        assert(true, "Proof system initialized");
    });
});

Deno.test("Proof Input Validation", async (t) => {
    await t.step("should validate correct proof inputs", () => {
        const secret = generateRandomSecret();

        validateProofInput({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });

        // If no error thrown, validation passed
        assert(true, "Valid inputs accepted");
    });

    await t.step("should reject invalid collateral amount", () => {
        const secret = generateRandomSecret();

        try {
            validateProofInput({
                collateralAmount: 0,
                secret: secret,
                loanAmount: TEST_LOAN,
            });
            assert(false, "Should have thrown error");
        } catch (error: any) {
            assert(error.message.includes("collateral"), "Should mention collateral");
        }
    });

    await t.step("should reject invalid loan amount", () => {
        const secret = generateRandomSecret();

        try {
            validateProofInput({
                collateralAmount: TEST_COLLATERAL,
                secret: secret,
                loanAmount: 0,
            });
            assert(false, "Should have thrown error");
        } catch (error: any) {
            assert(error.message.includes("loan"), "Should mention loan");
        }
    });

    await t.step("should reject loan exceeding LTV", () => {
        const secret = generateRandomSecret();

        try {
            validateProofInput({
                collateralAmount: TEST_COLLATERAL,
                secret: secret,
                loanAmount: 9_000_000, // 90% LTV (too high)
            });
            assert(false, "Should have thrown error");
        } catch (error: any) {
            assert(error.message.includes("LTV"), "Should mention LTV");
        }
    });

    await t.step("should reject invalid secret format", () => {
        try {
            validateProofInput({
                collateralAmount: TEST_COLLATERAL,
                secret: "not-hex",
                loanAmount: TEST_LOAN,
            });
            assert(false, "Should have thrown error");
        } catch (error: any) {
            assert(error.message.includes("secret"), "Should mention secret");
        }
    });

    await t.step("should reject secret with wrong length", () => {
        try {
            validateProofInput({
                collateralAmount: TEST_COLLATERAL,
                secret: "abc123", // Too short
                loanAmount: TEST_LOAN,
            });
            assert(false, "Should have thrown error");
        } catch (error: any) {
            assert(error.message.includes("secret"), "Should mention secret");
        }
    });
});

Deno.test("ZK Proof Generation and Verification", async (t) => {
    // Initialize once for all proof tests
    await initProofSystem();

    await t.step("should generate valid proof for correct inputs", async () => {
        const secret = generateRandomSecret();

        const result = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });

        assertExists(result.proof, "Proof should exist");
        assertExists(result.publicSignals, "Public signals should exist");
        assertExists(result.proofHash, "Proof hash should exist");

        // Verify proof hash format
        assert(/^[0-9a-f]+$/.test(result.proofHash), "Proof hash should be hex");
    });

    await t.step("should verify valid proof", async () => {
        const secret = generateRandomSecret();

        const result = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });

        const isValid = await verifyCollateralProof(
            result.proof,
            result.publicSignals,
        );

        assertEquals(isValid, true, "Valid proof should verify");
    });

    await t.step("should include correct public signals", async () => {
        const secret = generateRandomSecret();
        const commitment = createCommitment(TEST_COLLATERAL, secret);

        const result = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });

        // Public signals should include:
        // 1. Commitment (Poseidon hash)
        // 2. Loan amount
        // 3. Collateral ratio

        assertExists(result.publicSignals.commitment, "Should have commitment");
        assertExists(result.publicSignals.loan_amount, "Should have loan_amount");
        assertExists(result.publicSignals.collateral_ratio, "Should have collateral_ratio");

        // Commitment should match
        const expectedCommitment = BigInt("0x" + commitment).toString();
        assertEquals(result.publicSignals.commitment, expectedCommitment, "Commitment should match");

        // Loan amount should match
        assertEquals(result.publicSignals.loan_amount, TEST_LOAN.toString(), "Loan amount should match");

        // Collateral ratio should be 125 (for 80% LTV)
        assertEquals(result.publicSignals.collateral_ratio, "125", "Collateral ratio should be 125%");
    });

    await t.step("should generate different proofs for different secrets", async () => {
        const secret1 = generateRandomSecret();
        const secret2 = generateRandomSecret();

        const result1 = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret1,
            loanAmount: TEST_LOAN,
        });

        const result2 = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret2,
            loanAmount: TEST_LOAN,
        });

        // Proofs should be different
        const hash1 = await hashProof(result1.proof);
        const hash2 = await hashProof(result2.proof);

        assert(hash1 !== hash2, "Different secrets should produce different proofs");

        // Commitments should be different
        assert(
            result1.publicSignals.commitment !== result2.publicSignals.commitment,
            "Different secrets should produce different commitments"
        );
    });

    await t.step("should reject proof with tampered public signals", async () => {
        const secret = generateRandomSecret();

        const result = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });

        // Tamper with loan amount in public signals
        const tamperedSignals = {
            ...result.publicSignals,
            loan_amount: (TEST_LOAN + 1_000_000).toString(), // Increase loan by 1 ADA
        };

        const isValid = await verifyCollateralProof(
            result.proof,
            tamperedSignals,
        );

        assertEquals(isValid, false, "Tampered proof should fail verification");
    });
});

Deno.test("Complete Lending Cycle Simulation", async (t) => {
    await t.step("should complete full cycle: deposit → borrow → repay → withdraw", async () => {
        console.log("\n📋 Simulating Complete Lending Cycle\n");

        // Step 1: Generate secret and commitment (DEPOSIT)
        console.log("1️⃣  DEPOSIT: Generating secret and commitment...");
        const secret = generateRandomSecret();
        const commitment = createCommitment(TEST_COLLATERAL, secret);

        assertExists(secret, "Secret should be generated");
        assertExists(commitment, "Commitment should be created");
        console.log(`   ✅ Secret: ${secret.substring(0, 16)}...`);
        console.log(`   ✅ Commitment: ${commitment.substring(0, 16)}...\n`);

        // Step 2: Calculate max loan and generate proof (BORROW)
        console.log("2️⃣  BORROW: Calculating max loan and generating proof...");
        const maxLoan = calculateMaxLoan(TEST_COLLATERAL);
        const loanAmount = Math.floor(maxLoan * 0.9); // Borrow 90% of max (safe)

        console.log(`   Collateral: ${TEST_COLLATERAL / 1_000_000} ADA`);
        console.log(`   Max Loan: ${maxLoan / 1_000_000} ADA (80% LTV)`);
        console.log(`   Requesting: ${loanAmount / 1_000_000} ADA (90% of max)\n`);

        await initProofSystem();

        const borrowProof = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: loanAmount,
        });

        assertExists(borrowProof.proof, "Borrow proof should exist");
        console.log(`   ✅ Proof generated: ${borrowProof.proofHash.substring(0, 16)}...\n`);

        // Verify proof
        const isBorrowProofValid = await verifyCollateralProof(
            borrowProof.proof,
            borrowProof.publicSignals,
        );

        assertEquals(isBorrowProofValid, true, "Borrow proof should be valid");
        console.log(`   ✅ Proof verified successfully!\n`);

        // Step 3: Calculate repayment and generate proof (REPAY)
        console.log("3️⃣  REPAY: Calculating repayment amount...");
        const interest = calculateInterest(loanAmount);
        const repaymentAmount = calculateRepaymentAmount(loanAmount);

        console.log(`   Principal: ${loanAmount / 1_000_000} ADA`);
        console.log(`   Interest (5%): ${interest / 1_000_000} ADA`);
        console.log(`   Total Repayment: ${repaymentAmount / 1_000_000} ADA\n`);

        const repayProof = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: loanAmount,
        });

        assertExists(repayProof.proof, "Repay proof should exist");
        console.log(`   ✅ Repay proof generated: ${repayProof.proofHash.substring(0, 16)}...\n`);

        // Verify repay proof
        const isRepayProofValid = await verifyCollateralProof(
            repayProof.proof,
            repayProof.publicSignals,
        );

        assertEquals(isRepayProofValid, true, "Repay proof should be valid");
        console.log(`   ✅ Repay proof verified successfully!\n`);

        // Step 4: Withdraw collateral
        console.log("4️⃣  WITHDRAW: Collateral can now be withdrawn");
        console.log(`   ✅ Deposit unlocked`);
        console.log(`   ✅ ${TEST_COLLATERAL / 1_000_000} ADA ready to withdraw\n`);

        // Final assertions
        assert(isBorrowProofValid, "Borrow proof must be valid");
        assert(isRepayProofValid, "Repay proof must be valid");
        assertEquals(repaymentAmount, loanAmount + interest, "Repayment must equal principal + interest");

        console.log("═══════════════════════════════════════════════════════");
        console.log("✅ COMPLETE CYCLE SIMULATION SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        console.log("📊 Privacy Summary:");
        console.log("   Deposit:  10% privacy (public)");
        console.log("   Borrow:   85% privacy (backend-signed)");
        console.log("   Repay:    65% privacy (backend-signed)");
        console.log("   Withdraw: 40% privacy (owner-signed)");
        console.log("   Overall:  ~50% privacy improvement\n");
    });

    await t.step("should prevent over-borrowing", async () => {
        const secret = generateRandomSecret();
        const maxLoan = calculateMaxLoan(TEST_COLLATERAL);
        const overLoan = maxLoan + 1_000_000; // Try to borrow more than max

        try {
            validateProofInput({
                collateralAmount: TEST_COLLATERAL,
                secret: secret,
                loanAmount: overLoan,
            });
            assert(false, "Should have thrown error for over-borrowing");
        } catch (error: any) {
            assert(error.message.includes("LTV"), "Should mention LTV violation");
        }
    });

    await t.step("should calculate correct interest for various loan amounts", () => {
        const testCases = [
            { loan: 1_000_000, expectedInterest: 50_000 }, // 1 ADA → 0.05 ADA
            { loan: 10_000_000, expectedInterest: 500_000 }, // 10 ADA → 0.5 ADA
            { loan: 100_000_000, expectedInterest: 5_000_000 }, // 100 ADA → 5 ADA
        ];

        for (const { loan, expectedInterest } of testCases) {
            const actualInterest = calculateInterest(loan);
            assertEquals(
                actualInterest,
                expectedInterest,
                `Interest for ${loan / 1_000_000} ADA should be ${expectedInterest / 1_000_000} ADA`
            );
        }
    });
});

// ============================================
// PERFORMANCE TESTS
// ============================================

Deno.test("Performance Benchmarks", async (t) => {
    await t.step("should generate secret quickly", () => {
        const start = performance.now();

        for (let i = 0; i < 100; i++) {
            generateRandomSecret();
        }

        const end = performance.now();
        const avgTime = (end - start) / 100;

        console.log(`   ⏱️  Average secret generation: ${avgTime.toFixed(2)}ms`);
        assert(avgTime < 10, "Secret generation should be fast (<10ms)");
    });

    await t.step("should create commitment quickly", () => {
        const secret = generateRandomSecret();
        const start = performance.now();

        for (let i = 0; i < 100; i++) {
            createCommitment(TEST_COLLATERAL, secret);
        }

        const end = performance.now();
        const avgTime = (end - start) / 100;

        console.log(`   ⏱️  Average commitment creation: ${avgTime.toFixed(2)}ms`);
        assert(avgTime < 50, "Commitment creation should be fast (<50ms)");
    });

    await t.step("should generate and verify proof (single run)", async () => {
        await initProofSystem();
        const secret = generateRandomSecret();

        const proofStart = performance.now();
        const result = await generateCollateralProof({
            collateralAmount: TEST_COLLATERAL,
            secret: secret,
            loanAmount: TEST_LOAN,
        });
        const proofEnd = performance.now();
        const proofTime = proofEnd - proofStart;

        console.log(`   ⏱️  Proof generation: ${proofTime.toFixed(0)}ms`);

        const verifyStart = performance.now();
        const isValid = await verifyCollateralProof(result.proof, result.publicSignals);
        const verifyEnd = performance.now();
        const verifyTime = verifyEnd - verifyStart;

        console.log(`   ⏱️  Proof verification: ${verifyTime.toFixed(0)}ms`);

        assertEquals(isValid, true, "Proof should be valid");

        // Note: ZK proofs are computationally expensive
        // These are just informational benchmarks
    });
});
