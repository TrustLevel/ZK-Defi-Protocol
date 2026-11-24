# Milestone 3 — Evidence Index

Maps each Catalyst M3 evidence item to the repo paths that hold it. The acceptance
criteria and where each is met: [`MILESTONE3.md`](MILESTONE3.md) §7. All on-chain
links are Cardano **Preprod**.

---

## ✅ Item 1 — Published zk-SNARK integration code

| Layer | Path |
|---|---|
| Borrow circuit (membership in the collateral set across assets + nullifier + recipient binding) | `circuits/collateral_semaphore.circom` |
| Repay circuit (membership + loan nullifier and repayment nullifier from one secret) | `circuits/repay_proof.circom` |
| Unlock circuit (settlement: commitment + repaid-set membership) | `circuits/settlement_proof.circom` |
| Lender withdraw circuit (note membership + withdraw nullifier + recipient binding) | `circuits/lender_withdraw.circom` |
| Append circuit (permissionless insertion into the lender, commitment and repaid sets) | `circuits/append_proof.circom` |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrappers | `contracts/lib/zk.ak` |
| Redeemer / datum types | `contracts/lib/types_v5.ak` |
| Pool NFT minting policy (one-shot) | `contracts/validators/v5/pool_nft.ak` |
| Pool validator | `contracts/validators/v5/lending_pool_v5.ak` (AddLiquidity / WithdrawLiquidity / DepositCollateral / BorrowAnonymous / RepayAnonymous) |
| Collateral validator | `contracts/validators/v5/collateral_v5.ak` (UnlockDeposit) |
| Compiled blueprint | `contracts/plutus.json` |
| Protocol module (script derivation, Merkle trees, proof generation, point compression, tx builders, pool verification) | `packages/protocol/src/` |
| Nullifier sets (Merkle Patricia Forestry, `@aiken-lang/merkle-patricia-forestry` 1.3.1 off-chain, `aiken-lang/merkle-patricia-forestry` on-chain) | `packages/protocol/src/mpf.mjs`, `contracts/validators/v5/lending_pool_v5.ak` |
| Command line client (every step, deploy, test tokens) | `offchain/cli/m4/run.mjs` |
| Deployments (Preprod) | `packages/protocol/deployments/preprod-m3-ada.json`, `preprod-m3-usd.json` |
| Reference relayer (borrow, unlock, lender withdraw; daily limits) | `server/src/relayer.mjs` |

## ✅ Item 2 — Published zk-SNARK library

| Component | Source |
|---|---|
| Generic on-chain Groth16 verifier (BLS12-381) | `modulo-p/ak-381` v0.1.1 — `contracts/aiken.toml` / `aiken.lock` |
| Off-chain hash | `poseidon-bls12381` (Poseidon255), in-circuit and in `packages/protocol/src/crypto.mjs` |
| Borrow keys | `circuits/keys/collateral_semaphore_final.zkey`, `verification_key_semaphore.json`, `circuits/collateral_semaphore_js/collateral_semaphore.wasm` |
| Repay keys | `circuits/keys/repay_proof_final.zkey`, `verification_key_repay.json`, `circuits/repay_proof_js/repay_proof.wasm` |
| Settlement keys | `circuits/keys/settlement_proof_final.zkey`, `verification_key_settlement.json`, `circuits/settlement_proof_js/settlement_proof.wasm` |
| Lender withdraw keys | `circuits/keys/lender_withdraw_final.zkey`, `verification_key_lender_withdraw.json`, `circuits/lender_withdraw_js/lender_withdraw.wasm` |
| Append keys | `circuits/keys/append_proof_final.zkey`, `verification_key_append.json`, `circuits/append_proof_js/append_proof.wasm` |

## ✅ Item 3 — Published summary of test results

| Artifact | Path |
|---|---|
| Test-results summary | `docs/MILESTONE3-TEST-RESULTS.md` |
| On-chain proof tests | `contracts/lib/semaphore_onchain_test.ak`, `contracts/lib/lender_onchain_test.ak`; MPF cross-check `contracts/lib/set_fixture.ak` |
| Adversarial validator tests | `contracts/validators/tests/v6_validator_test.ak`, `contracts/validators/tests/lender_test.ak`, `contracts/validators/tests/asset_test.ak`, `contracts/validators/tests/pool_nft_test.ak` — `cd contracts && aiken check` |
| Circuit tests | `circuits/tests/collateral-circuits.test.mjs`, `circuits/tests/lender-withdraw.test.mjs` |
| Protocol module tests, incl. golden tests against both Preprod cycles | `packages/protocol/test/` (`m3-cycle.test.mjs`, fixtures in `test/fixtures/` fetched by `scripts/fetch-cycle.mjs`) |
| Relayer and chain reader tests | `server/test/relayer.test.mjs`, `server/test/chain-service.test.mjs` |
| Fixture generators | `circuits/tests/gen-semaphore-fixture.cjs`, `circuits/tests/gen-lender-fixture.cjs` |

Pass/fail rates, edge cases, performance and tester feedback:
[`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md).

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary + note to reviewer | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Approved M1 / M2 POAs (re-published) | `docs/poa/M1-POA.pdf`, `docs/poa/M2-POA.pdf` |

### Independent tester reports

Each report is published as written by its tester and dated; it covers the
protocol stand that was current on that date.

| Tester | Date | Report | Stand | Guided by |
|---|---|---|---|---|
| pinusch100 | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pinusch100.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pinusch100.md) | before the private model (v5) | feedback template |
| pumbiii | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii.md) | before the private model (v5) | feedback template |
| pumbiii (break-it) | 2026-09-01 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md) | `m3-poa-v2` | [archived runbook 2](Tester-Feedback/archive/MILESTONE3-TESTER-RUNBOOK-2-breakit.md) |
| pumbiii (break-it) | 2026-11-18 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | `m3-poa-v4` (before lender side, asset pools and nullifier sets) | [runbook 3 as of `m3-poa-v4`](https://github.com/TrustLevel/ZK-Defi-Protocol/blob/m3-poa-v4/docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-3-breakit.md) |

The 2026-11-18 report's finding (attack 9: repayment nullifier not bound to the repaid
loan) is resolved in commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3), which this
stand includes (see `docs/MILESTONE3.md` §5, Independent testing).

The runbooks the testers followed are kept in
[`Tester-Feedback/archive/`](Tester-Feedback/archive/).

---

## Live on-chain proof (Preprod)

Two pools on the same scripts and keys, one lending ADA and one lending a native
token, each run through the full private cycle with a separate address per role.

- The cycle step by step, with what each transaction verifies: [`MILESTONE3.md`](MILESTONE3.md) §1
- Deployed addresses, script hashes and execution cost: [`MILESTONE3.md`](MILESTONE3.md) §4
- Every transaction of both cycles with its fee: [`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md) §3

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v6`**. Cite the tagged
tree, not `main`.
