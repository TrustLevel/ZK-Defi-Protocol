# Milestone 3 — Evidence Index

Maps each Catalyst M3 required-evidence item to concrete repo paths and live
on-chain proof. All links are Cardano **Preprod**. M3 acceptance requires:
zk-SNARK proofs verifiable **on-chain** for **private** verification of collateral
and loan transactions.

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

Tallies: aiken **109/109**, circuits **21/21**, protocol module **52/52**, relayer and
chain reader **30/30** (one live test each, skipped without a Blockfrost key), live
cycles **20/20** `valid_contract: true`. Pass/fail rates, edge cases,
performance and tester feedback: `docs/MILESTONE3-TEST-RESULTS.md`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary + note to reviewer | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Break-it runbook for testers | `docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-4-breakit.md` |
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

The break-it run on this stand (`m3-v6-rc1`) follows
[runbook 4](Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-4-breakit.md); its report is added
here before the stand is tagged `m3-poa-v6`. Earlier runbooks are kept in
[`Tester-Feedback/archive/`](Tester-Feedback/archive/).

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every action authorized by an **on-chain** Groth16 proof (no admin,
no signature).

Two pools on the same scripts and keys. Every transaction `valid_contract: true`;
fees and the USD cycle in `docs/MILESTONE3-TEST-RESULTS.md` §3.

Roles on separate addresses: lender L, depositor D, unlock address U, borrower B,
relayer R, share payout P (see `docs/MILESTONE3-TEST-RESULTS.md` §3).

**Pool 1 lends ADA, collateral 20 ADA or 500 TOK:**

| Step | Tx hash |
|---|---|
| Park the five verification keys | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) |
| Init pool + mint pool NFT (empty nullifier sets) | [`3acf4248a5cb…`](https://preprod.cardanoscan.io/transaction/3acf4248a5cbffb2c3571ae7aa1c52154602d8a7fa52daf1c29d4c8bd6d5e059) |
| Publish pool and collateral scripts as reference scripts | [`5d90207c5c14…`](https://preprod.cardanoscan.io/transaction/5d90207c5c14d9185d0f97ae76c585cd45dca7b118048cc07cddaeb3a3d50791) |
| **Deposit 20 ADA and 500 TOK** (D; one commitment set) | [`9f7f17cad29f…`](https://preprod.cardanoscan.io/transaction/9f7f17cad29f2e3e584728cb74e595279f23e61d8bf0e9a38bae47e918f974a3), [`fa297a3a89bf…`](https://preprod.cardanoscan.io/transaction/fa297a3a89bfdcf36ee9767e65373480408536ab1ced5347529bcb91099ca926) |
| **Add liquidity** (L; two shares, append proofs into `lender_root`) | [`c75f5bd192e3…`](https://preprod.cardanoscan.io/transaction/c75f5bd192e344809ef52cdf4c2eb57b478541238b0a0755b085e3758d715df9), [`29344705f1fa…`](https://preprod.cardanoscan.io/transaction/29344705f1fadf774f0fc8b6847aab13b4db5879ca7759c2955e8ebaca52125b) |
| **Borrow** (membership proof, recipient-bound, MPF insert; relayed by R to B; backed by the TOK deposit) | [`b219752d2a64…`](https://preprod.cardanoscan.io/transaction/b219752d2a646c5e67f0302ad949eacea0940913ec5f8a148a32088948fd5b42) |
| **Repay** (B; principal + interest; repay proof binds `R`; appends `R`; MPF open → settled) | [`f854d3c38034…`](https://preprod.cardanoscan.io/transaction/f854d3c380343d1bc5e4857aa4b1a4f77e4fa2c13e1eeb1b5637181f52135aa9) |
| **Unlock** (settlement proof, no signature; relayed by R; 500 TOK to U) | [`101b958540d6…`](https://preprod.cardanoscan.io/transaction/101b958540d60b074b13c8bada78e6ab4f872d6917255e9bb2517f03f2f55048) |
| **Withdraw a share** (lender withdraw proof, MPF insert; relayed by R to P) | [`b4c42d0cb457…`](https://preprod.cardanoscan.io/transaction/b4c42d0cb457679afa75166c13ccd943675840cdec8e9a6ccc82ef5b14ac5496) |

**Pool 2 lends USD:** init [`baaafc06a45d…`](https://preprod.cardanoscan.io/transaction/baaafc06a45dc37979c2a82e2e95a6adb8ddf25811b5069ee9c98e8197d9ae15),
borrow [`a7f3f565da9d…`](https://preprod.cardanoscan.io/transaction/a7f3f565da9d33b42ed1a35d2f0393d775228178c8a61823b85a4a37d83f2624),
repay [`c1ce59019185…`](https://preprod.cardanoscan.io/transaction/c1ce59019185b7c3cdddd578fad1bb1d9ed45d74be8a0b6d61d71300e4e67517),
withdraw [`ed53a299f0d3…`](https://preprod.cardanoscan.io/transaction/ed53a299f0d3263efd6298331d225a34baa339c42ca79b98de4509c604fa26bf).

### Deployed scripts (Preprod)

| | Pool 1 (ADA) | Pool 2 (USD) |
|---|---|---|
| Pool NFT policy | `1c00069bd09cb3e6a5d32f5a8e7b852144a8004ede70963e14c20b1a` | `dcc6a744032782058554e242b23dc9d66ac287bf351d122aa8d8bd1f` |
| `lending_pool_v5` | `9a81be8900f34a86e80c1a7f6345abe5bd86f60b4700a047e513a3b0` | `102cda4952391ac02b95234a26fb9852655f07b8a9846447c438abbf` |
| `collateral_v5` | `388d33810aee0ba246179fd2d970f76a790f72f771159e0c5301698a` | `163bb361d8fc9b0e78347cc955df2750de39e0a577d6c3fd4ad0ea26` |

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v6`**. Cite the tagged
tree, not `main`.
