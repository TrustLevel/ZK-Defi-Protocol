# Milestone 3 — Test Results Summary

All figures are for the protocol as deployed on Preprod: two pools on the current
contracts and verification keys, one lending ADA against ADA or TOK collateral, one
lending the USD test token (see [`MILESTONE3.md`](MILESTONE3.md) §1 and §4).

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain proof and adversarial validator tests (Aiken) | `cd contracts && aiken check` | **109 / 109 pass (100 %)**, 0 warnings |
| Circuit tests (real Groth16 proofs, all five circuits) | `cd circuits && npm test` | **21 / 21 pass** |
| Protocol module, incl. golden tests against both Preprod cycles | `cd packages/protocol && npm test` | **63 / 63 pass**; 1 live test skipped without a Blockfrost key, passes with one (`npm run test:live`) |
| Reference relayer and chain reader | `cd server && npm test` | **30 / 30 pass**; 1 live test skipped without a key, passes with one |
| Live Preprod cycles | `offchain/cli/m4/run.mjs` | **34 / 34 transactions confirmed (100 %)**, all `valid_contract: true` (§3) |
| Independent break-it run on an earlier stand (pumbiii, 2026-11-18, before the asset pools and nullifier sets) | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | attacks 1–8 **rejected**; attack 9 found the unbound repayment nullifier, resolved in commit [`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3) and covered by `repay_with_foreign_repay_nullifier_fails` and `repay_with_copied_borrow_proof_fails`. |
| Independent negative-test run on this stand (pumbiii, 2026-11-25, `m3-v6-rc3`) | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-25.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-25.md) | validator suite 109/109; all 16 negative cases confirmed against their tests; live sample: unlock without repay and a second share withdrawal **refused**; no invalid transaction accepted. Found that the client's pool check missed the nullifier scalars and parameters at init; fixed in commit [`ce46d49`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/ce46d49) (`verify-pool.test.mjs`) and confirmed live by the tester. |

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
| A pool initialized with other nullifier scalars, an interest rate above 100 %, a zero denomination or share price, no accepted collateral, or a reserve that was not paid in | refused by the client before any step | `verify-pool.test.mjs` |
| The park address of the verification keys and reference scripts is spendable | no: it derives from the always-false program, and its only preimage is not a well-formed script | `park.test.mjs` |
| Mint two pool NFTs, an extra token, another name, or burn the NFT | rejected | `mint_two_fails`, `mint_extra_token_fails`, `mint_other_name_fails`, `burn_fails` |

## 3. Live Preprod cycles (confirmed)

Every unit on its own address: lenders L1–L5 (one share each), depositors D1–D6 (one
deposit each, returning to U1–U6), borrowers B1–B5 (one loan each, repaid by the same
address), share payouts P1–P3, and one relayer R that submits every borrow, unlock and
withdrawal and pays their fees. The steps are listed in the order they ran.

**ADA pool** (`packages/protocol/deployments/preprod-m3-ada.json`; collateral 20 ADA or 500 TOK):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park the five verification keys (shared by both pools) | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) | true | 0.3174 |
| Init pool + mint pool NFT | [`ebbbd9ce3fcd…`](https://preprod.cardanoscan.io/transaction/ebbbd9ce3fcdec1b27bcc1d0eaee533a7a9332f680f00a8f017ace58656bb6e4) | true | 0.2103 |
| Publish the reference scripts | [`55348bcf783a…`](https://preprod.cardanoscan.io/transaction/55348bcf783aa4e38b0996de8bbaaabb97b33b61a8054c80495e2445baad1ee7) | true | 0.6905 |
| Share 1 (L1, 10 ADA) | [`47c90f873587…`](https://preprod.cardanoscan.io/transaction/47c90f873587128ed0e99d6ea89efa562fbaa08a60d92d48246ceba45bf4c513) | true | 0.5657 |
| Deposit 20 ADA (D1, returns to U1) | [`fbdb8c49dfd1…`](https://preprod.cardanoscan.io/transaction/fbdb8c49dfd1f128822122e4325c4afc98a05628c89b88899010b8c3f641805f) | true | 0.5793 |
| Deposit 500 TOK (D2, returns to U2) | [`5e20e61c3f25…`](https://preprod.cardanoscan.io/transaction/5e20e61c3f25d562a6372ac09643420ff4ab72fb2adf9e9d5b0f11a2de1930f4) | true | 0.5840 |
| Share 2 (L2, 10 ADA) | [`59057ef21172…`](https://preprod.cardanoscan.io/transaction/59057ef21172017b4b2e5eadb86660bf377ce68714d5e17412bc708324e6cd55) | true | 0.5665 |
| Deposit 20 ADA (D3, returns to U3) | [`f48900afae66…`](https://preprod.cardanoscan.io/transaction/f48900afae6630f26ffb4aa67a3a7f77460b88a1d469b53e6729dab1483750f0) | true | 0.5793 |
| Borrow 10 ADA to B1, relayed by R | [`97403cf130ae…`](https://preprod.cardanoscan.io/transaction/97403cf130aed8a7d807afedb8bb9739256983357990fc7f7443d7b8eac5cd1e) | true | 0.5782 |
| Deposit 500 TOK (D4, returns to U4) | [`e0182464aba3…`](https://preprod.cardanoscan.io/transaction/e0182464aba357fc4ec4090112956702bd44dc74167aadd2e5152934126563bb) | true | 0.5838 |
| Share 3 (L3, 10 ADA) | [`1bdf9c875069…`](https://preprod.cardanoscan.io/transaction/1bdf9c87506908e8cd876ff75573c537630aad8bec143b024aff6a897b9b22bc) | true | 0.5671 |
| Borrow 10 ADA to B2, relayed by R | [`6b320c87066e…`](https://preprod.cardanoscan.io/transaction/6b320c87066e64583ba498523d3ae43460afc859e3afaddd78d280c3706c83f0) | true | 0.5880 |
| Repay 10.5 ADA (B1) | [`00d0b5a03216…`](https://preprod.cardanoscan.io/transaction/00d0b5a0321628d102729b3bd60b2704a9314007099c9c1eb88440f55bfd2677) | true | 0.7882 |
| Borrow 10 ADA to B3, relayed by R | [`1eca7856df68…`](https://preprod.cardanoscan.io/transaction/1eca7856df6831e716c46ac226bca41406ccb8e05290a4d176c4c6d1f2b67aa3) | true | 0.6023 |
| Repay 10.5 ADA (B2) | [`909f84544d39…`](https://preprod.cardanoscan.io/transaction/909f84544d39e1964c6453a5642f824d2529900d16029e8c3ab793a242869a0e) | true | 0.7845 |
| Unlock 500 TOK to U2, relayed by R | [`9b5816c03c7c…`](https://preprod.cardanoscan.io/transaction/9b5816c03c7ca56dcb7dc79a8d5431c2881dd8c7cc9d1d9b32d6d932e5f125c7) | true | 0.4162 |
| Withdraw one share (10.333333 ADA) to P1, relayed by R | [`d04ea018d867…`](https://preprod.cardanoscan.io/transaction/d04ea018d867672dced4023e6c99d9b76b8cb85ddee3911e9f7d11e994f337d3) | true | 0.5799 |
| Repay 10.5 ADA (B3) | [`c468a977e435…`](https://preprod.cardanoscan.io/transaction/c468a977e43516be726e03fdc876d4643c8b44552f5fbd9d6411bb8cf16eb496) | true | 0.8029 |
| Unlock 500 TOK to U4, relayed by R | [`0dbd654e9f74…`](https://preprod.cardanoscan.io/transaction/0dbd654e9f741eaeeeb9133a1f2479865e0590c62c934f483b037f659a7276fc) | true | 0.4162 |
| Withdraw one share (10.583333 ADA) to P2, relayed by R | [`244ef168e832…`](https://preprod.cardanoscan.io/transaction/244ef168e832f0dcd5ef5112ae033099dd6cf5e0b111da6a702cdfe268362f48) | true | 0.5905 |
| Unlock 20 ADA to U1, relayed by R | [`397ad1b586c5…`](https://preprod.cardanoscan.io/transaction/397ad1b586c5ac924e6d0f162165846783161684874cf87761d2d352d23dea97) | true | 0.4110 |

**USD pool** (`packages/protocol/deployments/preprod-m3-usd.json`; loan asset USD, same keys and collateral list):

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Init pool + mint pool NFT | [`c79b7d5b0a62…`](https://preprod.cardanoscan.io/transaction/c79b7d5b0a620fc84841f3a4abc9c41046d641025a629caedb38db3921a32a1b) | true | 0.2077 |
| Publish the reference scripts | [`54d1bf05dd53…`](https://preprod.cardanoscan.io/transaction/54d1bf05dd53a436cb147cb36d48866743d45f7799034e24d91c5886a3aebc4c) | true | 0.6921 |
| Share 1 (L4, 10 USD) | [`aefd1397a6d2…`](https://preprod.cardanoscan.io/transaction/aefd1397a6d24c890987982b6deff494509ff9affa77ddd1ab192205994a105e) | true | 0.5677 |
| Deposit 20 ADA (D5, returns to U5) | [`8db735408435…`](https://preprod.cardanoscan.io/transaction/8db7354084350ca0f62988ac171da4259a42f04edd948c8da221e73dc069e6bc) | true | 0.5834 |
| Share 2 (L5, 10 USD) | [`45ff6a694cae…`](https://preprod.cardanoscan.io/transaction/45ff6a694caecd281c5d94f3f1cb71773f47dff3c34d89fea8911943529aea52) | true | 0.5714 |
| Deposit 500 TOK (D6, returns to U6) | [`83d8aa4be89f…`](https://preprod.cardanoscan.io/transaction/83d8aa4be89f2dfc9f26df88a8cf54fec7abdbf9e617f5c160977cdc1f95e190) | true | 0.5868 |
| Borrow 10 USD to B4, relayed by R | [`b763549ee7c0…`](https://preprod.cardanoscan.io/transaction/b763549ee7c0684f7da665ac582d636567a01436fc159a2ba1903cf522ed3e3e) | true | 0.5852 |
| Borrow 10 USD to B5, relayed by R | [`728e970e9dee…`](https://preprod.cardanoscan.io/transaction/728e970e9dee1dbbe6334aa518c318dfa9f22268a61bdc0cf1f131c94993c3ec) | true | 0.5927 |
| Repay 10.5 USD (B5) | [`60d08a9beba2…`](https://preprod.cardanoscan.io/transaction/60d08a9beba295384b2de27e311c300ec262e02157aeca09ddb5375904ceffae) | true | 0.7904 |
| Repay 10.5 USD (B4) | [`feddc592bc1a…`](https://preprod.cardanoscan.io/transaction/feddc592bc1a300bece2d6d3c9b091d45730699af21c2fd858237efdcb1d48b4) | true | 0.7925 |
| Unlock 500 TOK to U6, relayed by R | [`305e928da5cc…`](https://preprod.cardanoscan.io/transaction/305e928da5cc0fa1604c93d967266ced228873a5f152f6252a18a9cc79fedeef) | true | 0.4162 |
| Withdraw one share (10.5 USD) to P3, relayed by R | [`8143d17564ba…`](https://preprod.cardanoscan.io/transaction/8143d17564babb8098f0eda0e719c5a81b2dbf6fb74beaf9f163adf7193cc79f) | true | 0.5871 |
| Unlock 20 ADA to U5, relayed by R | [`39a2afbb0398…`](https://preprod.cardanoscan.io/transaction/39a2afbb0398e387877c8d36bc971e70c116f350c485c4d11792d0801cf8e506) | true | 0.4114 |

Funding outside the protocol: each demo address was funded once from one test wallet,
which also minted the test tokens. No protocol transaction carries a value that the
deposit side (D, U) and the loan side (B) share.

Economics: in the ADA pool three shares of 10 were bought and three loans of 10 repaid
with 0.5 interest each; the first share withdrawn after two repayments paid 10.333333
and the second, after the third, 10.583333, so the price grew with each repayment. In
the USD pool two shares of 10, two loans repaid, one share paid out at 10.5. Every
unlock returned its deposit whole (its asset and its ADA).

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
| Add liquidity | append | 517,882–562,290 | 2,577,055,989–2,591,245,036 | 26 % | 0.57 |
| Deposit (ADA / TOK) | append | 604,018–619,236 | 2,602,519,044–2,609,835,658 | 26 % | 0.58–0.59 |
| Borrow | borrow + MPF insert | 602,529–823,348 | 2,608,077,472–2,675,758,226 | 27 % | 0.58–0.60 |
| Repay | repay + append + MPF update | 791,652–966,652 | 5,179,994,440–5,237,073,082 | 52 % | 0.78–0.80 |
| Unlock | settlement | 294,286–336,380 | 2,358,894,934–2,373,206,815 | 24 % | 0.41–0.42 |
| Withdraw a share | lender withdraw + MPF insert | 621,676–714,942 | 2,615,409,831–2,646,002,233 | 26 % | 0.58–0.59 |

Ranges over every transaction of both pools (§3). A single on-chain `groth_verify`
costs about 2.3–2.6 B CPU steps; an MPF insert or update adds little. Every step fits in
one transaction with room to spare (repay, the only step with two proofs, uses about
half of the CPU budget and 6 % of the memory). The scripts are spent by reference and
the pool datum keeps its size; the only growth is the MPF proof in the redeemer, which
grows with the logarithm of the number of loans or withdrawals (the memory spread for
borrow, repay and withdraw).

**Proof generation (off-chain).** Measured by the command line client during the
cycles in §3 (`offchain/cli/m4/run.mjs`, which prints each proof's time), on an Apple
M2 with 16 GB and Node.js 23.6: append 1.4–1.6 s, borrow 1.0 s, repay 1.2 s,
settlement 1.0 s, lender withdraw 1.0–1.1 s. Every proof is verified locally before
the transaction is built.
