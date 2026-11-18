# Milestone 3 — Evidence Index

Maps each Catalyst M3 required-evidence item to concrete repo paths and live
on-chain proof. All links are Cardano **Preprod**. M3 acceptance requires:
zk-SNARK proofs verifiable **on-chain** for **private** verification of collateral
and loan transactions.

---

## ✅ Item 1 — Published zk-SNARK integration code

| Layer | Path |
|---|---|
| Borrow circuit (Merkle membership + nullifier + recipient binding) | `circuits/collateral_semaphore.circom` (BLS12-381, Poseidon255, 6 signals) |
| Repay circuit (membership + loan nullifier and repayment nullifier from one secret) | `circuits/repay_proof.circom` (7 signals) |
| Unlock circuit (settlement: commitment + repaid-set membership) | `circuits/settlement_proof.circom` (3 signals) |
| Append circuit (permissionless insertion into the commitment set and the repaid set) | `circuits/append_proof.circom` (4 signals) |
| Poseidon255 lib | `circuits/lib/poseidon255.circom` |
| On-chain verifier wrappers | `contracts/lib/zk.ak` (`verify_borrow_proof`, `verify_repay_proof`, `verify_settlement_proof`, `verify_append_proof`, `get_vkey`) |
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
| Repay keys | `circuits/keys/repay_proof_final.zkey`, `verification_key_repay.json`, `circuits/repay_proof_js/repay_proof.wasm` |
| Settlement keys | `circuits/keys/settlement_proof_final.zkey`, `verification_key_settlement.json`, `circuits/settlement_proof_js/settlement_proof.wasm` |
| Append keys | `circuits/keys/append_proof_final.zkey`, `verification_key_append.json`, `circuits/append_proof_js/append_proof.wasm` |

## ✅ Item 3 — Published summary of test results

| Artifact | Path |
|---|---|
| Test-results summary | `docs/MILESTONE3-TEST-RESULTS.md` |
| On-chain proof + adversarial validator tests (54/54) | `contracts/lib/semaphore_onchain_test.ak`, `contracts/validators/tests/v6_validator_test.ak`, `contracts/validators/tests/pool_nft_test.ak` — `cd contracts && aiken check` |
| Fixture generator | `circuits/tests/gen-semaphore-fixture.cjs` |

Tallies: aiken **54/54** (0 warnings), live cycle **6/6** `valid_contract: true`.

## ✅ Item 4 — Published documentation

| Artifact | Path |
|---|---|
| Protocol + privacy model + zk mechanism + on-chain design + trust assumptions + non-goals + privacy boundary | `docs/MILESTONE3.md` |
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
| pumbiii (break-it) | 2026-11-18 | [`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) | [runbook 3](Tester-Feedback/MILESTONE3-TESTER-RUNBOOK-3-breakit.md) on `m3-poa-v4` |

The 2026-11-18 report's finding (attack 9: repayment nullifier not bound to the repaid
loan) is resolved in commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3), which this
stand includes (see `docs/MILESTONE3.md` §5, Independent testing).

Earlier runbooks are kept in [`Tester-Feedback/archive/`](Tester-Feedback/archive/).

---

## Live on-chain proof (Preprod) — the M3 core claim

Private lending, every action authorized by an **on-chain** Groth16 proof (no admin,
no signature). All six transactions `valid_contract: true`:

| Step | Tx hash | valid_contract |
|---|---|:---:|
| Park VKeys | [`edbfae0e6704…b2be1132`](https://preprod.cardanoscan.io/transaction/edbfae0e6704086b0f9feddf30c83544c10406faf729792ba57bbdc4b2be1132) | true |
| Init pool + mint pool NFT | [`e2ecaa36399f…b1b5390e`](https://preprod.cardanoscan.io/transaction/e2ecaa36399f9732f6c56b76489ae58d7b5beaa6aa69a0150ce6ef26b1b5390e) | true |
| **Deposit (on-chain append proof into the commitment set)** | [`e63eeaab7526…e4b7fbc1`](https://preprod.cardanoscan.io/transaction/e63eeaab75266f138bf283a705ce741da3c2e805104e2fe18889668be4b7fbc1) | true |
| **Borrow (on-chain membership ZK, recipient-bound)** | [`8be8d71a2950…2a468bf1`](https://preprod.cardanoscan.io/transaction/8be8d71a29509f9446aff7d668181470a92e5741af9a8d966cdeee232a468bf1) | true |
| **Repay (principal + interest; repay proof binds R; appends R)** | [`fad24d65ede8…a869cf60`](https://preprod.cardanoscan.io/transaction/fad24d65ede8b625ebe6a7f22684fcdb33803f50b5445c1d72ee857ca869cf60) | true |
| **Unlock (settlement proof, no signature, no borrow-shared value)** | [`64f9e36847b7…b48584b9`](https://preprod.cardanoscan.io/transaction/64f9e36847b7774a69714f944f448c0496795eaa2621c80c83e02324b48584b9) | true |

Economics: pool 100 → 90 → 100.5 ADA; collateral (20 ADA) released to the deposit's
`unlock_to` address. Unlock succeeds **only after** repay inserts `R` into
`repaid_root`, and it needs no admin step.

### Deployed scripts (Preprod)

- Pool NFT policy: `4346c33b38b46f5b34b60b86bc9ba4ea55f392a3c4cc4cafd060c6ce` (token `POOL`)
- `lending_pool_v5`: `8b15840cc3feac88fb000d4ffe25a108aaba37d4786161719d4d25ea`
- `collateral_v5`: `45b1b0147e0e9d3b0c87f53cfd482ad17170ed0654056207b9503c0c`

---

## Immutable evidence

This POA corresponds to the stand tagged **`m3-poa-v5`**. Cite the tagged tree, not
`main`.
