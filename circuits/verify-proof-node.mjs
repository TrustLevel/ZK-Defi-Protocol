#!/usr/bin/env node
/**
 * Node.js Proof Verifier Subprocess
 *
 * This script is called by the Deno backend to verify ZK proofs.
 * Uses Node.js for snarkjs compatibility (Deno has Web Worker issues).
 *
 * Usage:
 *   node verify-proof-node.mjs <vkey-path> <proof-json> <signals-json>
 *
 * Output:
 *   JSON to stdout: { valid: boolean }
 *   JSON to stderr: { valid: false, error: string }
 *
 * Exit codes:
 *   0 - Verification completed (check JSON for result)
 *   1 - Error (invalid arguments, file not found, etc.)
 *
 * Example:
 *   node verify-proof-node.mjs \
 *     ./circuits/verification_key.json \
 *     '{"pi_a":[...],"pi_b":[[...]],"pi_c":[...],"protocol":"groth16","curve":"bn128"}' \
 *     '["123...","456...","789..."]'
 */

import { groth16 } from 'snarkjs';
import { readFileSync } from 'fs';

// Parse arguments
const [vkeyPath, proofJson, signalsJson] = process.argv.slice(2);

if (!vkeyPath || !proofJson || !signalsJson) {
    console.error(JSON.stringify({
        valid: false,
        error: "Missing arguments. Usage: node verify-proof-node.mjs <vkey-path> <proof-json> <signals-json>"
    }));
    process.exit(1);
}

try {
    // Load verification key
    const vkey = JSON.parse(readFileSync(vkeyPath, 'utf8'));

    // Parse proof and signals
    const proof = JSON.parse(proofJson);
    const signals = JSON.parse(signalsJson);

    // Convert signals object to array if needed
    // Supports both array format and object format
    let signalsArray;
    if (Array.isArray(signals)) {
        signalsArray = signals;
    } else if (signals.commitment && signals.loan_amount && signals.collateral_ratio) {
        signalsArray = [
            signals.commitment,
            signals.loan_amount,
            signals.collateral_ratio
        ];
    } else {
        throw new Error("Invalid signals format. Expected array or { commitment, loan_amount, collateral_ratio }");
    }

    // Verify proof with snarkjs
    const isValid = await groth16.verify(vkey, signalsArray, proof);

    // Output result to stdout
    console.log(JSON.stringify({ valid: isValid }));
    process.exit(0);

} catch (error) {
    // Output error to stderr
    console.error(JSON.stringify({
        valid: false,
        error: error.message || String(error)
    }));
    process.exit(1);
}
