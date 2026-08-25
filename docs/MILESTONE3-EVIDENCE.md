# Milestone 3 — Evidence Index

Maps each Catalyst M3 required-evidence item to concrete repo paths and live
on-chain proof. Repo paths are relative to the project root
(`/Users/dominiktilman/ZK-Defi-Protocol`). All links are Cardano **Preprod**.

M3 acceptance requires: zk-SNARK proofs verifiable **on-chain** without revealing
underlying details; private verification of collateral and loan transactions.

---

## ✅ Item 1 — Published zk-SNARK integration code (circuit + validators + off-chain)

| Layer | Path |
|---|---|
| Circuit | `circuits/collateral_proof.circom` (BLS12-381, Poseidon255, 3 public signals) |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrapper | `contracts/lib/zk.ak` (`verify_collateral_proof`, `get_vkey`) |
| Redeemer / datum types | `contracts/lib/types_v5.ak` |
| Pool validator | `contracts/validators/v5/lending_pool_v5.ak` (Borrow/Repay, on-chain `groth_verify`) |
| Collateral validator | `contracts/validators/v5/collateral_v5.ak` (Withdraw/UsedAsCollateral/UnlockDeposit) |
| Compiled blueprint | `contracts/plutus.json` |
| Off-chain drivers (Mesh) | `offchain/cli/v5/{1-park-vkey,2-init-pool,3-deposit,4-borrow,5-repay,6-unlock}.mjs` |
| Off-chain shared helpers | `offchain/cli/v5/common.mjs` (proof gen, point compression, encoders) |
| Live receipts | `offchain/cli/v5/receipts/{vkey,pool,deposit,borrow,repay,unlock}.json` |

## ✅ Item 2 — Published zk-SNARK library

| Component | Source |
|---|---|
| Generic on-chain Groth16 verifier (BLS12-381) | `modulo-p/ak-381` v0.1.1 — declared in `contracts/aiken.toml`, pinned in `contracts/aiken.lock` |
| Off-chain hash | `poseidon-bls12381` (Poseidon255), used in-circuit and in `common.mjs` |
| Proof-generation keys (our trusted setup) | `circuits/keys/collateral_proof_final.zkey`, `circuits/keys/verification_key.json` |
| Circuit WASM (witness gen) | `circuits/collateral_proof_js/collateral_proof.wasm` |

## ✅ Item 3 — Published summary of test results

| Artifact | Path |
|---|---|
| Test-results summary (pass/fail, edge cases, perf, feedback) | `docs/MILESTONE3-TEST-RESULTS.md` |
| On-chain proof tests (2/2) | `contracts/lib/zk_onchain_test.ak` — run `cd contracts && aiken check` |
| Off-chain proof gate (9/9) | `circuits/tests/gate-bls12381.cjs` — run `node circuits/tests/gate-bls12381.cjs` |
| On-chain fixture generator | `circuits/tests/gen-onchain-fixture.cjs` |

Tallies (fresh): aiken **2/2**, off-chain gate **9/9**, live cycle **6/6** `valid_contract:true`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + zk-proof-generation mechanism + on-chain design | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Implementation plan (Scope A) | `~/.claude/plans/vectorized-cooking-nebula.md` |

---

## Live on-chain proof (Preprod) — the M3 core claim

zk-SNARK proofs verified **on-chain** (`groth_verify` inside the spending validator,
no signature) for private collateral + loan transactions:

| Step | Tx hash | valid_contract | Cardanoscan |
|---|---|:---:|---|
| Park VKey | `b3da9481…001c8e` | true | https://preprod.cardanoscan.io/transaction/b3da94815002b9339390d76491b961da161595c18ff31ce0f1ea2ecbf9001c8e |
| Init pool | `1be3c892…52c0f9` | true | https://preprod.cardanoscan.io/transaction/1be3c892140bac8b6ed0db3d5e90ff71a21aed86edf2dfe1de53837a4a52c0f9 |
| Deposit | `34f216e7…747a8a` | true | https://preprod.cardanoscan.io/transaction/34f216e73ac4a209a9d392c34ca8e7df6e2ec2a5859d217fe747843ab8747a8a |
| **Borrow (on-chain ZK)** | `19d9016a…bb2b37` | true | https://preprod.cardanoscan.io/transaction/19d9016ad95c3c410e8d66ce469a3f5e4cf2b329380555993fa1028110bb2b37 |
| **Repay (on-chain ZK)** | `8b934c05…4a76cf6` | true | https://preprod.cardanoscan.io/transaction/8b934c059ab1d352f47277181bb871875907dd34c5506b1e75ac7a8e44a76cf6 |
| **Unlock (on-chain ZK)** | `24281542…1ed609` | true | https://preprod.cardanoscan.io/transaction/24281542de3ab7e71e5a683917bd053d5a698ae2dfbf8daac0cf2346771ed609 |

### Deployed script hashes (Preprod)

- `lending_pool_v5`: `0686aaaf136fde2af6aa1f78af30bc67d0aa410461c4bfb5877eb199`
- `collateral_v5`: `f88347ff9ee0ffbdbb575d94c76803ca319e1471fe2c2697ce852aef`

---

## Pre-publish checklist (user-gated)

- [ ] Confirm no secret values are committed (`.env` is git-ignored; receipts contain a
      test-only deposit secret for an already-unlocked UTxO — safe, but review before public push).
- [ ] `git push` branch `v5` to GitHub (currently committed locally only).
- [ ] Paste the six cardanoscan links + doc paths into the Catalyst M3 evidence form.
