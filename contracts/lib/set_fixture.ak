//// MPF roots for the validator tests: the empty set and one-element sets. A
//// one-element set's proof for its own key is the empty proof, and so is the
//// proof that a key is missing from the empty set.

use aiken/collection/list
use aiken/merkle_patricia_forestry as mpf
use types_v5.{loan_open, loan_settled, note_withdrawn, nullifier_key}

pub const empty_root: ByteArray = mpf.root(mpf.empty)

/// The root of the set holding only `n` with `value`.
pub fn one(n: Int, value: ByteArray) -> ByteArray {
  mpf.root(mpf.insert(mpf.empty, nullifier_key(n), value, []))
}

/// The loans set for the old list-shaped test states, for a single nullifier:
/// nothing used -> empty; used and still open -> open; used and repaid -> settled.
pub fn loans_of(n: Int, open: List<Int>, used: List<Int>) -> ByteArray {
  if list.has(used, n) {
    if list.has(open, n) {
      one(n, loan_open)
    } else {
      one(n, loan_settled)
    }
  } else {
    empty_root
  }
}

/// The withdrawn set after `w` was paid out.
pub fn withdrawn_one(w: Int) -> ByteArray {
  one(w, note_withdrawn)
}

// The off-chain library (@aiken-lang/merkle-patricia-forestry 1.3.1, used by
// packages/protocol/src/mpf.mjs) computes the same roots for the fixture
// nullifiers: the two sides agree on keys, values and hashing.
test offchain_roots_match_onchain() {
  let n =
    13363567938272564440676172658199675024663324988111273564368569843933911498447
  let w =
    46613878515795455735721080862132426043599913500427258484958575387200077754859
  and {
    one(n, loan_open) == #"8129bde90e5fab98a3420d7280cb757e21b6115446864fd04e431c71c9b25702",
    one(n, loan_settled) == #"e874017f593ffe0f9f6e4126ca97e3138001c2b513bfdc616fa7515b90bd9469",
    withdrawn_one(w) == #"e34fe6d6d3ac658c8089f965488d0cb95306bd7986a7ff509d718debb4da3a27",
    empty_root == #"0000000000000000000000000000000000000000000000000000000000000000",
  }
}
