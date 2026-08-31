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
| Park VKeys | [`0f3d9603…247375`](https://preprod.cardanoscan.io/transaction/0f3d96031261456ebe5e9e6210b67cf398c4925e78ab049a996436f867247375) | true |
| Init pool | [`6cd76fb3…53ce8a`](https://preprod.cardanoscan.io/transaction/6cd76fb343697f9f18af5982f27fe8336372dbaf35e7968497011759d953ce8a) | true |
| Deposit | [`4d1901c5…a9ec15`](https://preprod.cardanoscan.io/transaction/4d1901c507fc5b4b2cea0bc420ae07e6a5a0f32e351f1c9d22b4d9ca07a9ec15) | true |
| Set group root | [`e9a5ffdf…30076c`](https://preprod.cardanoscan.io/transaction/e9a5ffdfe6f35769b3b99749aec2a048c9758e8315bea9d99f0567d4d430076c) | true |
| **Borrow (on-chain membership ZK)** | [`bc620342…1bdebb`](https://preprod.cardanoscan.io/transaction/bc62034295d37dc10b4fcaab05e33c38161f969867b340e76632a464a11bdebb) | true |
| **Repay (principal + interest)** | [`e7933333…d5d789`](https://preprod.cardanoscan.io/transaction/e79333330567139c844ccc57f4b6ac4e5aba98972dd29f6b5df11304585d5789) | true |
| **Unlock (repayment-gated, no signature)** | [`c4492a39…dca1720`](https://preprod.cardanoscan.io/transaction/c4492a390bfbb807b477b7d50d3df22ff31de15e7a66b4349e7f1e2a5dca1720) | true |

### Deployed script hashes (Preprod)

- `lending_pool_v5`: `4c09216852aec4b5254867f06f30ce73e560638ff32563d8abdc4ff5`
- `collateral_v5`: `f027b9d8bf35fafd36836abd41bf6f0d414218561840d60a0a4031e7`

---

## Immutable evidence

This POA is tagged **`m3-poa-v2`** — cite the tagged tree, not `main`.
