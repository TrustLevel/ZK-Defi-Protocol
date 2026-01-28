/**
 * ZK Proof Generation and Verification Utilities for V3
 *
 * This module provides functions for:
 * - Generating ZK proofs for anonymous borrowing/repayment
 * - Verifying proofs offchain
 * - Hashing proofs for onchain storage
 */

import { groth16 } from "snarkjs";
import { createCommitment, hashProof, initPoseidon } from "./crypto.ts";
import type { ZKProof, ProveCollateralPublicSignals } from "./types.ts";
import {
    ZK_CIRCUIT_WASM,
    ZK_CIRCUIT_ZKEY,
    ZK_VKEY,
    MAX_LTV_RATIO,
} from "./config.ts";

// ============================================
// TYPES
// ============================================

export interface ProofGenerationInput {
    collateralAmount: number; // in lovelace
    secret: string; // hex string (64 chars)
    loanAmount: number; // in lovelace
}

export interface ProofGenerationResult {
    proof: ZKProof;
    publicSignals: ProveCollateralPublicSignals;
    proofHash: string; // SHA-256 hash for onchain storage
}

// ============================================
// PROOF GENERATION
// ============================================

/**
 * Generate ZK proof for collateral ownership
 *
 * Proves: "I own a deposit with commitment C and sufficient collateral for loan L"
 * Without revealing: The secret or exact collateral amount
 *
 * @param input - Proof generation parameters
 * @returns Proof, public signals, and proof hash
 *
 * @example
 * await initPoseidon();
 * const result = await generateCollateralProof({
 *   collateralAmount: 1500000000,
 *   secret: "0abc123...",
 *   loanAmount: 1200000000
 * });
 */
export async function generateCollateralProof(
    input: ProofGenerationInput,
): Promise<ProofGenerationResult> {
    const { collateralAmount, secret, loanAmount } = input;

    // Calculate commitment (must match onchain commitment)
    const commitmentHex = createCommitment(collateralAmount, secret);

    // Convert to decimal strings (circuit expects decimal BigInt)
    const commitmentDecimal = BigInt("0x" + commitmentHex).toString();
    const secretDecimal = BigInt("0x" + secret).toString();

    // Calculate collateral ratio for V3 (80% LTV = 125% collateral ratio)
    const collateralRatio = Math.floor(100 / (MAX_LTV_RATIO / 100));

    console.log(`🔐 Generating ZK proof:`);
    console.log(`   Collateral: ${collateralAmount / 1_000_000} ADA`);
    console.log(`   Loan: ${loanAmount / 1_000_000} ADA`);
    console.log(`   LTV Ratio: ${MAX_LTV_RATIO}%`);
    console.log(`   Collateral Ratio: ${collateralRatio}%`);

    // Prepare circuit inputs
    const circuitInputs = {
        commitment: commitmentDecimal,
        loan_amount: loanAmount.toString(),
        collateral_ratio: collateralRatio.toString(),
        secret: secretDecimal,
        collateral_amount: collateralAmount.toString(),
    };

    // Generate proof with snarkjs
    const startTime = Date.now();
    const { proof, publicSignals } = await groth16.fullProve(
        circuitInputs,
        ZK_CIRCUIT_WASM,
        ZK_CIRCUIT_ZKEY,
    );

    const duration = Date.now() - startTime;
    console.log(`   ✅ Proof generated in ${duration}ms`);

    // Parse public signals
    const parsedPublicSignals: ProveCollateralPublicSignals = {
        commitment: publicSignals[0],
        loan_amount: publicSignals[1],
        collateral_ratio: publicSignals[2],
    };

    // Hash proof for onchain storage
    const proofHashValue = await hashProof(proof as ZKProof);

    return {
        proof: proof as ZKProof,
        publicSignals: parsedPublicSignals,
        proofHash: proofHashValue,
    };
}

