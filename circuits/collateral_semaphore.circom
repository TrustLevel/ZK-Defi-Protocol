pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * CollateralSemaphore Circuit  (BLS12-381) — borrow
 *
 * A borrower proves, in zero knowledge:
 *   1. their collateral leaf L = Poseidon255(COLLATERAL_LEAF_TAG, secret) is a
 *      member of the on-chain collateral set (group_merkle_root), WITHOUT
 *      revealing which deposit it is. The set holds the deposits of every
 *      accepted collateral asset, so the proof reveals neither the deposit nor
 *      its asset nor its amount;
 *   2. a loan nullifier N = Poseidon255(secret, external_nullifier) from the same
 *      secret; the pool records N, so a deposit backs one loan only;
 *   3. the proof is bound to a `recipient` (the payout key hash, as an integer):
 *      the validator pays the loan only to that key, so a proof copied from the
 *      mempool cannot redirect the loan (front-running).
 *
 * Sufficiency is not part of the proof. It is enforced on-chain: a leaf enters
 * group_root only through DepositCollateral, which locks exactly the fixed
 * denomination of an accepted asset, and each denomination covers one loan.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381), so the in-circuit and on-chain
 * hash are identical. Compile with:  circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * packages/protocol/src/crypto.mjs):
 *   [ group_merkle_root, loan_nullifier, external_nullifier, recipient ]
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

template CollateralSemaphore(depth) {
    // Must match COLLATERAL_LEAF_TAG in packages/protocol/src/crypto.mjs.
    var COLLATERAL_LEAF_TAG = 5555;

    // ---- public ----
    signal input group_merkle_root;
    signal input loan_nullifier;
    signal input external_nullifier;
    signal input recipient;

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

    // 4. Range check (anti field-overflow).
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;

    // 5. Recipient binding: squaring puts the otherwise unused public input into
    //    the constraint system (as Tornado Cash does for its recipient).
    signal recipient_sq;
    recipient_sq <== recipient * recipient;
}

component main {
    public [group_merkle_root, loan_nullifier, external_nullifier, recipient]
} = CollateralSemaphore(10);
