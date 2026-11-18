pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * RepayProof Circuit  (BLS12-381)
 *
 * The repayment authorization proof. It proves the loan nullifier N AND the
 * repayment nullifier R FROM THE SAME SECRET, so the R that a repay inserts into
 * `repaid_root` is bound to the exact loan being settled. A repay can therefore
 * only ever release its own deposit. It has its own verification key, so a
 * (public) borrow proof is never a valid repay proof; and a repay proof copied by
 * someone else can only settle the victim's loan with the victim's own R.
 *
 * The repayer proves, in zero knowledge:
 *   1. their collateral commitment is a member of the on-chain commitment set
 *      (group_merkle_root) — WITHOUT revealing which deposit it is;
 *   2. the collateral is (still) sufficient for the loan denomination — WITHOUT
 *      revealing the collateral amount;
 *   3. loan_nullifier = Poseidon255(secret, external_nullifier) — the SAME N that
 *      is being removed from open_loans (so the proof is bound to a real loan);
 *   4. repay_nullifier = Poseidon255(secret, repay_external_nullifier) — the R the
 *      validator inserts into repaid_root, derived from the SAME secret and scoped
 *      to the DISTINCT repay_external_nullifier so it cannot be correlated with N.
 *
 * BLS12-381 / Poseidon255 (poseidon-bls12381), so the in-circuit and on-chain
 * commitment hash are identical. Compile with:  circom --prime bls12381 -l .
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * offchain/cli/v5/common.mjs):
 *   [ group_merkle_root, loan_nullifier, repay_nullifier, loan_amount,
 *     collateral_ratio, external_nullifier, repay_external_nullifier ]
 * Private witness:
 *   secret, collateral_amount, pathIndices[depth], siblings[depth]
 */

// Merkle inclusion proof for a binary tree hashed with Poseidon255(2).
// (Same template as in collateral_semaphore.circom; kept here so the circuit is
// self-contained.)
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

template RepayProof(depth) {
    // ---- public ----
    signal input group_merkle_root;
    signal input loan_nullifier;
    signal input repay_nullifier;
    signal input loan_amount;
    signal input collateral_ratio;
    signal input external_nullifier;
    signal input repay_external_nullifier;

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

    // 3. Loan nullifier N = Poseidon255(secret, external_nullifier).
    component nH = Poseidon255(2);
    nH.in[0] <== secret;
    nH.in[1] <== external_nullifier;
    nH.out === loan_nullifier;

    // 4. Repayment nullifier R = Poseidon255(secret, repay_external_nullifier).
    //    Derived from the SAME secret as N above — this is the whole point of the
    //    circuit: R is bound to the loan being repaid.
    component rH = Poseidon255(2);
    rH.in[0] <== secret;
    rH.in[1] <== repay_external_nullifier;
    rH.out === repay_nullifier;

    // 5. Sufficiency: collateral_amount * 100 >= loan_amount * collateral_ratio.
    signal required;
    required <== loan_amount * collateral_ratio;
    signal scaled;
    scaled <== collateral_amount * 100;

    component ge = GreaterEqThan(64);
    ge.in[0] <== scaled;
    ge.in[1] <== required;
    ge.out === 1;

    // 6. Range checks (anti field-overflow).
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
    public [group_merkle_root, loan_nullifier, repay_nullifier, loan_amount, collateral_ratio, external_nullifier, repay_external_nullifier]
} = RepayProof(10);
