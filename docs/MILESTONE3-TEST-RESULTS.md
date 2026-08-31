# Milestone 3 — Test Results Summary

All figures below are for the private (v6) protocol.

## 1. Pass/fail

| Suite | Command | Result |
|---|---|---|
| On-chain + adversarial validator tests (Aiken) | `cd contracts && aiken check` | **13 / 13 pass**, 0 fail, 0 warnings |
| Live Preprod cycle (7 txs) | `offchain/cli/v5/{1..6}` | **7 / 7 confirmed**, all `valid_contract: true` |

### Aiken tests (13)

**On-chain proof fixtures** (real BLS12-381 Groth16 proofs, both circuits):

| Test | Assertion |
|---|---|
| `borrow_proof_verifies_onchain` | valid membership proof → `true` |
| `tampered_borrow_signal_fails_onchain` | flip `loan_amount` → `false` |
| `unlock_proof_verifies_onchain` | valid commitment-bound proof → `true` |
| `tampered_unlock_signal_fails_onchain` | flip `loan_nullifier` → `false` |
| `collateral_proof_verifies_onchain` / `tampered_public_signal_fails_onchain` | legacy 3-signal fixture (retained) |

**Validator adversarial tests** (real proofs, full tx fixtures):

| Test | Property |
|---|---|
| `borrow_membership_succeeds` | membership proof authorizes a loan |
| `borrow_reused_nullifier_fails` | a nullifier already outstanding cannot open a second loan |
| `repay_principal_plus_interest_succeeds` | repay of principal + interest settles the loan |
| `repay_below_interest_fails` | paying less than principal + interest is rejected |
| `unlock_when_settled_succeeds` | a settled deposit unlocks |
| **`unlock_blocked_while_loan_open_fails`** | **a valid proof cannot unlock collateral whose loan is still outstanding** |
| `unlock_wrong_commitment_fails` | a proof for a different commitment cannot spend this deposit |

## 2. Live Preprod cycle (confirmed)

| Step | Tx hash | valid_contract | Fee (ADA) |
|---|---|---|---|
| Park VKeys | `ee6b270f…1be0c3` | true | 0.2270 |
| Init pool | `8a106cb2…143ea4` | true | 0.1783 |
| Deposit | `686989ff…e99e17` | true | 0.1711 |
| Set group root | `03c6e636…16aa84` | true | 0.3278 |
| **Borrow** (on-chain membership groth_verify) | `f473f9c1…3cad9d` | true | 0.5340 |
| **Repay** (principal + interest) | `dfba747c…a2a89a` | true | 0.5301 |
| **Unlock** (repayment-gated, no signature) | `3af0d112…905f69` | true | 0.4294 |

**Fees.** The proof-carrying txs cost ~0.43–0.54 ADA. The Mesh builder's
`autoEvaluate` produces tight ExUnits for these BLS12-381 scripts — materially
cheaper than a hand-budgeted upper bound.

## 3. On-chain verification cost

| Metric | borrow verify | unlock verify | Plutus V3 limit |
|---|---|---|---|
| Memory | 53,752 | 43,068 | 17,500,000 |
| CPU steps | ~2.53 B | ~2.27 B | 10,000,000,000 |

Both circuits' verification fits comfortably within Plutus V3 limits.

## 4. Cardanoscan links

- Park: https://preprod.cardanoscan.io/transaction/ee6b270fdb93ec1720af401e67a6d7db2c5fe1304e4bbeeb9e1f6ee3871be0c3
- Init: https://preprod.cardanoscan.io/transaction/8a106cb2dda054ab783a289bcdc4123b8bb8a881879c53abbeb566a87e143ea4
- Deposit: https://preprod.cardanoscan.io/transaction/686989ff429a4ddcd89e61da07bda255c3b5b8d444f447a59912585335e99e17
- Set group root: https://preprod.cardanoscan.io/transaction/03c6e636545f95d4588b19139f6d3366fef7179964c5d1e0c4ce22f35f16aa84
- **Borrow:** https://preprod.cardanoscan.io/transaction/f473f9c159c024d2b2c557f3fc06f8768833f155c0512a082645ad36213cad9d
- **Repay:** https://preprod.cardanoscan.io/transaction/dfba747c872948cd3de5f0515e785f4f747c3fb78651357ea88aa2248ea2a89a
- **Unlock:** https://preprod.cardanoscan.io/transaction/3af0d112eda2e92290532a1ac11da44844c7169969d48f1a0ab498c972905f69
