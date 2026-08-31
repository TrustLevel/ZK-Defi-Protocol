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
| Park VKeys | `0f3d9603…247375` | true | 0.2251 |
| Init pool | `6cd76fb3…53ce8a` | true | 0.1783 |
| Deposit | `4d1901c5…a9ec15` | true | 0.1711 |
| Set group root | `e9a5ffdf…30076c` | true | 0.3303 |
| **Borrow** (on-chain membership groth_verify) | `bc620342…1bdebb` | true | 0.5383 |
| **Repay** (principal + interest) | `e7933333…d5d789` | true | 0.5344 |
| **Unlock** (repayment-gated, no signature) | `c4492a39…dca1720` | true | 0.4331 |

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

- Park: https://preprod.cardanoscan.io/transaction/0f3d96031261456ebe5e9e6210b67cf398c4925e78ab049a996436f867247375
- Init: https://preprod.cardanoscan.io/transaction/6cd76fb343697f9f18af5982f27fe8336372dbaf35e7968497011759d953ce8a
- Deposit: https://preprod.cardanoscan.io/transaction/4d1901c507fc5b4b2cea0bc420ae07e6a5a0f32e351f1c9d22b4d9ca07a9ec15
- Set group root: https://preprod.cardanoscan.io/transaction/e9a5ffdfe6f35769b3b99749aec2a048c9758e8315bea9d99f0567d4d430076c
- **Borrow:** https://preprod.cardanoscan.io/transaction/bc62034295d37dc10b4fcaab05e33c38161f969867b340e76632a464a11bdebb
- **Repay:** https://preprod.cardanoscan.io/transaction/e79333330567139c844ccc57f4b6ac4e5aba98972dd29f6b5df11304585d5789
- **Unlock:** https://preprod.cardanoscan.io/transaction/c4492a390bfbb807b477b7d50d3df22ff31de15e7a66b4349e7f1e2a5dca1720
