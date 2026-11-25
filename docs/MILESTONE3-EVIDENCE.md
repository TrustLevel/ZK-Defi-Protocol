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
| Park address of the verification keys and reference scripts (no transaction can spend it) | hash over the flat program of `contracts/validators/always_false.ak`, derived in `packages/protocol/test/park.test.mjs` |
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
| pumbiii | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-08-26.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-08-26.md) | before the private model (v5) | feedback template |
| pumbiii (break-it) | 2026-09-01 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-09-01.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-09-01.md) | `m3-poa-v2` (the report calls it the v6 private model, branch `m3-remediation-v6`) | [archived runbook 2](Tester-Feedback/archive/MILESTONE3-TESTER-RUNBOOK-2-breakit.md) |
| pumbiii (break-it) | 2026-11-18 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | `m3-poa-v4` (before lender side, asset pools and nullifier sets) | [runbook 3 as of `m3-poa-v4`](https://github.com/TrustLevel/ZK-Defi-Protocol/blob/m3-poa-v4/docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-3-breakit.md) |
| pumbiii (negative tests) | 2026-11-25 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-25.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-25.md) | `m3-v6-rc3` (setup and validator suite first on `m3-v6-rc2`; the validators are the same) | [runbook 4](Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-4-negative-tests.md) |

The 2026-11-18 report's finding (attack 9: repayment nullifier not bound to the repaid
loan) is resolved in commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3), which this
stand includes (see `docs/MILESTONE3.md` §5, Independent testing).

