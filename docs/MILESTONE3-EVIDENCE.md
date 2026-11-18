# Milestone 3 — Evidence Index

Maps each Catalyst M3 required-evidence item to concrete repo paths and live
on-chain proof. All links are Cardano **Preprod**. M3 acceptance requires:
zk-SNARK proofs verifiable **on-chain** for **private** verification of collateral
and loan transactions.

---

## ✅ Item 1 — Published zk-SNARK integration code

| Layer | Path |
|---|---|
| Borrow/repay circuit (Merkle membership + nullifier + recipient binding) | `circuits/collateral_semaphore.circom` (BLS12-381, Poseidon255, 6 signals) |
| Unlock circuit (settlement: commitment + repaid-set membership) | `circuits/settlement_proof.circom` (3 signals) |
| Append circuit (permissionless insertion into the commitment set and the repaid set) | `circuits/append_proof.circom` (4 signals) |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrappers | `contracts/lib/zk.ak` (`verify_borrow_proof`, `verify_settlement_proof`, `verify_append_proof`, `get_vkey`) |
| Redeemer / datum types | `contracts/lib/types_v5.ak` |
| Pool NFT minting policy (one-shot) | `contracts/validators/v5/pool_nft.ak` |
| Pool validator | `contracts/validators/v5/lending_pool_v5.ak` (AddLiquidity / DepositCollateral / BorrowAnonymous / RepayAnonymous) |
| Collateral validator | `contracts/validators/v5/collateral_v5.ak` (UnlockDeposit) |
| Compiled blueprint | `contracts/plutus.json` |
| Off-chain drivers (Mesh) | `offchain/cli/v5/{1-park-vkey,2-init-pool,3-deposit,4-borrow,5-repay,6-unlock}.mjs` |
| Off-chain shared helpers | `offchain/cli/v5/common.mjs` (script derivation, Merkle trees, proof generation, point compression, encoders) |

## ✅ Item 2 — Published zk-SNARK library

| Component | Source |
|---|---|
| Generic on-chain Groth16 verifier (BLS12-381) | `modulo-p/ak-381` v0.1.1 — `contracts/aiken.toml` / `aiken.lock` |
| Off-chain hash | `poseidon-bls12381` (Poseidon255), in-circuit and in `common.mjs` |
| Borrow keys | `circuits/keys/collateral_semaphore_final.zkey`, `verification_key_semaphore.json`, `circuits/collateral_semaphore_js/collateral_semaphore.wasm` |
| Settlement keys | `circuits/keys/settlement_proof_final.zkey`, `verification_key_settlement.json`, `circuits/settlement_proof_js/settlement_proof.wasm` |
| Append keys | `circuits/keys/append_proof_final.zkey`, `verification_key_append.json`, `circuits/append_proof_js/append_proof.wasm` |

## ✅ Item 3 — Published summary of test results

| Artifact | Path |
|---|---|
| Test-results summary | `docs/MILESTONE3-TEST-RESULTS.md` |
| On-chain proof + adversarial validator tests (49/49) | `contracts/lib/semaphore_onchain_test.ak`, `contracts/validators/tests/v6_validator_test.ak`, `contracts/validators/tests/pool_nft_test.ak` — `cd contracts && aiken check` |
| Fixture generator | `circuits/tests/gen-semaphore-fixture.cjs` |

Tallies: aiken **49/49** (0 warnings), live cycle **6/6** `valid_contract: true`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Break-it runbook for testers | `docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-2-breakit.md` |
| Approved M1 / M2 POAs (re-published) | `docs/poa/M1-POA.pdf`, `docs/poa/M2-POA.pdf` |

### Independent tester reports

Each report is published as written by its tester and dated; it covers the
protocol stand that was current on that date.

| Tester | Date | Report |
|---|---|---|
| pinusch100 | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pinusch100.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pinusch100.md) |
| pumbiii | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii.md) |
| pumbiii (break-it) | 2026-09-01 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md) |

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every action authorized by an **on-chain** Groth16 proof (no admin,
no signature). All six transactions `valid_contract: true`:

| Step | Tx hash | valid_contract |
|---|---|:---:|
| Park VKeys | [`3e018c9063f1…28790316`](https://preprod.cardanoscan.io/transaction/3e018c9063f1c37954079b79285be7bd534efb12dc98f77ad025dffc28790316) | true |
| Init pool + mint pool NFT | [`5702c1512ad0…13ac0d30`](https://preprod.cardanoscan.io/transaction/5702c1512ad0cf4b19009da3995d21675df6b9920ed047af9631382713ac0d30) | true |
| **Deposit (on-chain append proof into the commitment set)** | [`7fa28e7d56fd…94e6f556`](https://preprod.cardanoscan.io/transaction/7fa28e7d56fd7e6060f97d6b9504a7da7dc35bebb5a275e902f5b3b794e6f556) | true |
| **Borrow (on-chain membership ZK, recipient-bound)** | [`d16503550d1c…9eb2a501`](https://preprod.cardanoscan.io/transaction/d16503550d1c822f5a6adaa832c69db4c4f0abfdb0eab1676e4635e89eb2a501) | true |
| **Repay (principal + interest; self-appends R)** | [`8fafa79d6bc4…0021ea983`](https://preprod.cardanoscan.io/transaction/8fafa79d6bc47e6ce215704a5690bae18efcf89c59d3abc1bf8b4110021ea983) | true |
| **Unlock (settlement proof, no signature, no borrow-shared value)** | [`046baceaccbe…5f021b4a`](https://preprod.cardanoscan.io/transaction/046baceaccbe8a7ac9e426655a5cfe5b997fd0ddc430cc6c5033f99e5f021b4a) | true |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released to the deposit's
`unlock_to` address. Unlock succeeds **only after** repay inserts `R` into
`repaid_root`, and it needs no admin step.

### Deployed scripts (Preprod)

- Pool NFT policy: `586a933cb6c1ece99d373e106ff38b4c430d0e606541c8635c0cf049` (token `POOL`)
- `lending_pool_v5`: `d99ee5039b3b4c3792358482404bffc24e7194cf21c7c30028e01ba7`
- `collateral_v5`: `0fb3482637d024566f70fc43ed09a6178a545fa281e55e72082c44fe`

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v4`**. Cite the tagged tree, not
`main`.
