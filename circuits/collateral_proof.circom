pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * ProveOwnership Circuit  (BLS12-381)
 *
 * Proves that a user owns a UTXO with sufficient collateral without revealing:
 * - The secret
 * - The exact collateral amount
 *
 * MIGRATED BN254 -> BLS12-381 (v5 / Milestone 3):
 * Cardano's on-chain Groth16 builtins are BLS12-381 only, so the commitment
 * hash uses Poseidon255 (poseidon-bls12381-circom) instead of circomlib's
 * BN254 Poseidon. Compile with:  circom --prime bls12381 -l .
 * Logic and public-signal layout are unchanged from the BN254 version.
 *
 * Public Inputs:
 *   - commitment: The commitment being proven (Poseidon255 hash output)
 *   - loan_amount: Requested loan amount
 *   - collateral_ratio: Required collateralization ratio (e.g., 150 for 150%)
 *
 * Private Inputs (Witness):
 *   - secret: User's secret (random <254-bit value)
 *   - collateral_amount: Actual collateral in UTXO
 *
 * Constraints:
 *   1. commitment == Poseidon255(collateral_amount, secret)
 *   2. collateral_amount * 100 >= loan_amount * collateral_ratio
 *   3. Range checks to prevent overflow
 */
template ProveOwnership() {
    // ========================================
    // Public Inputs (visible to verifier)
    // ========================================
    signal input commitment;          // The commitment to verify
    signal input loan_amount;         // Requested loan amount
    signal input collateral_ratio;    // Required ratio (e.g., 150 = 150%)

    // ========================================
    // Private Inputs (witness - secret)
    // ========================================
    signal input secret;              // User's secret (random <254-bit)
    signal input collateral_amount;   // Actual collateral in UTXO

    // ========================================
    // Constraint 1: Verify Commitment
    // ========================================
    // Compute commitment from private inputs using BLS12-381 Poseidon255.
    // NOTE: Poseidon255 exposes its inputs as `in[]` (not `inputs[]`).
    component poseidon = Poseidon255(2);
    poseidon.in[0] <== collateral_amount;  // First input: collateral amount
    poseidon.in[1] <== secret;              // Second input: secret

    signal computed_commitment;
    computed_commitment <== poseidon.out;

    // Verify that computed commitment matches the public commitment
    commitment === computed_commitment;

    // ========================================
    // Constraint 2: Verify Sufficient Collateral
    // ========================================
    // Calculate required collateral: required = (loan_amount * collateral_ratio)
    signal required_collateral;
    required_collateral <== loan_amount * collateral_ratio;

    // Check: collateral_amount * 100 >= required_collateral
    // We multiply by 100 to maintain precision (avoid floating point)
    signal collateral_scaled;
    collateral_scaled <== collateral_amount * 100;

    // Use GreaterEqThan to verify collateral_scaled >= required_collateral
    component ge = GreaterEqThan(64);  // 64 bits should be enough for ADA amounts
    ge.in[0] <== collateral_scaled;
    ge.in[1] <== required_collateral;

    // Constraint: ge.out must be 1 (true)
    ge.out === 1;

    // ========================================
    // Constraint 3: Range Checks (Security)
    // ========================================
    // Ensure inputs are within valid ranges to prevent overflow attacks

    // Range check for collateral_amount (must fit in 64 bits)
    component rc_collateral = Num2Bits(64);
    rc_collateral.in <== collateral_amount;

    // Range check for loan_amount (must fit in 64 bits)
    component rc_loan = Num2Bits(64);
    rc_loan.in <== loan_amount;

    // Range check for secret (must fit in 254 bits - safe for BLS12-381 field)
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;

    // Range check for collateral_ratio (must fit in 16 bits - reasonable max 65535%)
    component rc_ratio = Num2Bits(16);
    rc_ratio.in <== collateral_ratio;
}

// Main component with public inputs declaration
component main {public [commitment, loan_amount, collateral_ratio]} = ProveOwnership();
