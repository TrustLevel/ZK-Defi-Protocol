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
| Unlock circuit (commitment-bound) | `circuits/unlock_proof.circom` (3 signals) |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrappers | `contracts/lib/zk.ak` (`verify_borrow_proof`, `verify_unlock_proof`, `get_vkey`) |
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
| Unlock keys | `circuits/keys/unlock_proof_final.zkey`, `verification_key_unlock.json`, `circuits/unlock_proof_js/unlock_proof.wasm` |

## ✅ Item 3 — Published summary of test results

| Artifact | Path |
|---|---|
| Test-results summary | `docs/MILESTONE3-TEST-RESULTS.md` |
| On-chain proof + adversarial validator tests (13/13) | `contracts/lib/semaphore_onchain_test.ak`, `contracts/validators/tests/v6_validator_test.ak` — `cd contracts && aiken check` |
| Fixture generator | `circuits/tests/gen-semaphore-fixture.cjs` |

Tallies: aiken **13/13** (0 warnings), live cycle **7/7** `valid_contract:true`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + privacy boundary | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Approved M1 / M2 POAs (re-published) | `docs/poa/M1-POA.pdf`, `docs/poa/M2-POA.pdf` |

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every action authorized by an **on-chain** Groth16 proof (no signature):

| Step | Tx hash | valid_contract |
|---|---|:---:|
| Park VKeys | [`ee6b270f…1be0c3`](https://preprod.cardanoscan.io/transaction/ee6b270fdb93ec1720af401e67a6d7db2c5fe1304e4bbeeb9e1f6ee3871be0c3) | true |
| Init pool | [`8a106cb2…143ea4`](https://preprod.cardanoscan.io/transaction/8a106cb2dda054ab783a289bcdc4123b8bb8a881879c53abbeb566a87e143ea4) | true |
| Deposit | [`686989ff…e99e17`](https://preprod.cardanoscan.io/transaction/686989ff429a4ddcd89e61da07bda255c3b5b8d444f447a59912585335e99e17) | true |
| Set group root | [`03c6e636…16aa84`](https://preprod.cardanoscan.io/transaction/03c6e636545f95d4588b19139f6d3366fef7179964c5d1e0c4ce22f35f16aa84) | true |
| **Borrow (on-chain membership ZK)** | [`f473f9c1…3cad9d`](https://preprod.cardanoscan.io/transaction/f473f9c159c024d2b2c557f3fc06f8768833f155c0512a082645ad36213cad9d) | true |
| **Repay (principal + interest)** | [`dfba747c…a2a89a`](https://preprod.cardanoscan.io/transaction/dfba747c872948cd3de5f0515e785f4f747c3fb78651357ea88aa2248ea2a89a) | true |
| **Unlock (repayment-gated, no signature)** | [`3af0d112…905f69`](https://preprod.cardanoscan.io/transaction/3af0d112eda2e92290532a1ac11da44844c7169969d48f1a0ab498c972905f69) | true |

### Deployed script hashes (Preprod)

- `lending_pool_v5`: `3fe6fa031e1d97cb2b271a6341ea9909961cc00e63eeca820d47cc65`
- `collateral_v5`: `2bcc23434d83f47ffa474a906d6d57cc24fdd190e1234371827a1593`

---

## Immutable evidence

This POA is tagged **`m3-poa-v2`** — cite the tagged tree, not `main`.
