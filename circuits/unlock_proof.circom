pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * UnlockProof Circuit  (BLS12-381)
 *
 * Authorizes spending a SPECIFIC collateral UTxO on unlock. Unlike the borrow
 * proof (which hides which deposit via Merkle membership), unlock must bind to
 * the exact UTxO being spent — otherwise a spender could unlock someone else's
 * collateral. So `commitment` is public here (it is on-chain in the spent datum
 * anyway) and the proof attests:
 *   1. knowledge of the secret behind that commitment;
 *   2. the loan nullifier derived from the same secret, so the validator can
 *      require it is absent from the pool's open-loans set (repayment gate).
 *
 * Public signals (order load-bearing — mirrored in contracts/lib/zk.ak):
 *   [ commitment, loan_nullifier, external_nullifier ]
 * Private witness: secret, collateral_amount
 */
template UnlockProof() {
    // public
    signal input commitment;
    signal input loan_nullifier;
    signal input external_nullifier;
    // private
    signal input secret;
    signal input collateral_amount;

    // 1. commitment == Poseidon255(collateral_amount, secret)
    component c = Poseidon255(2);
    c.in[0] <== collateral_amount;
    c.in[1] <== secret;
    c.out === commitment;

    // 2. loan_nullifier == Poseidon255(secret, external_nullifier)  (same as borrow)
    component n = Poseidon255(2);
    n.in[0] <== secret;
    n.in[1] <== external_nullifier;
    n.out === loan_nullifier;

    // range checks
    component rc_secret = Num2Bits(254);
    rc_secret.in <== secret;
    component rc_amount = Num2Bits(64);
    rc_amount.in <== collateral_amount;
}

component main {
    public [commitment, loan_nullifier, external_nullifier]
} = UnlockProof();
