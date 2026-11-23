pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * RepayProof Circuit  (BLS12-381) — repay
 *
 * Proves the loan nullifier N AND the repayment nullifier R FROM THE SAME
 * SECRET, so the R that a repay inserts into `repaid_root` is bound to the exact
 * loan being settled. A repay can therefore only ever release its own deposit.
 * It has its own verification key, so a (public) borrow proof is never a valid
 * repay proof, and a repay proof copied by someone else can only settle the
 * victim's loan with the victim's own R.
 *
 * The repayer proves, in zero knowledge:
 *   1. their collateral leaf L = Poseidon255(COLLATERAL_LEAF_TAG, secret) is a
 *      member of the collateral set (group_merkle_root), WITHOUT revealing which;
 *   2. loan_nullifier = Poseidon255(secret, external_nullifier): the N that is
 *      removed from open_loans, so the proof is bound to a real loan;
 *   3. repay_nullifier = Poseidon255(secret, repay_external_nullifier): the R the
 *      validator appends to repaid_root, from the SAME secret and scoped to the
 *      DISTINCT repay_external_nullifier so it cannot be correlated with N.
 *
 * The repaid amount is not part of the proof: the validator requires exactly
 * principal + interest of the fixed loan denomination.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381). Compile with:
 *   circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * packages/protocol/src/crypto.mjs):
 *   [ group_merkle_root, loan_nullifier, repay_nullifier, external_nullifier,
 *     repay_external_nullifier ]
 * Private witness:
 *   secret, pathIndices[depth], siblings[depth]
 */

// Merkle inclusion proof for a binary tree hashed with Poseidon255(2).
// (Same template as in collateral_semaphore.circom; kept here so the circuit is
// self-contained.)
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

template RepayProof(depth) {
    // Must match COLLATERAL_LEAF_TAG in packages/protocol/src/crypto.mjs.
    var COLLATERAL_LEAF_TAG = 5555;

    // ---- public ----
    signal input group_merkle_root;
    signal input loan_nullifier;
    signal input repay_nullifier;
    signal input external_nullifier;
    signal input repay_external_nullifier;

    // ---- private witness ----
    signal input secret;
    signal input pathIndices[depth];
    signal input siblings[depth];

    // 1. Leaf = Poseidon255(COLLATERAL_LEAF_TAG, secret).
    component leafH = Poseidon255(2);
    leafH.in[0] <== COLLATERAL_LEAF_TAG;
    leafH.in[1] <== secret;

    // 2. Membership: the leaf is in the tree rooted at group_merkle_root.
    component mt = MerkleInclusion(depth);
    mt.leaf <== leafH.out;
    for (var i = 0; i < depth; i++) {
        mt.pathIndices[i] <== pathIndices[i];
        mt.siblings[i] <== siblings[i];
    }
    mt.root === group_merkle_root;

    // 3. Loan nullifier N = Poseidon255(secret, external_nullifier).
    component nH = Poseidon255(2);
    nH.in[0] <== secret;
    nH.in[1] <== external_nullifier;
    nH.out === loan_nullifier;

    // 4. Repayment nullifier R = Poseidon255(secret, repay_external_nullifier),
    //    from the SAME secret as N: R is bound to the loan being repaid.
    component rH = Poseidon255(2);
    rH.in[0] <== secret;
    rH.in[1] <== repay_external_nullifier;
    rH.out === repay_nullifier;

    // 5. Range check (anti field-overflow).
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;
}

component main {
    public [group_merkle_root, loan_nullifier, repay_nullifier, external_nullifier, repay_external_nullifier]
} = RepayProof(10);
