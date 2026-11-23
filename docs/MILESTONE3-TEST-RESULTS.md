# Milestone 3 — Test Results Summary

All figures are for the protocol as deployed on Preprod: two pools on the current
contracts and verification keys, one lending ADA against ADA or TOK collateral, one
lending the USD test token (see [`MILESTONE3.md`](MILESTONE3.md) §1 and §4).

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain proof and adversarial validator tests (Aiken) | `cd contracts && aiken check` | **107 / 107 pass (100 %)** |
| Circuit tests (real Groth16 proofs, all five circuits) | `cd circuits && node --test tests/collateral-circuits.test.mjs tests/lender-withdraw.test.mjs` | **21 / 21 pass** |
| Protocol module, incl. golden tests against both Preprod cycles | `cd packages/protocol && npm test` | **41 / 41 pass** |
| Reference relayer | `cd server && npm test` | **27 / 27 pass** |
| Live Preprod cycles | `offchain/cli/m4/run.mjs` | **18 / 18 transactions confirmed (100 %)**, all `valid_contract: true` (§3) |
| Independent break-it run (pumbiii, 2026-11-18, own pool and wallet) | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | attacks 1–8 **rejected**; attack 9 found the unbound repayment nullifier, resolved in commit [`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3) and covered by `repay_with_foreign_repay_nullifier_fails` and `repay_with_copied_borrow_proof_fails` |

The golden tests (`packages/protocol/test/m3-cycle.test.mjs`) take every transaction
of both cycles from the chain and check that it was accepted, that the scripts derive
to the deployed hashes and addresses, that every pool datum, deposit datum and
redeemer re-encodes to its on-chain hash, and that every pool spend moved only the
loan asset, by exactly the action's amount.

### Aiken tests (107)

| Module | Tests | What they cover |
|---|---|---|
| `lib/semaphore_onchain_test` | 11 | Real BLS12-381 proofs for borrow, repay, settlement and append verify on-chain; a changed nullifier, recipient, `R`, `repaid_root` or `new_root` fails |
| `lib/lender_onchain_test` | 5 | Lender append and withdraw proofs verify on-chain; another recipient or another root fails |
| `lib/zk_onchain_test` | 2 | Legacy fixture of the verifier wrapper |
| `tests/pool_nft_test` | 6 | Mint only with the seed, exactly one `POOL`, nothing else, never burned |
| `tests/v6_validator_test` | 34 | Pool identity, deposit, borrow, repay and unlock with real proofs (below) |
| `tests/lender_test` | 26 | Share purchase and withdrawal, free liquidity, lender fields frozen on borrower paths |
| `tests/asset_test` | 23 | Token pool, several collateral assets, value movement, token unlock (below) |

**Borrower path** (`v6_validator_test`):

| Area | Tests |
|---|---|
| Pool identity | `spend_pool_without_nft_fails`, `continuing_output_without_nft_fails`, `continuing_output_other_address_fails`, `borrow_with_vkey_at_other_ref_fails`, `group_root_change_without_append_fails` |
| Deposit | `deposit_collateral_succeeds`, `_wrong_amount_fails`, `_wrong_address_fails`, `_commitment_mismatch_fails`, `_bogus_append_fails`, `_index_not_advanced_fails` |
| Borrow | `borrow_membership_succeeds`, `borrow_reused_nullifier_fails`, **`borrow_after_repay_same_secret_fails`**, `borrow_not_recorded_as_used_fails`, **`borrow_payout_to_other_key_fails`**, `borrow_underpays_recipient_fails`, `borrow_redeemer_recipient_swapped_fails` |
| Repay | `repay_principal_plus_interest_succeeds`, `repay_below_interest_fails`, `repay_overpay_fails`, `repay_bogus_append_fails`, `repay_clearing_used_nullifier_fails`, **`repay_with_foreign_repay_nullifier_fails`**, **`repay_with_copied_borrow_proof_fails`** |
| Unlock | `unlock_when_settled_succeeds`, **`unlock_without_repay_fails`**, `unlock_wrong_commitment_fails`, **`unlock_via_forged_pool_ref_fails`**, `unlock_with_vkey_at_other_ref_fails`, **`unlock_to_other_address_fails`**, `unlock_underpays_recipient_fails`, `unlock_payout_tagged_for_other_deposit_fails`, `unlock_redeemer_carries_no_loan_nullifier` |

**Lender path** (`lender_test`):

| Area | Tests |
|---|---|
| Add a share | `add_first_share_at_start_price_succeeds`, `add_first_share_overpaid_fails`, `add_first_share_underpaid_fails`, `add_share_without_share_count_fails`, `add_share_index_not_advanced_fails`, `add_share_with_wrong_append_proof_fails`, `add_share_touching_borrower_fields_fails`, `add_second_share_at_grown_price_succeeds`, `add_second_share_at_start_price_fails`, `add_share_counts_outstanding_loans` |
| Withdraw a share | `withdraw_share_succeeds`, **`withdraw_same_note_twice_fails`**, **`withdraw_redirected_to_other_key_fails`**, `withdraw_paid_to_other_key_fails`, `withdraw_more_than_price_fails`, `withdraw_underpays_recipient_fails`, `withdraw_payout_without_tag_fails`, `withdraw_not_recorded_fails`, `withdraw_share_count_kept_fails`, `withdraw_rewriting_lender_root_fails`, `withdraw_with_loans_out_from_free_liquidity_succeeds`, **`withdraw_beyond_free_liquidity_fails`** |
| Free liquidity | `borrow_lends_more_than_half_the_liquidity`, `borrow_from_reserve_fails`, `borrow_touching_lender_fields_fails`, `borrow_spending_withdraw_nullifier_set_fails` |

**Assets** (`asset_test`):

| Area | Tests |
|---|---|
| Token pool: borrow | `token_borrow_succeeds`, `token_borrow_paid_in_ada_fails`, **`token_borrow_takes_pool_ada_fails`**, `token_borrow_takes_more_tokens_fails`, **`token_borrow_adds_foreign_token_to_pool_fails`**, `borrow_rewriting_loan_asset_fails` |
| Token pool: repay | `token_repay_succeeds`, `token_repay_in_ada_fails`, `token_repay_below_interest_fails` |
| Token pool: withdraw | `token_withdraw_share_succeeds`, `token_withdraw_paid_in_ada_fails` |
| Collateral assets | `deposit_ada_collateral_in_token_pool_succeeds`, **`deposit_second_collateral_asset_succeeds`**, `deposit_second_asset_wrong_amount_fails`, `deposit_ada_under_token_index_fails`, `deposit_token_under_ada_index_fails`, `deposit_unlisted_asset_index_fails`, `deposit_negative_asset_index_fails`, **`deposit_rewriting_collateral_assets_fails`** |
| Token unlock | `unlock_token_collateral_succeeds`, `unlock_token_collateral_paid_in_ada_fails`, `unlock_token_collateral_short_of_token_fails`, `unlock_token_collateral_without_its_min_ada_fails` |

### Circuit tests (21)

For borrow, repay and settlement (`collateral-circuits.test.mjs`) and lender withdraw
(`lender-withdraw.test.mjs`): a valid proof verifies and exposes exactly the
documented public signals (borrow and repay carry no amount, ratio or asset); a
changed public signal fails; a wrong secret, a leaf outside the set and a nullifier
from another scope cannot produce a witness; a borrow proof does not verify as a
repay proof; an unlock without repayment, or for another deposit, cannot produce a
witness.

## 2. Edge case scenarios

Each scenario is a test from §1; it passes when the script behaves as stated.

| Edge case | Expected | Test |
|---|---|---|
| Deposit 1 ADA below the denomination (19 instead of 20 ADA) | rejected | `deposit_collateral_wrong_amount_fails` |
| Deposit of 499 instead of 500 TOK | rejected | `deposit_second_asset_wrong_amount_fails` |
| Deposit names the token but locks 20 ADA, or names ADA but locks the token | rejected | `deposit_ada_under_token_index_fails`, `deposit_token_under_ada_index_fails` |
| Deposit names an asset index outside the list, or a negative one | rejected | `deposit_unlisted_asset_index_fails`, `deposit_negative_asset_index_fails` |
| Any spend rewrites the accepted collateral list or the loan asset | rejected | `deposit_rewriting_collateral_assets_fails`, `borrow_rewriting_loan_asset_fails` |
| Appended commitment differs from the locked one | rejected | `deposit_collateral_commitment_mismatch_fails` |
| Borrow with a nullifier that is still open, or again after repayment | rejected | `borrow_reused_nullifier_fails`, `borrow_after_repay_same_secret_fails` |
| Token loan paid out in ADA, or the pool's own ADA taken along | rejected | `token_borrow_paid_in_ada_fails`, `token_borrow_takes_pool_ada_fails` |
| A foreign token pushed into the pool UTxO | rejected | `token_borrow_adds_foreign_token_to_pool_fails` |
| Loan paid out from the reserve | rejected | `borrow_from_reserve_fails` |
| Repay principal only, more than due, or in ADA for a token loan | rejected | `repay_below_interest_fails`, `repay_overpay_fails`, `token_repay_in_ada_fails` |
| Repay that appends another deposit's `R` | rejected | `repay_with_foreign_repay_nullifier_fails` |
| Repay with a borrow proof instead of a repay proof | rejected | `repay_with_copied_borrow_proof_fails` |
| Unlock while `repaid_root` does not contain `R` | rejected | `unlock_without_repay_fails` |
| Token collateral returned without its token, short, or without its min ADA | rejected | `unlock_token_collateral_*_fails` |
| One payout output used for two deposits (double satisfaction) | rejected | `unlock_payout_tagged_for_other_deposit_fails` |
| The same lender note withdrawn twice | rejected | `withdraw_same_note_twice_fails` |
| Share withdrawn while the free liquidity does not cover it | rejected | `withdraw_beyond_free_liquidity_fails` |
| Share price paid to another key than the proof binds | rejected | `withdraw_redirected_to_other_key_fails` |
| First and second share bought at start price and at the grown price | accepted at the right price | `add_first_share_at_start_price_succeeds`, `add_second_share_at_grown_price_succeeds` |
| Public signal changed by one (each circuit) | rejected | `tampered_*_signal_fails_onchain`, circuit tests |
| Mint two pool NFTs, an extra token, another name, or burn the NFT | rejected | `mint_two_fails`, `mint_extra_token_fails`, `mint_other_name_fails`, `burn_fails` |

## 3. Live Preprod cycles (confirmed)

Accounts: A (deposits, lends), B (an unrelated wallet: receives loans and share
payouts, repays), relayer (submits borrow, unlock and withdraw and pays their fees).

**ADA pool** (`packages/protocol/deployments/preprod-m3-ada.json`; collateral 20 ADA or 500 TOK):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park the five verification keys | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) | true | 0.3174 |
| Init pool + mint pool NFT | [`23ad89841705…`](https://preprod.cardanoscan.io/transaction/23ad898417055e231c585d1a12398a5892eb04688b258913cc5d66a6fa6cffa0) | true | 0.2036 |
| Add liquidity: share 1 (10 ADA) | [`13f3793d1a45…`](https://preprod.cardanoscan.io/transaction/13f3793d1a45e1d59bc4e682dd87f819198fde8b956256abccc25e2f4754a914) | true | 0.7258 |
| Add liquidity: share 2 (10 ADA) | [`2c62c4cfe0e1…`](https://preprod.cardanoscan.io/transaction/2c62c4cfe0e1592a4f151b185118217c43ce21d2a5e72abfe1906fd395376c6e) | true | 0.7303 |
| Deposit 20 ADA | [`8d944e16e29d…`](https://preprod.cardanoscan.io/transaction/8d944e16e29d18ac2b1a92a806cebcb411a47c72846fcc8e60fcb2eb037b26af) | true | 0.7430 |
| Deposit 500 TOK | [`a3cd4c5ce665…`](https://preprod.cardanoscan.io/transaction/a3cd4c5ce665c847e8cae525ae31b31ec2d193ca4c7afcfbc0159f2a4caadb71) | true | 0.7434 |
| Borrow 10 ADA (backed by the TOK deposit), relayed | [`581389f0d725…`](https://preprod.cardanoscan.io/transaction/581389f0d725b83137788cd22e3bcf817cf500962f9a0bfe3f5e3bb181345b26) | true | 0.7390 |
| Repay 10.5 ADA | [`19dc3cbfd6a9…`](https://preprod.cardanoscan.io/transaction/19dc3cbfd6a97a6e587653a47deb3ac258dff05177ef4fc2640b03fbb0a45da3) | true | 0.9333 |
| Unlock 500 TOK, relayed | [`348685706bbb…`](https://preprod.cardanoscan.io/transaction/348685706bbb2689c5882d79e4ae55514323f278c59feea8b97798e167e4fda1) | true | 0.4769 |
| Withdraw one share (10.25 ADA), relayed | [`f37d96ec8826…`](https://preprod.cardanoscan.io/transaction/f37d96ec8826d1d812103d50688be90cd4896823b873006a6295f378979998b0) | true | 0.7422 |

**USD pool** (`packages/protocol/deployments/preprod-m3-usd.json`; loan asset USD, same keys and collateral list):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Init pool + mint pool NFT | [`c91b566c4aaf…`](https://preprod.cardanoscan.io/transaction/c91b566c4aaf84e13e7f17a2fee1e742cf6c00c4d04a6ab65b9aedec571d13a9) | true | 0.2048 |
| Add liquidity: share 1 (10 USD) | [`e5e1f43ce837…`](https://preprod.cardanoscan.io/transaction/e5e1f43ce8378f23f6d9e23ac7f0ec8bc0fdf013b9fb03341e0376554d1d5bf2) | true | 0.7279 |
| Add liquidity: share 2 (10 USD) | [`294cffbce1f5…`](https://preprod.cardanoscan.io/transaction/294cffbce1f504496a8228db34f1e7ad39a93a8a34673ae3149f34555f624679) | true | 0.7315 |
| Deposit 20 ADA | [`252509926273…`](https://preprod.cardanoscan.io/transaction/252509926273465b1f7aea03244d602b2ca02196f597a5a6ab08a56d336c7ea1) | true | 0.7450 |
| Borrow 10 USD, relayed | [`c62b2f4142d9…`](https://preprod.cardanoscan.io/transaction/c62b2f4142d9215076db2c335bb575a63a1caa419b8f90ad30c37da55aeddd24) | true | 0.7456 |
| Repay 10.5 USD | [`44cc6137bdcc…`](https://preprod.cardanoscan.io/transaction/44cc6137bdccca08b801982cb3dd073439cf638eecfe7e94c0dc6392b53ed2bd) | true | 0.9390 |
| Unlock 20 ADA, relayed | [`2f14bc8f5554…`](https://preprod.cardanoscan.io/transaction/2f14bc8f5554b0224f943b389c0563b2f42f46cf8c799b50406d4638b51e5295) | true | 0.4722 |
| Withdraw one share (10.25 USD), relayed | [`913e5f21c68f…`](https://preprod.cardanoscan.io/transaction/913e5f21c68fc6a56e59755ebe789622187c2d68c57eab7dc17d5245e40a1a2e) | true | 0.7481 |

Before the USD repay, B received 1 USD from A as test funding for the interest
([`b12b32f76058…`](https://preprod.cardanoscan.io/transaction/b12b32f7605850e4efecdcd09c6125ae0c5371989e7b70631d73df5e7fa14e93));
in use, a borrower holds the loan asset from elsewhere.

Economics: in both pools two shares of 10 bought, one loan of 10 repaid with 0.5
interest, so a share is worth 10.25 and one was paid out at that price. The TOK
collateral came back whole (500 TOK and its ADA).

**Operational notes (for reproducing testers).**
- **Evaluation.** The Mesh builder evaluates every transaction via Blockfrost before
  submitting, so a transaction a validator would reject is never submitted.
- **Index lag.** Blockfrost's UTxO index lags block confirmation by seconds; the CLI
  waits until the outputs are indexed.
- **Collateral UTxO.** Script transactions need a pure-ADA UTxO for Cardano
  collateral; `deploy` creates the two it needs.

## 4. Performance

**On-chain verification cost (measured live).** Preprod limits per transaction:
17,500,000 memory / 10,000,000,000 CPU steps.

| Tx | Proofs verified | Memory | CPU steps | of the CPU limit | Fee (ADA) |
|---|---|---|---|---|---|
| Add liquidity | append | 542,413 | 2,586,290,452 | 26 % | 0.73 |
| Deposit (ADA / TOK) | append | 620,362 / 622,998 | 2,610,667,465 / 2,610,107,648 | 26 % | 0.74 |
| Borrow | borrow | 608,145 | 2,611,491,401 | 26 % | 0.74 |
| Repay | repay + append | 679,818 | 5,144,774,383 | 51 % | 0.93 |
| Unlock | settlement | 337,318 | 2,368,362,245 | 24 % | 0.48 |
| Withdraw a share | lender withdraw | 629,084 | 2,619,748,944 | 26 % | 0.74 |

Figures from the ADA pool; the USD pool is within 3 % of them. A single on-chain
`groth_verify` costs about 2.3–2.6 B CPU steps, and every step fits in one
transaction with room to spare (repay, the only step with two proofs, uses about half
of the CPU budget and 4 % of the memory).

**Proof generation (off-chain, Node CLI on a laptop).** Append 1.4–1.6 s, borrow
1.0 s, repay 1.3 s, settlement 1.0 s, lender withdraw 1.0 s.
