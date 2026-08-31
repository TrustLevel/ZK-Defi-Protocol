pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * CollateralSemaphore Circuit  (BLS12-381)
 *
 * The privacy-preserving authorization proof for the ZK-DeFi lending protocol.
 * A borrower proves, in zero knowledge:
 *   1. their collateral commitment is a member of the on-chain commitment set
 *      (Merkle root) — WITHOUT revealing which deposit it is (unlinkability);
 *   2. the collateral is sufficient for the requested loan — WITHOUT revealing
 *      the collateral amount (amount confidentiality; the amount is a private
 *      witness and the on-chain UTxO uses a fixed denomination);
 *   3. a loan nullifier derived from the same secret, scoped to a loan context
 *      (external_nullifier), preventing the same collateral from backing two
 *      loans and gating unlock on repayment.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381), so the in-circuit and on-chain
 * commitment hash are identical. Compile with:  circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * offchain/cli/v5/common.mjs):
 *   [ group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier ]
 * Private witness:
 *   secret, collateral_amount, pathIndices[depth], siblings[depth]
 */

// Merkle inclusion proof for a binary tree hashed with Poseidon255(2).
// pathIndices[i] == 0  => current node is the LEFT child at level i
// pathIndices[i] == 1  => current node is the RIGHT child at level i
template MerkleInclusion(depth) {
    signal input leaf;
    signal input pathIndices[depth];
    signal input siblings[depth];
    signal output root;

    signal cur[depth + 1];
    signal left[depth];
    signal right[depth];
    component hash[depth];

    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be a bit
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        // Order the pair according to the path bit.
        left[i] <== cur[i] + pathIndices[i] * (siblings[i] - cur[i]);
        right[i] <== siblings[i] + pathIndices[i] * (cur[i] - siblings[i]);

        hash[i] = Poseidon255(2);
        hash[i].in[0] <== left[i];
        hash[i].in[1] <== right[i];
        cur[i + 1] <== hash[i].out;
    }

    root <== cur[depth];
}

template CollateralSemaphore(depth) {
    // ---- public ----
    signal input group_merkle_root;
    signal input loan_nullifier;
    signal input loan_amount;
    signal input collateral_ratio;
    signal input external_nullifier;

    // ---- private witness ----
    signal input secret;
    signal input collateral_amount;
    signal input pathIndices[depth];
    signal input siblings[depth];

    // 1. Leaf = the collateral commitment = Poseidon255(collateral_amount, secret)
    component leafH = Poseidon255(2);
    leafH.in[0] <== collateral_amount;
    leafH.in[1] <== secret;

    // 2. Membership: the leaf is in the tree rooted at group_merkle_root.
    component mt = MerkleInclusion(depth);
    mt.leaf <== leafH.out;
    for (var i = 0; i < depth; i++) {
        mt.pathIndices[i] <== pathIndices[i];
        mt.siblings[i] <== siblings[i];
    }
    mt.root === group_merkle_root;

    // 3. Nullifier = Poseidon255(secret, external_nullifier).
    component nH = Poseidon255(2);
    nH.in[0] <== secret;
    nH.in[1] <== external_nullifier;
    nH.out === loan_nullifier;

    // 4. Sufficiency: collateral_amount * 100 >= loan_amount * collateral_ratio.
    signal required;
    required <== loan_amount * collateral_ratio;
    signal scaled;
    scaled <== collateral_amount * 100;

    component ge = GreaterEqThan(64);
    ge.in[0] <== scaled;
    ge.in[1] <== required;
    ge.out === 1;

    // 5. Range checks (anti field-overflow).
    component rc_collateral = Num2Bits(64);
    rc_collateral.in <== collateral_amount;
    component rc_loan = Num2Bits(64);
    rc_loan.in <== loan_amount;
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;
    component rc_ratio = Num2Bits(16);
    rc_ratio.in <== collateral_ratio;
}

component main {
    public [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]
} = CollateralSemaphore(10);