**The 2026-11-25 run on this stand:** own ADA and USD pools, both baseline cycles, the validator suite (109/109), each
of the 16 negative cases of runbook 4 confirmed against the test that covers it, and a
live sample on Preprod. Unlock without repayment (case 1) and a second withdrawal of
the same share (case 12a) were refused; case 9a (repay that appends another deposit's
`R`) was not run live and is covered by `repay_with_foreign_repay_nullifier_fails`. No
invalid transaction was accepted. The run found one gap in the client: `verifyPool` did
not check a pool's nullifier scalars and parameters at init, so a pool initialized with
another `repay_external_nullifier` would have passed the check and locked its
collateral. Commit [`ce46d49`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/ce46d49)
adds the check, with `packages/protocol/test/verify-pool.test.mjs`, and the tester
confirmed it live on a deliberately misconfigured pool
([`9ea0cb1abf42…`](https://preprod.cardanoscan.io/transaction/9ea0cb1abf4298689fdbb1200e06b56ec0d7b23d079746885b4abaeb98bea770)).

The tester's baseline transactions (all `valid_contract: true`):

| Step | Preprod tx |
|---|---|
| Park keys | [`05e1b928c67c…`](https://preprod.cardanoscan.io/transaction/05e1b928c67ce41d848cbdd4384733496fa4982a8b5982a757a3dc4359355e21) |
| Init ADA pool | [`d1bd53a6f496…`](https://preprod.cardanoscan.io/transaction/d1bd53a6f496b0d45b9e0abd7c570b8fa3730bba519f4b10d006a1f1f9d0d45b) |
| Reference scripts (ADA pool) | [`9ed5eed1299b…`](https://preprod.cardanoscan.io/transaction/9ed5eed1299bd5e11a83a1c78bcdec867871d4428777296d58f3c60fdecafc81) |
| Init USD pool | [`aa86b2fc09fc…`](https://preprod.cardanoscan.io/transaction/aa86b2fc09fc75a0924f33c2f6461fc9ebe95339a8c97b8e2b7d348edf148427) |
| Reference scripts (USD pool) | [`3ef9d9b5139c…`](https://preprod.cardanoscan.io/transaction/3ef9d9b5139c538a13560e13786782425144860503440eb17fc837545e53613d) |
| ADA: two shares | [`e9b0e3bc0e2c…`](https://preprod.cardanoscan.io/transaction/e9b0e3bc0e2c672ac433dcfa138010faa9b30a5797d610f24cd6de5cd2d138f3), [`a902ed19b611…`](https://preprod.cardanoscan.io/transaction/a902ed19b6113320b5d67129e009e42c9b17403b2c0b86886fa5bfdee70a4172) |
| ADA: deposits of 20 ADA and 500 TOK | [`436df8bd5388…`](https://preprod.cardanoscan.io/transaction/436df8bd53880d1ba312a193a090191034df6ef39011276acd41350385af7b69), [`1c1ceba3028c…`](https://preprod.cardanoscan.io/transaction/1c1ceba3028ca8885e4a2260d145e3b5af4729e2afe0762a58b7753744784696) |
| ADA: relayed borrow | [`418e212e5494…`](https://preprod.cardanoscan.io/transaction/418e212e549423b606923d3334499ab39606a5e70025def9e0e395e7b15ec057) |
| ADA: repay | [`91e5424fee48…`](https://preprod.cardanoscan.io/transaction/91e5424fee48a14e8c68dff7b141633fbfc4c6a8abaa5b01a5ab16e722c76328) |
| ADA: relayed unlock | [`98a6d4449ca4…`](https://preprod.cardanoscan.io/transaction/98a6d4449ca454b3ed365071721ccac090ebe64c1e05e25c76c4acd04772a3ef) |
| ADA: relayed share withdrawal | [`96a90052e25e…`](https://preprod.cardanoscan.io/transaction/96a90052e25eb1732d884199c9e87079a9db2b2f0b0ce2f95845b5019051a178) |
| USD: two shares | [`f27694ec9535…`](https://preprod.cardanoscan.io/transaction/f27694ec9535038be3825bc591d73ef25d24a2d3d12e6a018434d5c370b4f28f), [`5680ff9f4924…`](https://preprod.cardanoscan.io/transaction/5680ff9f4924904801e627c2dc7ad89e2d7c97b775b5c496b1d050b80dc45898) |
| USD: deposit of 20 ADA | [`bc52884c396a…`](https://preprod.cardanoscan.io/transaction/bc52884c396acf98a3831db1888cb5ba20bdb1120fec4b40bb48576557651042) |
| USD: relayed borrow | [`b4d724271069…`](https://preprod.cardanoscan.io/transaction/b4d7242710696b66e12b3b24479ab31dfad2f2278909aab70eb2ec1fef6b795e) |
| USD: repay | [`fa2a5b784ee4…`](https://preprod.cardanoscan.io/transaction/fa2a5b784ee4d9419597dee50fd88a7eafa099ba4a4955bda0b9437d705b2c06) |
| USD: relayed unlock | [`71a8aa0b10d2…`](https://preprod.cardanoscan.io/transaction/71a8aa0b10d270da42c4522209c23caca6aac54d0e38a98b2c827cf5ea3a02ec) |
| USD: relayed share withdrawal | [`a85d667f17a5…`](https://preprod.cardanoscan.io/transaction/a85d667f17a5f617162678446a88253005278600d2d0fd203731eb9aebb5ce08) |
| Live sample: deposit, borrow, withdrawal | [`56efb2d7b2f3…`](https://preprod.cardanoscan.io/transaction/56efb2d7b2f322e72d0540c2f1763c10d78b7d58ff41f6c2deb97fd2d7fdbe78), [`5ac48674b396…`](https://preprod.cardanoscan.io/transaction/5ac48674b396e809e9214c64f2530f4e0b23bf71221d29a0e9cf001f1c2778cb), [`86425f42d5d5…`](https://preprod.cardanoscan.io/transaction/86425f42d5d5b890f3121136c4995f6a089e712f0e1f7f40012b0198540e8997) |

The runbooks of earlier runs are kept in [`Tester-Feedback/archive/`](Tester-Feedback/archive/).

---

## Live on-chain proof (Preprod)

Two pools on the same validator code and keys, one lending ADA and one lending a
native token, each run through the full private cycle with a separate address for every
share, deposit, loan and payout.

- The cycle step by step, with what each transaction verifies: [`MILESTONE3.md`](MILESTONE3.md) §1
- Deployed addresses, script hashes and execution cost: [`MILESTONE3.md`](MILESTONE3.md) §4
- Every transaction of both cycles with its fee: [`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md) §3

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v6`**. Cite the tagged
tree, not `main`.
