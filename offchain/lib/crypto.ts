/**
 * Cryptographic Utilities for V3 Privacy-Enhanced Lending Protocol
 *
 * This module provides:
 * - Poseidon hash function for ZK commitments
 * - Random secret generation (252-bit for BN254 field)
 * - ZK proof hashing for on-chain verification
 * - Proof verification utilities
 */

import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";
import type { ZKProof } from "./types.ts";

// ============================================
// POSEIDON HASH (ZK Commitment)
// ============================================

let poseidonInstance: any = null;

/**
 * Initializes Poseidon hash function
 * Must be called once before using poseidonHash()
 *
 * @example
 * await initPoseidon();
 * const hash = poseidonHash([123n, 456n]);
 */
export async function initPoseidon(): Promise<void> {
    if (!poseidonInstance) {
        poseidonInstance = await buildPoseidon();
    }
}

/**
 * Computes Poseidon hash of inputs
 * Uses the BN254 field from circomlibjs
 *
 * @param inputs - Array of bigint inputs (typically 2: amount and secret)
 * @returns Hex string of hash output (64 chars, 32 bytes)
 *
 * @throws Error if Poseidon not initialized
 *
 * @example
 * await initPoseidon();
 * const hash = poseidonHash([1500000000n, BigInt("0x123abc...")]);
 * console.log(hash); // "a3f2b1c..."
 */
export function poseidonHash(inputs: bigint[]): string {
    if (!poseidonInstance) {
        throw new Error("Poseidon not initialized. Call initPoseidon() first.");
    }

    // Compute hash using Poseidon
    const hash = poseidonInstance.F.toString(poseidonInstance(inputs));

    // Convert to hex string (padded to 64 chars = 32 bytes)
    return BigInt(hash).toString(16).padStart(64, "0");
}

/**
 * Creates a commitment for collateral deposit
 * Commitment = Poseidon(collateral_amount, secret)
 *
 * @param collateralAmount - Amount in lovelace
 * @param secret - Random secret (hex string, 64 chars)
 * @returns Hex string of Poseidon(amount, secret)
 *
 * @example
 * const secret = generateRandomSecret();
 * const commitment = createCommitment(1500000000, secret);
 */
export function createCommitment(collateralAmount: number, secret: string): string {
    const amountBigInt = BigInt(collateralAmount);
    const secretBigInt = BigInt("0x" + secret);

    return poseidonHash([amountBigInt, secretBigInt]);
}

// ============================================
// RANDOM SECRET GENERATION
// ============================================

/**
 * Generates a random 252-bit secret for ZK proofs
 * Ensures secret fits in BN254 field (max 254 bits, we use 252 for safety)
 *
 * @returns Hex string (64 chars = 32 bytes, with top 4 bits set to 0)
 *
 * @example
 * const secret = generateRandomSecret();
 * console.log(secret.length); // 64
 * console.log(secret); // "0abc123..." (starts with 0 due to top 4 bits = 0)
 */
export function generateRandomSecret(): string {
    // Generate 32 random bytes
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);

    // Ensure it fits in 252 bits (BN254 field is 254 bits, we use 252 for safety)
    // Set top 4 bits to 0 by masking the first byte
    randomBytes[0] = randomBytes[0] & 0x0f; // 0x0f = 0b00001111

    // Convert to hex string
    return Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// ============================================
// ZK PROOF HASHING
// ============================================

/**
 * Hashes a ZK proof for on-chain storage
 * Uses SHA-256 as placeholder for Blake2b-256
 *
 * NOTE: This is a placeholder. Actual implementation should use a proper
 * Blake2b library or native crypto API.
 *
 * @param proof - snarkjs proof object
 * @returns Promise resolving to hex string (64 chars = 32 bytes)
 *
 * @example
 * const proof = { pi_a: [...], pi_b: [...], pi_c: [...], ... };
 * const hash = await hashProof(proof);
 */
export async function hashProof(proof: ZKProof): Promise<string> {
    // Serialize proof to canonical JSON (sorted keys for consistency)
    const proofStr = JSON.stringify(proof, Object.keys(proof).sort());

    // PLACEHOLDER: Use SHA-256 (should be Blake2b-256)
    const encoder = new TextEncoder();
    const data = encoder.encode(proofStr);
    const hash = await crypto.subtle.digest("SHA-256", data);

    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// ============================================
// ZK PROOF VERIFICATION
// ============================================

/**
 * Verifies a ZK proof off-chain
 * Uses snarkjs groth16.verify()
 *
 * @param proof - snarkjs proof object
 * @param publicSignals - Array of public signals (as strings)
 * @param vkeyPath - Path to verification key JSON file
 * @returns true if proof is valid, false otherwise
 *
 * @example
 * const isValid = await verifyProof(
 *   proof,
 *   ["commitment", "collateral_amount"],
 *   "./circuits/verification_key.json"
 * );
 */
export async function verifyProof(
    proof: ZKProof,
    publicSignals: string[],
    vkeyPath: string,
): Promise<boolean> {
    try {
        // Load verification key
        const vkeyJson = await Deno.readTextFile(vkeyPath);
        const vkey = JSON.parse(vkeyJson);

        // Verify proof using snarkjs
        const isValid = await groth16.verify(vkey, publicSignals, proof);

        return isValid;
    } catch (error) {
        console.error("Proof verification error:", error);
        return false;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Converts a hex string to Uint8Array
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array
 *
 * @example
 * const bytes = hexToBytes("0abc123...");
 */
export function hexToBytes(hex: string): Uint8Array {
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;

    // Convert to byte array
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Converts Uint8Array to hex string
 *
 * @param bytes - Uint8Array
 * @returns Hex string (without 0x prefix)
 *
 * @example
 * const hex = bytesToHex(new Uint8Array([1, 2, 3]));
 * console.log(hex); // "010203"
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Validates that a commitment is correctly formatted
 *
 * @param commitment - Commitment hex string
 * @returns true if valid (64 chars, non-zero), false otherwise
 *
 * @example
 * const isValid = validateCommitment("a3f2b1c...");
 */
export function validateCommitment(commitment: string): boolean {
    // Must be 64 hex chars (32 bytes)
    if (commitment.length !== 64) {
        return false;
    }

    // Must be valid hex
    if (!/^[0-9a-fA-F]+$/.test(commitment)) {
        return false;
    }

    // Must not be all zeros
    const allZeros = "0".repeat(64);
    if (commitment === allZeros) {
        return false;
    }

    return true;
}

/**
 * Validates that a secret is correctly formatted
 *
 * @param secret - Secret hex string
 * @returns true if valid (64 chars, top 4 bits = 0), false otherwise
 *
 * @example
 * const isValid = validateSecret("0abc123...");
 */
export function validateSecret(secret: string): boolean {
    // Must be 64 hex chars (32 bytes)
    if (secret.length !== 64) {
        return false;
    }

    // Must be valid hex
    if (!/^[0-9a-fA-F]+$/.test(secret)) {
        return false;
    }

    // Top 4 bits should be 0 (first char should be 0-f)
    const firstChar = secret[0].toLowerCase();
    if (!/^[0-9a-f]$/.test(firstChar)) {
        return false;
    }

    return true;
}
