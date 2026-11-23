# Milestone 3 — Test Results Summary

All figures are for the protocol as deployed on Preprod: two pools on the current
contracts and verification keys, one lending ADA against ADA or TOK collateral, one
lending the USD test token (see [`MILESTONE3.md`](MILESTONE3.md) §1 and §4).

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain proof and adversarial validator tests (Aiken) | `cd contracts && aiken check` | **109 / 109 pass (100 %)**, 0 warnings |
| Circuit tests (real Groth16 proofs, all five circuits) | `cd circuits && npm test` | **21 / 21 pass** |
| Protocol module, incl. golden tests against both Preprod cycles | `cd packages/protocol && npm test` | **52 / 52 pass**; 1 live test skipped without a Blockfrost key, passes with one (`npm run test:live`) |
| Reference relayer and chain reader | `cd server && npm test` | **30 / 30 pass**; 1 live test skipped without a key, passes with one |
| Live Preprod cycles | `offchain/cli/m4/run.mjs` | **20 / 20 transactions confirmed (100 %)**, all `valid_contract: true` (§3) |
| Independent break-it run on an earlier stand (pumbiii, 2026-11-18, before the asset pools and nullifier sets) | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | attacks 1–8 **rejected**; attack 9 found the unbound repayment nullifier, resolved in commit [`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3) and covered by `repay_with_foreign_repay_nullifier_fails` and `repay_with_copied_borrow_proof_fails`. The break-it run on this stand follows [runbook 4](Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-4-breakit.md). |

The golden tests (`packages/protocol/test/m3-cycle.test.mjs`) take every transaction
of both cycles from the chain and check that it was accepted, that the scripts derive
to the deployed hashes and addresses, that every pool datum, deposit datum and
redeemer re-encodes to its on-chain hash, that every pool spend moved only the loan
asset, by exactly the action's amount, that the nullifier sets rebuilt from the
history match every pool datum, that the pool datum kept its size, and that the pool
and collateral scripts were spent by reference.

### Aiken tests (109)

| Module | Tests | What they cover |
|---|---|---|
| `lib/semaphore_onchain_test` | 11 | Real BLS12-381 proofs for borrow, repay, settlement and append verify on-chain; a changed nullifier, recipient, `R`, `repaid_root` or `new_root` fails |
| `lib/lender_onchain_test` | 5 | Lender append and withdraw proofs verify on-chain; another recipient or another root fails |
| `lib/set_fixture` | 1 | The off-chain MPF library computes the same roots as the on-chain one |
| `tests/pool_nft_test` | 6 | Mint only with the seed, exactly one `POOL`, nothing else, never burned |
| `tests/v6_validator_test` | 37 | Pool identity, deposit, borrow, repay and unlock with real proofs, the loans set, the pool output (below) |
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
| Loans set and pool output | **`repay_of_settled_loan_fails`**, `borrow_rewriting_loans_set_fails`, `pool_output_with_reference_script_fails` |

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
| Borrow with a nullifier that is still open, or again after repayment (the MPF insert has no exclusion proof) | rejected | `borrow_reused_nullifier_fails`, `borrow_after_repay_same_secret_fails` |
| Repay a loan that is already settled | rejected | `repay_of_settled_loan_fails` |
| 200 loans and 200 withdrawals in the sets | the pool datum has the same size as with none | `mpf.test.mjs` |
| A relayer asked for more payouts to one key than its daily limit | refused (429) | `relayer.test.mjs` limits tests |
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

Roles on separate addresses: L lends (and minted the test tokens), D deposits, U
receives the collateral back, B receives the loan and repays, R relays borrow, unlock
and withdraw and pays their fees, P receives the withdrawn share.

**ADA pool** (`packages/protocol/deployments/preprod-m3-ada.json`; collateral 20 ADA or 500 TOK):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park the five verification keys | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) | true | 0.3174 |
| Init pool + mint pool NFT | [`3acf4248a5cb…`](https://preprod.cardanoscan.io/transaction/3acf4248a5cbffb2c3571ae7aa1c52154602d8a7fa52daf1c29d4c8bd6d5e059) | true | 0.2117 |
| Publish the reference scripts | [`5d90207c5c14…`](https://preprod.cardanoscan.io/transaction/5d90207c5c14d9185d0f97ae76c585cd45dca7b118048cc07cddaeb3a3d50791) | true | 0.6905 |
| Deposit 20 ADA (D, returns to U) | [`9f7f17cad29f…`](https://preprod.cardanoscan.io/transaction/9f7f17cad29f2e3e584728cb74e595279f23e61d8bf0e9a38bae47e918f974a3) | true | 0.5816 |
| Deposit 500 TOK (D, returns to U) | [`fa297a3a89bf…`](https://preprod.cardanoscan.io/transaction/fa297a3a89bfdcf36ee9767e65373480408536ab1ced5347529bcb91099ca926) | true | 0.5851 |
| Add liquidity: share 1 (L, 10 ADA) | [`c75f5bd192e3…`](https://preprod.cardanoscan.io/transaction/c75f5bd192e344809ef52cdf4c2eb57b478541238b0a0755b085e3758d715df9) | true | 0.5675 |
| Add liquidity: share 2 (L, 10 ADA) | [`29344705f1fa…`](https://preprod.cardanoscan.io/transaction/29344705f1fadf774f0fc8b6847aab13b4db5879ca7759c2955e8ebaca52125b) | true | 0.5722 |
| Borrow 10 ADA to B (backed by the TOK deposit), relayed by R | [`b219752d2a64…`](https://preprod.cardanoscan.io/transaction/b219752d2a646c5e67f0302ad949eacea0940913ec5f8a148a32088948fd5b42) | true | 0.5778 |
| Repay 10.5 ADA (B) | [`f854d3c38034…`](https://preprod.cardanoscan.io/transaction/f854d3c380343d1bc5e4857aa4b1a4f77e4fa2c13e1eeb1b5637181f52135aa9) | true | 0.7777 |
| Unlock 500 TOK to U, relayed by R | [`101b958540d6…`](https://preprod.cardanoscan.io/transaction/101b958540d60b074b13c8bada78e6ab4f872d6917255e9bb2517f03f2f55048) | true | 0.4162 |
| Withdraw one share (10.25 ADA) to P, relayed by R | [`b4c42d0cb457…`](https://preprod.cardanoscan.io/transaction/b4c42d0cb457679afa75166c13ccd943675840cdec8e9a6ccc82ef5b14ac5496) | true | 0.5801 |

**USD pool** (`packages/protocol/deployments/preprod-m3-usd.json`; loan asset USD, same keys and collateral list):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Init pool + mint pool NFT | [`baaafc06a45d…`](https://preprod.cardanoscan.io/transaction/baaafc06a45dc37979c2a82e2e95a6adb8ddf25811b5069ee9c98e8197d9ae15) | true | 0.2077 |
| Publish the reference scripts | [`c7914adc284d…`](https://preprod.cardanoscan.io/transaction/c7914adc284dfbadf136669b998a0561f3a6860c6f33d544df903acbf22a791d) | true | 0.6937 |
| Deposit 20 ADA (D, returns to U) | [`183cee42f264…`](https://preprod.cardanoscan.io/transaction/183cee42f2640b347296ef4ae110d28b368d09ecf4dcaf58b8b4fa844d2601c7) | true | 0.5815 |
| Add liquidity: share 1 (L, 10 USD) | [`47ae6dcf07a1…`](https://preprod.cardanoscan.io/transaction/47ae6dcf07a1961d1c24fa4afa7fc0c146eb404153212a6b5f85cc54183adc28) | true | 0.5703 |
| Add liquidity: share 2 (L, 10 USD) | [`8d9f883bc622…`](https://preprod.cardanoscan.io/transaction/8d9f883bc622d7b9cfc63ed8654b6af172b5b838a6d1d535cd6a2eb82102f9c8) | true | 0.5729 |
| Borrow 10 USD to B, relayed by R | [`a7f3f565da9d…`](https://preprod.cardanoscan.io/transaction/a7f3f565da9d33b42ed1a35d2f0393d775228178c8a61823b85a4a37d83f2624) | true | 0.5841 |
| Repay 10.5 USD (B) | [`c1ce59019185…`](https://preprod.cardanoscan.io/transaction/c1ce59019185b7c3cdddd578fad1bb1d9ed45d74be8a0b6d61d71300e4e67517) | true | 0.7790 |
| Unlock 20 ADA to U, relayed by R | [`ea7dc16ccec4…`](https://preprod.cardanoscan.io/transaction/ea7dc16ccec44d237932dc0f3dbb563e404eb084a69c33ecc893c8a254c15a47) | true | 0.4109 |
| Withdraw one share (10.25 USD) to P, relayed by R | [`ed53a299f0d3…`](https://preprod.cardanoscan.io/transaction/ed53a299f0d3263efd6298331d225a34baa339c42ca79b98de4509c604fa26bf) | true | 0.5864 |

Funding outside the protocol: D received its TOK from L, and B received 40 ADA and
1 USD for the interest from L ([`8d771bc79bbf…`](https://preprod.cardanoscan.io/transaction/8d771bc79bbfdb08ff87d57f1864a5e595525a3590a280bd56c353bc871aa309)); R was funded by L.
Nothing passed between D and B.

Economics: in both pools two shares of 10 bought, one loan of 10 repaid with 0.5
interest, so a share is worth 10.25 and one was paid out at that price. The TOK
collateral came back whole (500 TOK and its ADA).

**Operational notes (for reproducing testers).**
- **Evaluation.** The Mesh builder evaluates every transaction via Blockfrost before
  submitting, so a transaction a validator would reject is never submitted.
- **Index lag.** Blockfrost's UTxO index lags block confirmation by seconds; the CLI
  waits until the outputs are indexed.
- **Collateral UTxO.** Script transactions need a pure-ADA UTxO for Cardano
  collateral; the client creates one when the wallet has none.
- **Pool check.** Before every step the client runs `verifyPool`; a pool that was not
  initialized honestly is refused.

## 4. Performance

**On-chain verification cost (measured live).** Preprod limits per transaction:
17,500,000 memory / 10,000,000,000 CPU steps.

| Tx | Proofs verified | Memory | CPU steps | of the CPU limit | Fee (ADA) |
|---|---|---|---|---|---|
| Add liquidity | append | 529,267 | 2,580,378,519 | 26 % | 0.57 |
| Deposit (ADA / TOK) | append | 612,406 / 615,042 | 2,607,769,998 / 2,607,210,181 | 26 % | 0.58 |
| Borrow | borrow + MPF insert | 598,335 | 2,605,451,995 | 26 % | 0.58 |
| Repay | repay + append + MPF update | 690,582 | 5,151,030,842 | 52 % | 0.78 |
| Unlock | settlement | 336,380 | 2,373,206,815 | 24 % | 0.42 |
| Withdraw a share | lender withdraw + MPF insert | 625,870 | 2,618,035,308 | 26 % | 0.58 |

Figures from the ADA pool; in the USD pool the CPU steps differ by less than 1 %. A
single on-chain `groth_verify` costs about 2.3–2.6 B CPU steps; an MPF insert or update
adds little. Every step fits in one transaction with room to spare (repay, the only
step with two proofs, uses about half of the CPU budget and 4 % of the memory). The
scripts are spent by reference, and the pool datum keeps its size, so these costs do
not grow with the number of loans.

**Proof generation (off-chain, Node CLI on a laptop).** Append 1.4–1.6 s, borrow
1.0 s, repay 1.3 s, settlement 1.0 s, lender withdraw 1.0 s.
