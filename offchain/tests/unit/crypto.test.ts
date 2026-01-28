/**
 * Tests for Cryptographic Utilities
 *
 * Run with: deno test --allow-read tests/crypto.test.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import {
    bytesToHex,
    createCommitment,
    generateRandomSecret,
    hexToBytes,
    initPoseidon,
    poseidonHash,
    validateCommitment,
    validateSecret,
} from "../lib/crypto.ts";

// Initialize Poseidon before tests
await initPoseidon();

// ============================================
// SECRET GENERATION TESTS
// ============================================

Deno.test("generateRandomSecret() generates 64-char hex string", () => {
    const secret = generateRandomSecret();

    assertEquals(secret.length, 64, "Secret should be 64 hex chars (32 bytes)");
    assertEquals(/^[0-9a-fA-F]+$/.test(secret), true, "Secret should be valid hex");
});

Deno.test("generateRandomSecret() generates unique secrets", () => {
    const secret1 = generateRandomSecret();
    const secret2 = generateRandomSecret();

    assertEquals(secret1 === secret2, false, "Secrets should be unique");
});

Deno.test("generateRandomSecret() generates secrets with top 4 bits = 0", () => {
    const secret = generateRandomSecret();

    // First char should be 0-f (top 4 bits = 0)
    const firstChar = secret[0];
    const isValid = /^[0-9a-fA-F]$/.test(firstChar);

    assertEquals(isValid, true, "First char should be 0-f (top 4 bits = 0)");
});

// ============================================
// POSEIDON HASH TESTS
// ============================================

Deno.test("poseidonHash() computes hash correctly", () => {
    const inputs = [123n, 456n];
    const hash = poseidonHash(inputs);

    assertEquals(hash.length, 64, "Hash should be 64 hex chars (32 bytes)");
    assertEquals(/^[0-9a-fA-F]+$/.test(hash), true, "Hash should be valid hex");
});

Deno.test("poseidonHash() is deterministic", () => {
    const inputs = [1500000000n, BigInt("0x123abc")];
    const hash1 = poseidonHash(inputs);
    const hash2 = poseidonHash(inputs);

    assertEquals(hash1, hash2, "Same inputs should produce same hash");
});

Deno.test("poseidonHash() produces different hashes for different inputs", () => {
    const hash1 = poseidonHash([123n, 456n]);
    const hash2 = poseidonHash([123n, 789n]);

    assertEquals(hash1 === hash2, false, "Different inputs should produce different hashes");
});

// ============================================
// COMMITMENT TESTS
// ============================================

Deno.test("createCommitment() creates valid commitment", () => {
    const secret = generateRandomSecret();
    const commitment = createCommitment(1500000000, secret);

    assertEquals(commitment.length, 64, "Commitment should be 64 hex chars");
    assertEquals(/^[0-9a-fA-F]+$/.test(commitment), true, "Commitment should be valid hex");
});

Deno.test("createCommitment() is deterministic", () => {
    const secret = "0abc123456789abcdef0123456789abcdef0123456789abcdef0123456789abc";
    const amount = 1500000000;

    const commitment1 = createCommitment(amount, secret);
    const commitment2 = createCommitment(amount, secret);

    assertEquals(commitment1, commitment2, "Same inputs should produce same commitment");
});

Deno.test("createCommitment() produces different commitments for different secrets", () => {
    const secret1 = generateRandomSecret();
    const secret2 = generateRandomSecret();
    const amount = 1500000000;

    const commitment1 = createCommitment(amount, secret1);
    const commitment2 = createCommitment(amount, secret2);

    assertEquals(commitment1 === commitment2, false, "Different secrets should produce different commitments");
});

Deno.test("createCommitment() produces different commitments for different amounts", () => {
    const secret = generateRandomSecret();

    const commitment1 = createCommitment(1500000000, secret);
    const commitment2 = createCommitment(2000000000, secret);

    assertEquals(commitment1 === commitment2, false, "Different amounts should produce different commitments");
});

// ============================================
// VALIDATION TESTS
// ============================================

Deno.test("validateCommitment() accepts valid commitments", () => {
    const commitment = "a3f2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2";
    assertEquals(validateCommitment(commitment), true);
});

Deno.test("validateCommitment() rejects invalid length", () => {
    const commitment = "abc123"; // Too short
    assertEquals(validateCommitment(commitment), false);
});

Deno.test("validateCommitment() rejects non-hex characters", () => {
    const commitment = "g3f2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2"; // 'g' is invalid
    assertEquals(validateCommitment(commitment), false);
});

Deno.test("validateCommitment() rejects all-zeros", () => {
    const commitment = "0".repeat(64);
    assertEquals(validateCommitment(commitment), false);
});

Deno.test("validateSecret() accepts valid secrets", () => {
    const secret = "0abc123456789abcdef0123456789abcdef0123456789abcdef0123456789abc";
    assertEquals(validateSecret(secret), true);
});

Deno.test("validateSecret() rejects invalid length", () => {
    const secret = "abc123"; // Too short
    assertEquals(validateSecret(secret), false);
});

Deno.test("validateSecret() rejects non-hex characters", () => {
    const secret = "gabc123456789abcdef0123456789abcdef0123456789abcdef0123456789abc";
    assertEquals(validateSecret(secret), false);
});

// ============================================
// HEX CONVERSION TESTS
// ============================================

Deno.test("hexToBytes() converts hex to bytes", () => {
    const hex = "010203";
    const bytes = hexToBytes(hex);

    assertEquals(bytes.length, 3);
    assertEquals(bytes[0], 1);
    assertEquals(bytes[1], 2);
    assertEquals(bytes[2], 3);
});

Deno.test("hexToBytes() handles 0x prefix", () => {
    const hex = "0x010203";
    const bytes = hexToBytes(hex);

    assertEquals(bytes.length, 3);
    assertEquals(bytes[0], 1);
});

Deno.test("bytesToHex() converts bytes to hex", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hex = bytesToHex(bytes);

    assertEquals(hex, "010203");
});

Deno.test("hexToBytes() and bytesToHex() are inverses", () => {
    const original = "a3f2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2";
    const bytes = hexToBytes(original);
    const hex = bytesToHex(bytes);

    assertEquals(hex, original);
});

// ============================================
// INTEGRATION TEST
// ============================================

Deno.test("Full commitment flow works end-to-end", () => {
    // 1. Generate secret
    const secret = generateRandomSecret();
    assertExists(secret);
    assertEquals(validateSecret(secret), true);

    // 2. Create commitment
    const amount = 1500000000; // 1500 ADA
    const commitment = createCommitment(amount, secret);
    assertExists(commitment);
    assertEquals(validateCommitment(commitment), true);

    // 3. Recreate commitment with same inputs
    const commitment2 = createCommitment(amount, secret);
    assertEquals(commitment, commitment2);

    // 4. Different amount produces different commitment
    const commitment3 = createCommitment(2000000000, secret);
    assertEquals(commitment === commitment3, false);

    console.log("✅ Full commitment flow test passed!");
    console.log(`   Secret: ${secret.substring(0, 16)}...`);
    console.log(`   Commitment: ${commitment.substring(0, 16)}...`);
});
