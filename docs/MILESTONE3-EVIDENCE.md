# Milestone 3 — Evidence Index

Maps each Catalyst M3 required-evidence item to concrete repo paths and live
on-chain proof. All links are Cardano **Preprod**. M3 acceptance requires:
zk-SNARK proofs verifiable **on-chain** for **private** verification of collateral
and loan transactions.

---

## ✅ Item 1 — Published zk-SNARK integration code

| Layer | Path |
|---|---|
| Borrow/repay circuit (Merkle membership + nullifier) | `circuits/collateral_semaphore.circom` (BLS12-381, Poseidon255, 5 signals) |
| Unlock circuit (settlement: commitment + repaid-set membership) | `circuits/settlement_proof.circom` (3 signals) |
| Repay append circuit (permissionless R insertion) | `circuits/append_proof.circom` (4 signals) |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrappers | `contracts/lib/zk.ak` (`verify_borrow_proof`, `verify_settlement_proof`, `verify_append_proof`, `get_vkey`) |
| Redeemer / datum types | `contracts/lib/types_v5.ak` |
| Pool validator | `contracts/validators/v5/lending_pool_v5.ak` (Deposit / SetGroupRoot / BorrowAnonymous / RepayAnonymous) |
| Collateral validator (param. by pool hash) | `contracts/validators/v5/collateral_v5.ak` (UnlockDeposit) |
| Compiled blueprint | `contracts/plutus.json` |
| Off-chain drivers (Mesh) | `offchain/cli/v5/{1-park-vkey,2-init-pool,3-deposit,3b-setgrouproot,4-borrow,5-repay,6-unlock}.mjs` |
| Off-chain shared helpers | `offchain/cli/v5/common.mjs` (Merkle tree, proof gen, point compression, encoders) |

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
| On-chain proof + adversarial validator tests (17/17) | `contracts/lib/semaphore_onchain_test.ak`, `contracts/validators/tests/v6_validator_test.ak` — `cd contracts && aiken check` |
| Fixture generator | `circuits/tests/gen-semaphore-fixture.cjs` |

Tallies: aiken **17/17** (0 warnings), live cycle **7/7** `valid_contract:true`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Independent tester feedback | `docs/Tester-Feedback/` |
| Approved M1 / M2 POAs (re-published) | `docs/poa/M1-POA.pdf`, `docs/poa/M2-POA.pdf` |

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every value-moving action authorized by an **on-chain** Groth16
proof (no signature). All seven transactions `valid_contract: true`:

| Step | Tx hash | valid_contract |
|---|---|:---:|
| Park VKeys | [`880446043ab5…caddc211`](https://preprod.cardanoscan.io/transaction/880446043ab5345038b03f31705082d8dbeb8b5929a31bfe92bbeae9caddc211) | true |
| Init pool | [`9aa40d4f1364…d09332c`](https://preprod.cardanoscan.io/transaction/9aa40d4f1364fe47bf71df256bc5f0b062cb32284491635fc24ef4c1fd09332c) | true |
| Deposit | [`fd6ace7bd7dc…917900b5`](https://preprod.cardanoscan.io/transaction/fd6ace7bd7dcf3e436611fabcfa5dcd087f29f70aa6327624e1ecff3917900b5) | true |
| Set group root (admin) | [`9737b260bd2f…3252de02`](https://preprod.cardanoscan.io/transaction/9737b260bd2fcf0a4bfd583a9e7e5096f0c9e5c077a459b55525aa8b3252de02) | true |
| **Borrow (on-chain membership ZK)** | [`8bc3d205f67e…07b5fc45b9`](https://preprod.cardanoscan.io/transaction/8bc3d205f67eaa6d965e2f59e24210abba4251bbba2ae31e96f13507b5fc45b9) | true |
| **Repay (principal + interest; self-appends R)** | [`f8756c92addb…89d316a38`](https://preprod.cardanoscan.io/transaction/f8756c92addb71fae26c6bdf160be3028266825199b5acf53d202bd89d316a38) | true |
| **Unlock (settlement proof, no signature, no borrow-shared value)** | [`43f4339ea8aa…805f02521`](https://preprod.cardanoscan.io/transaction/43f4339ea8aac1d34bb14581e02aaabcc3f2e23ce15dd2f1c30118a805f02521) | true |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released. Unlock succeeds
**only after** repay inserts `R` into `repaid_root` — and needs no admin step.

### Deployed script hashes (Preprod)

- `lending_pool_v5`: `75317267a9fa7d8fcb09c62d371bcf8160c7991eba6637c221f22ff2`
- `collateral_v5`: `f2813e76cfb431d80ad5a50682e16d64524c6c3372b6bee4800f881d`

---

## Immutable evidence

This POA corresponds to the resubmit stand, tagged **`m3-poa-v3`** — cite the tagged
tree, not `main`.
