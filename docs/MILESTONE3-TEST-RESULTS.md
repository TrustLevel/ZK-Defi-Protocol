# Milestone 3 — Test Results Summary

All figures below are for the private (v6) protocol.

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain + adversarial validator tests (Aiken) | `cd contracts && aiken check` | **17 / 17 pass**, 0 fail, 0 warnings |
| Live Preprod cycle (7 txs) | `offchain/cli/v5/{1..6}` | **7 / 7 confirmed**, all `valid_contract: true` |

### Aiken tests (17)

**On-chain proof fixtures** (real BLS12-381 Groth16 proofs, all three circuits):

| Test | Assertion |
|---|---|
| `borrow_proof_verifies_onchain` | valid membership proof → `true` |
| `tampered_borrow_signal_fails_onchain` | flip `loan_amount` → `false` |
| `settlement_proof_verifies_onchain` | valid settlement (commitment + repaid-set membership) → `true` |
| `tampered_settlement_signal_fails_onchain` | flip `repaid_root` → `false` |
| `append_proof_verifies_onchain` | valid append (old→new at index) → `true` |
| `tampered_append_signal_fails_onchain` | flip `new_root` → `false` |
| `collateral_proof_verifies_onchain` / `tampered_public_signal_fails_onchain` | legacy 3-signal fixture (retained) |

**Validator adversarial tests** (real proofs, full tx fixtures):

| Test | Property |
|---|---|
| `borrow_membership_succeeds` | membership proof authorizes a loan |
| `borrow_reused_nullifier_fails` | a nullifier already outstanding cannot open a second loan |
| `repay_principal_plus_interest_succeeds` | repay of principal + interest settles the loan and self-appends `R` |
| `repay_below_interest_fails` | paying less than principal + interest is rejected |
| **`repay_bogus_append_fails`** | **a repayer cannot fake growth of `repaid_root` — the append proof binds old→new** |
| `unlock_when_settled_succeeds` | a settled deposit unlocks via the settlement proof |
| **`unlock_without_repay_fails`** | **a valid settlement proof cannot verify against an `R`-absent `repaid_root` (fail-closed)** |
| `unlock_wrong_commitment_fails` | a proof for a different commitment cannot spend this deposit |
| `unlock_redeemer_carries_no_loan_nullifier` | structural: `UnlockDeposit` shares no value with the borrow (Leak-2 closed) |

## 2. Live Preprod cycle (confirmed)

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park VKeys | `880446043ab5…caddc211` | true | 0.2558 |
| Init pool | `9aa40d4f1364…d09332c` | true | 0.1817 |
| Deposit | `fd6ace7bd7dc…917900b5` | true | 0.1711 |
| Set group root (admin) | `9737b260bd2f…3252de02` | true | 0.3552 |
| **Borrow** (on-chain membership groth_verify) | `8bc3d205f67e…07b5fc45b9` | true | 0.5617 |
| **Repay** (principal + interest; self-appends R, two on-chain proofs) | `f8756c92addb…89d316a38` | true | 0.7549 |
| **Unlock** (settlement proof, no signature) | `43f4339ea8aa…805f02521` | true | 0.4271 |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released.

**Fees.** Single-proof txs cost ~0.43–0.56 ADA; repay runs **two** proofs (membership
+ append) at ~0.75 ADA. Published fees are an **upper bound** — the Mesh builder's
`autoEvaluate` produces tight ExUnits and independent testers reproduced borrow/repay
at lower cost.

**Operational notes (for reproducing testers).** Blockfrost's preprod evaluate/submit
endpoints can be intermittently unreliable (long hangs) while plain REST stays instant;
if `autoEvaluate` hangs, supply **manual ExUnits** (`makeTxBuilder(provider, {
autoEvaluate: false })` + explicit budgets) — the txs are otherwise identical and every
legit cycle tx confirms `valid_contract:true`, so the manual budget only bypasses the
flaky evaluation endpoint, not the validator. Blockfrost's UTxO index also lags block
confirmation by seconds; a short settle between steps avoids `All inputs are spent`.
Script txs need a **pure-ADA** UTxO for Cardano collateral (split one off first). The
`.env` Demeter Kupo/Ogmios endpoints currently return 401 (tokens expired) — refresh or
ignore; Blockfrost alone is sufficient.

## 3. On-chain verification cost

| Metric | single verify (borrow / settlement) | repay (membership + append, measured live) | Plutus V3 limit |
|---|---|---|---|
| Memory | ~40–55 K | 508,943 | 17,500,000 |
| CPU steps | ~2.3–2.5 B | 5,083,199,002 | 10,000,000,000 |

A single on-chain `groth_verify` is ~2.3–2.5 B cpu. Repay runs two proofs in one tx
and still fits comfortably (≈3 % mem, ≈51 % cpu).

## 4. Cardanoscan links

- Park: https://preprod.cardanoscan.io/transaction/880446043ab5345038b03f31705082d8dbeb8b5929a31bfe92bbeae9caddc211
- Init: https://preprod.cardanoscan.io/transaction/9aa40d4f1364fe47bf71df256bc5f0b062cb32284491635fc24ef4c1fd09332c
- Deposit: https://preprod.cardanoscan.io/transaction/fd6ace7bd7dcf3e436611fabcfa5dcd087f29f70aa6327624e1ecff3917900b5
- Set group root: https://preprod.cardanoscan.io/transaction/9737b260bd2fcf0a4bfd583a9e7e5096f0c9e5c077a459b55525aa8b3252de02
- **Borrow:** https://preprod.cardanoscan.io/transaction/8bc3d205f67eaa6d965e2f59e24210abba4251bbba2ae31e96f13507b5fc45b9
- **Repay:** https://preprod.cardanoscan.io/transaction/f8756c92addb71fae26c6bdf160be3028266825199b5acf53d202bd89d316a38
- **Unlock:** https://preprod.cardanoscan.io/transaction/43f4339ea8aac1d34bb14581e02aaabcc3f2e23ce15dd2f1c30118a805f02521
