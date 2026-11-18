//// ============================================
//// POOL NFT — one-shot thread token for the lending pool (Milestone 3)
//// ============================================
//// Minting requires spending the `seed` UTxO and mints exactly one token named
//// `pool_nft_name`. An OutputReference can be spent only once, so exactly one
//// pool NFT can ever exist. The pool UTxO carries it: that is how the validators
//// tell the real pool from any UTxO someone pays to the pool script address.

use aiken/collection/dict
use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Transaction}
use types_v5.{pool_nft_name}

validator pool_nft(seed: OutputReference) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    let seed_spent =
      list.any(tx.inputs, fn(i) { i.output_reference == seed })
    let minted = dict.to_pairs(assets.tokens(tx.mint, policy_id))
    and {
      seed_spent?,
      (minted == [Pair(pool_nft_name, 1)])?,
    }
  }

  else(_ctx: ScriptContext) {
    fail @"Unsupported validator purpose"
  }
}
