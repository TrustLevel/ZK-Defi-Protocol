# Milestone 3 — Test Results Summary

All figures below are for the private (v6) protocol as deployed.

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain + adversarial validator tests (Aiken) | `cd contracts && aiken check` | **49 / 49 pass**, 0 fail, 0 warnings |
| Circuit gate (borrow circuit, incl. tampered signals) | `cd offchain/cli && node v5/test-semaphore-proof.mjs` | valid proof `true`; tampered `loan_amount` and tampered `recipient` `false` |
| Live Preprod cycle (6 txs) | `offchain/cli/v5/{1..6}` | **6 / 6 confirmed**, all `valid_contract: true` |
| Live re-borrow attack (same secret after repay + unlock) | built and evaluated against Preprod, not submitted | **rejected** by script evaluation |

### Aiken tests (49)

**On-chain proof fixtures** (real BLS12-381 Groth16 proofs, `contracts/lib/semaphore_onchain_test.ak`, `zk_onchain_test.ak`):

| Test | Assertion |
|---|---|
| `borrow_proof_verifies_onchain` | valid membership proof → `true` |
| `tampered_borrow_signal_fails_onchain` | flip `loan_amount` → `false` |
| `tampered_recipient_signal_fails_onchain` | re-target the proof at another recipient → `false` |
| `settlement_proof_verifies_onchain` | valid settlement (commitment + repaid-set membership) → `true` |
| `tampered_settlement_signal_fails_onchain` | flip `repaid_root` → `false` |
| `append_proof_verifies_onchain` | valid repay append (old → new at index) → `true` |
| `group_append_proof_verifies_onchain` | valid deposit append (commitment into the empty set) → `true` |
| `tampered_append_signal_fails_onchain` | flip `new_root` → `false` |
| `collateral_proof_verifies_onchain` / `tampered_public_signal_fails_onchain` | legacy 3-signal fixture (retained) |

**Pool NFT policy** (`contracts/validators/tests/pool_nft_test.ak`):

| Test | Property |
|---|---|
| `mint_with_seed_succeeds` | minting is possible only in the tx that spends the seed |
| `mint_without_seed_fails` | without the seed, nothing can be minted |
| `mint_two_fails` / `mint_other_name_fails` / `mint_extra_token_fails` | exactly one token named `POOL`, nothing else |
| `burn_fails` | the pool NFT can never be burned |

**Validator adversarial tests** (real proofs, full tx fixtures, `contracts/validators/tests/v6_validator_test.ak`):

| Area | Test | Property |
|---|---|---|
| Pool identity | `spend_pool_without_nft_fails` | a UTxO at the pool address without the NFT is not the pool |
| | `continuing_output_without_nft_fails` / `continuing_output_other_address_fails` | the NFT must continue at the pool address |
| | `borrow_with_vkey_at_other_ref_fails` | the borrow vkey is fixed by parameter |
| Deposit | `deposit_collateral_succeeds` | exact denomination + commitment at the collateral script + valid append |
| | `deposit_collateral_wrong_amount_fails` / `_wrong_address_fails` / `_commitment_mismatch_fails` | the deposit must be real, exact and match the appended commitment |
| | `deposit_collateral_bogus_append_fails` / `_index_not_advanced_fails` | the commitment set grows only by a valid append |
| | `group_root_change_without_append_fails` | no other spend can rewrite the commitment set |
| Borrow | `borrow_membership_succeeds` | membership proof authorizes a loan paid to the bound recipient |
| | `borrow_reused_nullifier_fails` | an outstanding nullifier cannot open a second loan |
| | **`borrow_after_repay_same_secret_fails`** | **a repaid deposit cannot borrow again (one loan per deposit)** |
| | `borrow_not_recorded_as_used_fails` | the nullifier must enter `used_nullifiers` |
| | `borrow_collateral_denomination_too_small_fails` | the collateral denomination must cover the loan at the ratio |
| | **`borrow_payout_to_other_key_fails`** / `borrow_underpays_recipient_fails` / `borrow_redeemer_recipient_swapped_fails` | **a copied proof cannot redirect the loan** |
| Repay | `repay_principal_plus_interest_succeeds` | exact principal + interest settles the loan and self-appends `R` |
| | `repay_below_interest_fails` / `repay_overpay_fails` | any other amount is rejected |
| | `repay_bogus_append_fails` | a repayer cannot fake growth of `repaid_root` |
| | `repay_clearing_used_nullifier_fails` | repay cannot re-enable a second loan |
| Unlock | `unlock_when_settled_succeeds` | a settled deposit unlocks to its `unlock_to` address |
| | **`unlock_without_repay_fails`** | **a settlement proof cannot verify against an `R`-absent `repaid_root` (fail-closed)** |
| | `unlock_wrong_commitment_fails` | a proof for a different commitment cannot spend this deposit |
| | **`unlock_via_forged_pool_ref_fails`** | **a UTxO paid to the pool address cannot supply a fake `repaid_root`** |
| | `unlock_with_vkey_at_other_ref_fails` | the settlement vkey is fixed by parameter |
| | **`unlock_to_other_address_fails`** / `unlock_underpays_recipient_fails` | **a copied proof cannot redirect the collateral** |
| | `unlock_payout_tagged_for_other_deposit_fails` | one payout output cannot settle two deposits |
| | `unlock_redeemer_carries_no_loan_nullifier` | structural: `UnlockDeposit` shares no value with the borrow |

