pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * SettlementProof Circuit  (BLS12-381)
 *
 * Authorizes spending a SPECIFIC collateral UTxO on unlock by proving, in zero
 * knowledge, that the loan has been settled — WITHOUT revealing any value that
 * was public at borrow. This closes the "Leak 2" de-anonymization vector where
 * the old unlock redeemer revealed `loan_nullifier` (a value already public at
 * borrow), letting a chain analyst re-link borrow -> unlock -> deposit.
 *
 * The proof attests:
 *   1. knowledge of the secret behind the spent commitment
 *      (commitment == Poseidon255(collateral_amount, secret)); commitment is
 *      public because it is on-chain in the spent datum anyway, and binding to
 *      it prevents unlocking someone else's collateral;
 *   2. a repayment nullifier R = Poseidon255(secret, repay_external_nullifier),
 *      derived from the SAME secret but scoped to a DISTINCT protocol scalar
 *      (repay_external_nullifier) so R cannot be correlated with the borrow-time
 *      loan_nullifier — R is a PRIVATE witness, never revealed;
 *   3. Merkle membership of R in the append-only repaid-set (repaid_root), so a
 *      valid proof exists only after the loan was repaid and R was inserted.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381), so the in-circuit and on-chain
 * commitment hash are identical. Compile with:  circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * offchain/cli/v5/common.mjs):
 *   [ commitment, repaid_root, repay_external_nullifier ]
 * Private witness:
 *   secret, collateral_amount, pathIndices[depth], siblings[depth]
 */

// Merkle inclusion proof for a binary tree hashed with Poseidon255(2).
// (Copied verbatim from collateral_semaphore.circom to keep this circuit
// self-contained and avoid recompiling the working borrow circuit.)
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

template SettlementProof(depth) {
    // ---- public ----
    signal input commitment;
    signal input repaid_root;
    signal input repay_external_nullifier;

    // ---- private witness ----
    signal input secret;
    signal input collateral_amount;
    signal input pathIndices[depth];
    signal input siblings[depth];

    // 1. commitment == Poseidon255(collateral_amount, secret)
    //    (binds the proof to the exact deposit UTxO being spent).
    component c = Poseidon255(2);
    c.in[0] <== collateral_amount;
    c.in[1] <== secret;
    c.out === commitment;

    // 2. Repayment nullifier R = Poseidon255(secret, repay_external_nullifier).
    //    PRIVATE — never leaves the circuit as a public signal.
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

    // 4. Range checks (anti field-overflow), mirroring the borrow circuit.
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;
    component rc_amount = Num2Bits(64);
    rc_amount.in <== collateral_amount;
}

component main {
    public [commitment, repaid_root, repay_external_nullifier]
} = SettlementProof(10);
