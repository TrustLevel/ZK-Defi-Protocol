//// One-shot pool NFT: minting requires spending the seed UTxO and mints exactly
//// one token named `pool_nft_name`, so exactly one pool NFT can ever exist.

use cardano/address.{from_verification_key}
use cardano/assets.{from_asset, from_lovelace, merge}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction, placeholder}
use types_v5.{pool_nft_name}
use v5/pool_nft

const seed: OutputReference =
  OutputReference { transaction_id: #"5eed", output_index: 0 }

const policy: ByteArray = #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

fn input(oref: OutputReference) -> Input {
  Input {
    output_reference: oref,
    output: Output {
      address: from_verification_key(#"aa"),
      value: from_lovelace(5_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

test mint_with_seed_succeeds() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(seed)],
      mint: from_asset(policy, pool_nft_name, 1),
    }
  pool_nft.pool_nft.mint(seed, Void, policy, tx)
}

test mint_without_seed_fails() {
  let other = OutputReference { transaction_id: #"0123", output_index: 0 }
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(other)],
      mint: from_asset(policy, pool_nft_name, 1),
    }
  !pool_nft.pool_nft.mint(seed, Void, policy, tx)
}

test mint_two_fails() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(seed)],
      mint: from_asset(policy, pool_nft_name, 2),
    }
  !pool_nft.pool_nft.mint(seed, Void, policy, tx)
}

test mint_other_name_fails() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(seed)],
      mint: from_asset(policy, "FAKE", 1),
    }
  !pool_nft.pool_nft.mint(seed, Void, policy, tx)
}

test mint_extra_token_fails() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(seed)],
      mint: merge(
        from_asset(policy, pool_nft_name, 1),
        from_asset(policy, "EXTRA", 1),
      ),
    }
  !pool_nft.pool_nft.mint(seed, Void, policy, tx)
}

test burn_fails() {
  // The pool NFT can never be burned: the policy only accepts the single mint.
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input(seed)],
      mint: from_asset(policy, pool_nft_name, -1),
    }
  !pool_nft.pool_nft.mint(seed, Void, policy, tx)
}
