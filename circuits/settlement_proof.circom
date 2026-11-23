pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * SettlementProof Circuit  (BLS12-381) — unlock
 *
 * Authorizes spending a SPECIFIC collateral UTxO by proving, in zero knowledge,
 * that its loan has been settled, WITHOUT revealing any value that was public at
 * borrow (so borrow and unlock cannot be linked).
 *
 * The proof attests:
 *   1. knowledge of the secret behind the spent deposit:
 *      commitment == Poseidon255(COLLATERAL_LEAF_TAG, secret). The commitment is
 *      public because it is in the spent datum anyway; binding to it prevents
 *      unlocking someone else's collateral;
 *   2. a repayment nullifier R = Poseidon255(secret, repay_external_nullifier)
 *      from the SAME secret, scoped to a DISTINCT protocol scalar so R cannot be
 *      correlated with the borrow-time loan nullifier. R is a PRIVATE witness;
 *   3. Merkle membership of R in the append-only repaid set (repaid_root), so a
 *      valid proof exists only after the loan was repaid and R was appended.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381). Compile with:
 *   circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * packages/protocol/src/crypto.mjs):
 *   [ commitment, repaid_root, repay_external_nullifier ]
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

template SettlementProof(depth) {
    // Must match COLLATERAL_LEAF_TAG in packages/protocol/src/crypto.mjs.
    var COLLATERAL_LEAF_TAG = 5555;

    // ---- public ----
    signal input commitment;
    signal input repaid_root;
    signal input repay_external_nullifier;

    // ---- private witness ----
    signal input secret;
    signal input pathIndices[depth];
    signal input siblings[depth];

    // 1. commitment == Poseidon255(COLLATERAL_LEAF_TAG, secret)
    //    (binds the proof to the exact deposit UTxO being spent).
    component c = Poseidon255(2);
    c.in[0] <== COLLATERAL_LEAF_TAG;
    c.in[1] <== secret;
    c.out === commitment;

    // 2. Repayment nullifier R = Poseidon255(secret, repay_external_nullifier).
    //    PRIVATE: never leaves the circuit as a public signal.
    component rH = Poseidon255(2);
    rH.in[0] <== secret;
    rH.in[1] <== repay_external_nullifier;

    // 3. Membership: R is a leaf of the tree rooted at repaid_root.
    component mt = MerkleInclusion(depth);
    mt.leaf <== rH.out;
    for (var i = 0; i < depth; i++) {
        mt.pathIndices[i] <== pathIndices[i];
        mt.siblings[i] <== siblings[i];
    }
    mt.root === repaid_root;

    // 4. Range check (anti field-overflow).
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;
}

component main {
    public [commitment, repaid_root, repay_external_nullifier]
} = SettlementProof(10);
