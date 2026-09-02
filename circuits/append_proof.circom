pragma circom 2.0.0;

include "circomlib/circuits/bitify.circom";
include "./lib/poseidon255.circom";

/**
 * MerkleAppend Circuit  (BLS12-381)
 *
 * Proves — in zero knowledge, WITHOUT any admin — that a leaf R was correctly
 * appended to an append-only Merkle tree at the next free position, taking the
 * tree from `old_root` to `new_root`. Used by RepayAnonymous so a borrower can
 * insert their repayment nullifier R into the pool's `repaid_root` themselves
 * (permissionless), which is what later lets them prove settlement at unlock.
 *
 * Correctness of the insertion is enforced by proving BOTH:
 *   1. position `index` was EMPTY (leaf 0) in the old tree — same path/siblings —
 *      giving `old_root`  (this rules out overwriting an occupied slot);
 *   2. the SAME path with leaf R gives `new_root`.
 * The validator binds `index == pool.next_index` and `next_index += 1`, so the
 * tree fills left-to-right with no gaps and no overwrite. The siblings are a
 * private witness; they are pinned by `old_root == pool.repaid_root` (finding a
 * different set that hashes to the same root is a Poseidon collision).
 *
 * Public signals (order is load-bearing — mirrored in contracts/lib/zk.ak and
 * offchain/cli/v5/common.mjs):
 *   [ old_root, new_root, leaf, index ]
 * Private witness:
 *   siblings[depth]
 */

// Merkle inclusion proof for a binary tree hashed with Poseidon255(2).
// (Copied verbatim from collateral_semaphore.circom to keep this circuit
// self-contained and avoid recompiling the working circuits.)
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

template MerkleAppend(depth) {
    // ---- public ----
    signal input old_root;
    signal input new_root;
    signal input leaf;   // R = the repayment nullifier being inserted
    signal input index;  // next free position (0-based)

    // ---- private witness ----
    signal input siblings[depth];

    // Decompose index into path bits (LSB first, matching the off-chain
    // merkleProof convention). Num2Bits(depth) also range-checks index < 2^depth.
    component idxBits = Num2Bits(depth);
    idxBits.in <== index;

    // 1. In the OLD tree, position `index` held the empty leaf (0).
    component mtOld = MerkleInclusion(depth);
    mtOld.leaf <== 0;
    for (var i = 0; i < depth; i++) {
        mtOld.pathIndices[i] <== idxBits.out[i];
        mtOld.siblings[i] <== siblings[i];
    }
    mtOld.root === old_root;

    // 2. The SAME path with leaf = R yields the new root.
    component mtNew = MerkleInclusion(depth);
    mtNew.leaf <== leaf;
    for (var i = 0; i < depth; i++) {
        mtNew.pathIndices[i] <== idxBits.out[i];
        mtNew.siblings[i] <== siblings[i];
    }
    mtNew.root === new_root;
}

component main {
    public [old_root, new_root, leaf, index]
} = MerkleAppend(10);
