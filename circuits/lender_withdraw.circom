pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * LenderWithdraw Circuit  (BLS12-381)
 *
 * Takes one pool share out, privately. Every lender note is exactly one share;
 * adding liquidity appends the note's leaf to the pool's `lender_root` (via the
 * append circuit). To withdraw, the lender proves in zero knowledge:
 *   1. their note's leaf L = Poseidon255(LENDER_LEAF_TAG, secret) is a member of
 *      the lender tree (lender_root) — WITHOUT revealing which note it is, so the
 *      withdrawal cannot be linked to the liquidity deposit that created it;
 *   2. a withdraw nullifier W = Poseidon255(secret, lender_external_nullifier)
 *      from the same secret; the pool records W, so a note pays out only once;
 *   3. the proof is bound to a `recipient` (the payout key hash, as an integer):
 *      the validator pays the share only to that key, so a proof copied from the
 *      mempool cannot redirect the payout (front-running).
 * The amount is not part of the proof: every note is one share and the pool pays
 * the current share price, the same for every note.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381), so the in-circuit and on-chain
 * hash are identical. Compile with:  circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * packages/protocol/src/crypto.mjs):
 *   [ lender_root, withdraw_nullifier, lender_external_nullifier, recipient ]
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

template LenderWithdraw(depth) {
    // Must match LENDER_LEAF_TAG in packages/protocol/src/crypto.mjs.
    var LENDER_LEAF_TAG = 6666;

    // ---- public ----
    signal input lender_root;
    signal input withdraw_nullifier;
    signal input lender_external_nullifier;
    signal input recipient;

    // ---- private witness ----
    signal input secret;
    signal input pathIndices[depth];
    signal input siblings[depth];

    // 1. Leaf = Poseidon255(LENDER_LEAF_TAG, secret).
    component leafH = Poseidon255(2);
    leafH.in[0] <== LENDER_LEAF_TAG;
    leafH.in[1] <== secret;

    // 2. Membership: the leaf is in the tree rooted at lender_root.
    component mt = MerkleInclusion(depth);
    mt.leaf <== leafH.out;
    for (var i = 0; i < depth; i++) {
        mt.pathIndices[i] <== pathIndices[i];
        mt.siblings[i] <== siblings[i];
    }
    mt.root === lender_root;

    // 3. Nullifier W = Poseidon255(secret, lender_external_nullifier).
    component nH = Poseidon255(2);
    nH.in[0] <== secret;
    nH.in[1] <== lender_external_nullifier;
    nH.out === withdraw_nullifier;

    // 4. Range check (anti field-overflow).
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;

    // 5. Recipient binding: squaring puts the otherwise unused public input into
    //    the constraint system (as in collateral_semaphore.circom).
    signal recipient_sq;
    recipient_sq <== recipient * recipient;
}

component main {
    public [lender_root, withdraw_nullifier, lender_external_nullifier, recipient]
} = LenderWithdraw(10);
