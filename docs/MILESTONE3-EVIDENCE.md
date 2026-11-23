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
| Protocol module (script derivation, Merkle trees, proof generation, point compression, tx builders) | `packages/protocol/src/` |
| Command line client (every step, deploy, test tokens) | `offchain/cli/m4/run.mjs` |
| Deployments (Preprod) | `packages/protocol/deployments/preprod-m3-ada.json`, `preprod-m3-usd.json` |
| Reference relayer (borrow, unlock, lender withdraw) | `server/src/relayer.mjs` |

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
| On-chain proof tests | `contracts/lib/semaphore_onchain_test.ak`, `contracts/lib/lender_onchain_test.ak`, `contracts/lib/zk_onchain_test.ak` |
| Adversarial validator tests | `contracts/validators/tests/v6_validator_test.ak`, `contracts/validators/tests/lender_test.ak`, `contracts/validators/tests/pool_nft_test.ak` — `cd contracts && aiken check` |
| Circuit tests | `circuits/tests/collateral-circuits.test.mjs`, `circuits/tests/lender-withdraw.test.mjs` |
| Protocol module tests, incl. golden tests against both Preprod cycles | `packages/protocol/test/` (`m3-cycle.test.mjs`, fixtures in `test/fixtures/` fetched by `scripts/fetch-cycle.mjs`) |
| Relayer tests | `server/test/relayer.test.mjs` |
| Fixture generators | `circuits/tests/gen-semaphore-fixture.cjs`, `circuits/tests/gen-lender-fixture.cjs` |

Tallies: aiken **107/107**, circuits **21/21**, protocol module **41/41**, relayer
**27/27**, live cycles **18/18** `valid_contract: true`. Pass/fail rates, edge cases,
performance and tester feedback: `docs/MILESTONE3-TEST-RESULTS.md`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary + note to reviewer | `docs/MILESTONE3.md` |
| Test results | `docs/MILESTONE3-TEST-RESULTS.md` |
| This evidence index | `docs/MILESTONE3-EVIDENCE.md` |
| Break-it runbook for testers | `docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-3-breakit.md` |
| Approved M1 / M2 POAs (re-published) | `docs/poa/M1-POA.pdf`, `docs/poa/M2-POA.pdf` |

### Independent tester reports

Each report is published as written by its tester and dated; it covers the
protocol stand that was current on that date.

| Tester | Date | Report | Guided by |
|---|---|---|---|
| pinusch100 | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pinusch100.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pinusch100.md) | feedback template |
| pumbiii | 2026-08-26 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii.md) | feedback template |
| pumbiii (break-it) | 2026-09-01 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-v6.md) | [archived runbook 2](Tester-Feedback/archive/MILESTONE3-TESTER-RUNBOOK-2-breakit.md) |
| pumbiii (break-it) | 2026-11-18 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | [runbook 3 as of `m3-poa-v4`](https://github.com/TrustLevel/ZK-Defi-Protocol/blob/m3-poa-v4/docs/Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-3-breakit.md) |

The 2026-11-18 report's finding (attack 9: repayment nullifier not bound to the repaid
loan) is resolved in commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3), which this
stand includes (see `docs/MILESTONE3.md` §5, Independent testing).

Earlier runbooks are kept in [`Tester-Feedback/archive/`](Tester-Feedback/archive/).

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every action authorized by an **on-chain** Groth16 proof (no admin,
no signature).

Two pools on the same scripts and keys. Every transaction `valid_contract: true`;
fees and the USD cycle in `docs/MILESTONE3-TEST-RESULTS.md` §3.

**Pool 1 lends ADA, collateral 20 ADA or 500 TOK:**

| Step | Tx hash |
|---|---|
| Park the five verification keys | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) |
| Init pool + mint pool NFT | [`23ad89841705…`](https://preprod.cardanoscan.io/transaction/23ad898417055e231c585d1a12398a5892eb04688b258913cc5d66a6fa6cffa0) |
| **Add liquidity** (two shares, append proofs into `lender_root`) | [`13f3793d1a45…`](https://preprod.cardanoscan.io/transaction/13f3793d1a45e1d59bc4e682dd87f819198fde8b956256abccc25e2f4754a914), [`2c62c4cfe0e1…`](https://preprod.cardanoscan.io/transaction/2c62c4cfe0e1592a4f151b185118217c43ce21d2a5e72abfe1906fd395376c6e) |
| **Deposit 20 ADA and 500 TOK** (one commitment set) | [`8d944e16e29d…`](https://preprod.cardanoscan.io/transaction/8d944e16e29d18ac2b1a92a806cebcb411a47c72846fcc8e60fcb2eb037b26af), [`a3cd4c5ce665…`](https://preprod.cardanoscan.io/transaction/a3cd4c5ce665c847e8cae525ae31b31ec2d193ca4c7afcfbc0159f2a4caadb71) |
| **Borrow** (membership proof, recipient-bound, relayed; backed by the TOK deposit) | [`581389f0d725…`](https://preprod.cardanoscan.io/transaction/581389f0d725b83137788cd22e3bcf817cf500962f9a0bfe3f5e3bb181345b26) |
| **Repay** (principal + interest; repay proof binds `R`; appends `R`) | [`19dc3cbfd6a9…`](https://preprod.cardanoscan.io/transaction/19dc3cbfd6a97a6e587653a47deb3ac258dff05177ef4fc2640b03fbb0a45da3) |
| **Unlock** (settlement proof, no signature, relayed; 500 TOK returned) | [`348685706bbb…`](https://preprod.cardanoscan.io/transaction/348685706bbb2689c5882d79e4ae55514323f278c59feea8b97798e167e4fda1) |
| **Withdraw a share** (lender withdraw proof, relayed) | [`f37d96ec8826…`](https://preprod.cardanoscan.io/transaction/f37d96ec8826d1d812103d50688be90cd4896823b873006a6295f378979998b0) |

**Pool 2 lends USD:** init [`c91b566c4aaf…`](https://preprod.cardanoscan.io/transaction/c91b566c4aaf84e13e7f17a2fee1e742cf6c00c4d04a6ab65b9aedec571d13a9),
borrow [`c62b2f4142d9…`](https://preprod.cardanoscan.io/transaction/c62b2f4142d9215076db2c335bb575a63a1caa419b8f90ad30c37da55aeddd24),
repay [`44cc6137bdcc…`](https://preprod.cardanoscan.io/transaction/44cc6137bdccca08b801982cb3dd073439cf638eecfe7e94c0dc6392b53ed2bd),
withdraw [`913e5f21c68f…`](https://preprod.cardanoscan.io/transaction/913e5f21c68fc6a56e59755ebe789622187c2d68c57eab7dc17d5245e40a1a2e).

### Deployed scripts (Preprod)

| | Pool 1 (ADA) | Pool 2 (USD) |
|---|---|---|
| Pool NFT policy | `859075f221d672187f5fff95fc3a4be995238509ef124e8e2d85ffac` | `07bfaef56473e52fefeb2003bcfbd5c92101770394cad97b3bce1bc8` |
| `lending_pool_v5` | `5e40259d6bae4053e91bf2bbb21b5e5a1028ae60a712d39b59695a68` | `83f0f362525d2b5d7622947cc24e20cd152db024117d8e5583592a58` |
| `collateral_v5` | `c9450bfc1cc5fe4b6bf5aa5a4c1bd347aa2ac38c455f8a2ebdb1e9dc` | `f1933896f08d1a3dc7d80e3a64ecc9ee088bd73e4ebd57b416b655ac` |

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v6`**. Cite the tagged
tree, not `main`.