/**
 * Verify ZK proof offchain
 *
 * @param proof - The ZK proof to verify
 * @param publicSignals - Public signals from proof generation
 * @returns true if proof is valid, false otherwise
 *
 * @example
 * const isValid = await verifyCollateralProof(proof, publicSignals);
 * if (!isValid) {
 *   throw new Error("Invalid proof!");
 * }
 */
export async function verifyCollateralProof(
    proof: ZKProof,
    publicSignals: ProveCollateralPublicSignals,
): Promise<boolean> {
    try {
        console.log("🔍 Verifying ZK proof...");

        // Load verification key
        const vkeyJson = await Deno.readTextFile(ZK_VKEY);
        const vkey = JSON.parse(vkeyJson);

        // Convert public signals to array format
        const publicSignalsArray = [
            publicSignals.commitment,
            publicSignals.loan_amount,
            publicSignals.collateral_ratio,
        ];

        // Verify with snarkjs
        const isValid = await groth16.verify(vkey, publicSignalsArray, proof);

        if (isValid) {
            console.log("   ✅ Proof is valid!");
        } else {
            console.log("   ❌ Proof is INVALID!");
        }

        return isValid;
    } catch (error) {
        console.error("   ❌ Proof verification error:", error);
        return false;
    }
}

/**
 * Validate proof generation input
 *
 * @param input - Input to validate
 * @throws Error if input is invalid
 */
export function validateProofInput(input: ProofGenerationInput): void {
    const { collateralAmount, secret, loanAmount } = input;

    // Validate collateral amount
    if (collateralAmount <= 0) {
        throw new Error("Collateral amount must be positive");
    }

    // Validate secret format (64 hex chars)
    if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
        throw new Error("Secret must be 64 hex characters");
    }

    // Validate loan amount
    if (loanAmount <= 0) {
        throw new Error("Loan amount must be positive");
    }

    // Validate LTV ratio
    const maxLoan = Math.floor((collateralAmount * MAX_LTV_RATIO) / 100);
    if (loanAmount > maxLoan) {
        throw new Error(
            `Loan amount (${loanAmount / 1_000_000} ADA) exceeds max LTV (${maxLoan / 1_000_000} ADA at ${MAX_LTV_RATIO}%)`,
        );
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format proof for API transmission
 *
 * @param result - Proof generation result
 * @returns JSON-serializable proof data
 */
export function serializeProof(result: ProofGenerationResult): string {
    return JSON.stringify({
        proof: result.proof,
        publicSignals: result.publicSignals,
        proofHash: result.proofHash,
    });
}

/**
 * Parse proof from API response
 *
 * @param json - JSON string from API
 * @returns Parsed proof result
 */
export function deserializeProof(json: string): ProofGenerationResult {
    const parsed = JSON.parse(json);
    return {
        proof: parsed.proof as ZKProof,
        publicSignals: parsed.publicSignals as ProveCollateralPublicSignals,
        proofHash: parsed.proofHash,
    };
}

/**
 * Initialize proof generation system
 *
 * Call this once before generating proofs
 *
 * @example
 * await initProofSystem();
 * const proof = await generateCollateralProof({...});
 */
export async function initProofSystem(): Promise<void> {
    console.log("🔐 Initializing proof system...");

    // Initialize Poseidon hash
    await initPoseidon();

    // Verify circuit files exist
    try {
        await Deno.stat(ZK_CIRCUIT_WASM);
        await Deno.stat(ZK_CIRCUIT_ZKEY);
        await Deno.stat(ZK_VKEY);
    } catch (error) {
        throw new Error(
            `Circuit files not found! Please ensure:\n` +
                `  - ${ZK_CIRCUIT_WASM}\n` +
                `  - ${ZK_CIRCUIT_ZKEY}\n` +
                `  - ${ZK_VKEY}\n` +
                `are present.`,
        );
    }

    console.log("   ✅ Proof system initialized");
}
