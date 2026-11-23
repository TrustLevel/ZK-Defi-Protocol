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