## 2. Live Preprod cycle (confirmed)

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park VKeys | `3e018c9063f1…28790316` | true | 0.2583 |
| Init pool + mint pool NFT | `5702c1512ad0…13ac0d30` | true | 0.1992 |
| **Deposit** (on-chain append proof) | `7fa28e7d56fd…94e6f556` | true | 0.6130 |
| **Borrow** (on-chain membership groth_verify, recipient-bound) | `d16503550d1c…9eb2a501` | true | 0.6341 |
| **Repay** (principal + interest; self-appends R, two on-chain proofs) | `8fafa79d6bc4…0021ea983` | true | 0.8185 |
| **Unlock** (settlement proof, no signature) | `046baceaccbe…5f021b4a` | true | 0.4529 |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released to `unlock_to`.

**Operational notes (for reproducing testers).**
- **Evaluation.** The Mesh builder evaluates every tx via Blockfrost before submitting, so a tx that a validator would reject is never submitted. On a rejection, Blockfrost returns `EvaluationFailure` without the script trace.
- **Index lag.** Blockfrost's UTxO index lags block confirmation by seconds. `wait.mjs` waits until the tx outputs are indexed.
- **Collateral UTxO.** Script txs need a **pure-ADA** UTxO for Cardano collateral, and the init tx needs two (seed + collateral). Split one off first if necessary.

## 3. On-chain verification cost (measured live)

| Tx | Proofs | Memory | CPU steps | of tx limit (cpu) |
|---|---|---|---|---|
| Deposit | append | 485,924 | 2,550,218,387 | 26 % |
| Borrow | borrow | 483,872 | 2,816,388,568 | 28 % |
| Repay | borrow + append | 549,703 | 5,218,597,012 | 52 % |
| Unlock | settlement | 262,819 | 2,345,905,591 | 23 % |

Preprod tx limits: 17,500,000 memory / 10,000,000,000 cpu steps. A single on-chain
`groth_verify` costs ~2.3–2.8 B cpu. Repay runs two proofs in one tx and still fits
comfortably (≈3 % mem, ≈52 % cpu).

## 4. Cardanoscan links

- Park: https://preprod.cardanoscan.io/transaction/3e018c9063f1c37954079b79285be7bd534efb12dc98f77ad025dffc28790316
- Init + mint: https://preprod.cardanoscan.io/transaction/5702c1512ad0cf4b19009da3995d21675df6b9920ed047af9631382713ac0d30
- **Deposit:** https://preprod.cardanoscan.io/transaction/7fa28e7d56fd7e6060f97d6b9504a7da7dc35bebb5a275e902f5b3b794e6f556
- **Borrow:** https://preprod.cardanoscan.io/transaction/d16503550d1c822f5a6adaa832c69db4c4f0abfdb0eab1676e4635e89eb2a501
- **Repay:** https://preprod.cardanoscan.io/transaction/8fafa79d6bc47e6ce215704a5690bae18efcf89c59d3abc1bf8b4110021ea983
- **Unlock:** https://preprod.cardanoscan.io/transaction/046baceaccbe8a7ac9e426655a5cfe5b997fd0ddc430cc6c5033f99e5f021b4a
