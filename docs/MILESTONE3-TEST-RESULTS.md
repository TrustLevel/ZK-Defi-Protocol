# Milestone 3 — Test Results Summary

All figures below are for the private (v6) protocol as deployed.

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain + adversarial validator tests (Aiken) | `cd contracts && aiken check` | **54 / 54 pass**, 0 fail, 0 warnings |
| Circuit gate (borrow circuit, incl. tampered signals) | `cd offchain/cli && node v5/test-semaphore-proof.mjs` | valid proof `true`; tampered `loan_amount` and tampered `recipient` `false` |
| Live Preprod cycle (6 txs) | `offchain/cli/v5/{1..6}` | **6 / 6 confirmed**, all `valid_contract: true` |
| Live repay attacks on an open loan: borrow proof used as repay proof + junk `R`; repay proof with a foreign `R` | built and evaluated against Preprod, not submitted; honest repay on the same state as control | both **rejected**; control **accepted** |

### Aiken tests (54)

**On-chain proof fixtures** (real BLS12-381 Groth16 proofs, `contracts/lib/semaphore_onchain_test.ak`, `zk_onchain_test.ak`):

| Test | Assertion |
|---|---|
| `borrow_proof_verifies_onchain` | valid membership proof → `true` |
| `tampered_borrow_signal_fails_onchain` | flip `loan_amount` → `false` |
| `tampered_recipient_signal_fails_onchain` | re-target the proof at another recipient → `false` |
| `repay_proof_verifies_onchain` | valid repay proof (N and R from one secret) → `true` |
| `tampered_repay_signal_fails_onchain` | a different `R` than the proof binds → `false` |
| `append_d_verifies_onchain` | a real append proof for another deposit's `R` (used by the repay binding tests) → `true` |
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
| Repay | `repay_principal_plus_interest_succeeds` | exact principal + interest, with a repay proof, settles the loan and appends its `R` |
| | `repay_below_interest_fails` / `repay_overpay_fails` | any other amount is rejected |
| | `repay_bogus_append_fails` | a repayer cannot fake growth of `repaid_root` |
| | `repay_clearing_used_nullifier_fails` | repay cannot re-enable a second loan |
| | **`repay_with_foreign_repay_nullifier_fails`** | **a repay can only append the `R` of the loan it settles** |
| | **`repay_with_copied_borrow_proof_fails`** | **a (public) borrow proof is not a repay proof, so nobody can repay a victim's loan with a foreign `R`** |
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
| Park VKeys | `edbfae0e6704…b2be1132` | true | 0.2921 |
| Init pool + mint pool NFT | `e2ecaa36399f…b1b5390e` | true | 0.2030 |
| **Deposit** (on-chain append proof) | `e63eeaab7526…e4b7fbc1` | true | 0.6154 |
| **Borrow** (on-chain membership groth_verify, recipient-bound) | `8be8d71a2950…2a468bf1` | true | 0.6344 |
| **Repay** (principal + interest; repay proof + append proof on-chain) | `fad24d65ede8…a869cf60` | true | 0.8259 |
| **Unlock** (settlement proof, no signature) | `64f9e36847b7…b48584b9` | true | 0.4529 |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released to `unlock_to`.

**Operational notes (for reproducing testers).**
- **Evaluation.** The Mesh builder evaluates every tx via Blockfrost before submitting, so a tx that a validator would reject is never submitted. On a rejection, Blockfrost returns `EvaluationFailure` without the script trace.
- **Index lag.** Blockfrost's UTxO index lags block confirmation by seconds. `wait.mjs` waits until the tx outputs are indexed.
- **Collateral UTxO.** Script txs need a **pure-ADA** UTxO for Cardano collateral, and the init tx needs two (seed + collateral). Split one off first if necessary.

## 3. On-chain verification cost (measured live)

| Tx | Proofs | Memory | CPU steps | of tx limit (cpu) |
|---|---|---|---|---|
| Deposit | append | 485,924 | 2,550,218,387 | 26 % |
| Borrow | borrow | 480,680 | 2,815,800,439 | 28 % |
| Repay | repay + append | 555,369 | 5,350,130,263 | 54 % |
| Unlock | settlement | 262,819 | 2,345,905,591 | 23 % |

Preprod tx limits: 17,500,000 memory / 10,000,000,000 cpu steps. A single on-chain
`groth_verify` costs ~2.3–2.8 B cpu. Repay runs two proofs in one tx and still fits
comfortably (≈3 % mem, ≈54 % cpu).

## 4. Cardanoscan links

- Park: https://preprod.cardanoscan.io/transaction/edbfae0e6704086b0f9feddf30c83544c10406faf729792ba57bbdc4b2be1132
- Init + mint: https://preprod.cardanoscan.io/transaction/e2ecaa36399f9732f6c56b76489ae58d7b5beaa6aa69a0150ce6ef26b1b5390e
- **Deposit:** https://preprod.cardanoscan.io/transaction/e63eeaab75266f138bf283a705ce741da3c2e805104e2fe18889668be4b7fbc1
- **Borrow:** https://preprod.cardanoscan.io/transaction/8be8d71a29509f9446aff7d668181470a92e5741af9a8d966cdeee232a468bf1
- **Repay:** https://preprod.cardanoscan.io/transaction/fad24d65ede8b625ebe6a7f22684fcdb33803f50b5445c1d72ee857ca869cf60
- **Unlock:** https://preprod.cardanoscan.io/transaction/64f9e36847b7774a69714f944f448c0496795eaa2621c80c83e02324b48584b9
