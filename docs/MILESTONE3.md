# Milestone 3 — Private Lending with On-Chain zk-SNARK Verification

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** zk-SNARK proofs *verifiable on-chain* for **private** verification
of collateral and loan transactions.
**Status:** Delivered and demonstrated live on Cardano **Preprod**.

---

## 1. Protocol overview

The ZK-DeFi-Protocol lets a user deposit collateral, borrow against it, repay with
interest, and reclaim the collateral — where every borrow, repayment and unlock is
authorized by a real **Groth16 zk-SNARK proof verified on-chain**, with **no owner
or admin signature**. Two Plutus V3 validators implement it (`contracts/validators/v5/`):

| Validator | Script hash (Preprod) | Role |
|---|---|---|
| `lending_pool_v5` | `3fe6fa031e1d97cb2b271a6341ea9909961cc00e63eeca820d47cc65` | Pool liquidity; authorizes `BorrowAnonymous` / `RepayAnonymous` on-chain; keeps the outstanding-loan set and the admin-published commitment-set root |
| `collateral_v5` (parameterised by the pool hash) | `2bcc23434d83f47ffa474a906d6d57cc24fdd190e1234371827a1593` | Holds collateral (fixed denomination) with a commitment; authorizes `UnlockDeposit` on-chain, gated on the loan being settled |

The two verification keys are parked once as inline datums on an **unspendable
(always-false) UTxO** and consumed only as **read-only reference inputs**.

### Privacy model

1. **Amount confidentiality.** The collateral amount is **never on-chain** — it is a
   private circuit witness, and collateral is held in a **fixed denomination**, so
   the UTxO value reveals only "one unit", not the position size. **Loans are also a
   fixed denomination**, so every loan payout is identical and loan amounts carry no
   per-loan information (the outstanding-loan set stores only nullifiers).
2. **Deposit ↔ borrow unlinkability.** A borrow proves the collateral commitment is a
   **member of the on-chain commitment set** (a Merkle root) — it does **not**
   reference a specific deposit UTxO. Nobody can tell which deposit backs a loan.
3. **Repayment-gated unlock.** A loan is tracked only by a **nullifier**
   `Poseidon255(secret, external_nullifier)` recorded in the pool's `open_loans`.
   Repayment removes it; a deposit can only be unlocked once its nullifier is absent
   (settled). This makes "unlock collateral without repaying" impossible.

### The full private lending cycle (confirmed live on Preprod)

| # | Step | Preprod tx |
|---|------|-----------|
| 1 | **Park VKeys** — borrow + unlock verification keys on an always-false UTxO | [`ee6b270f…`](https://preprod.cardanoscan.io/transaction/ee6b270fdb93ec1720af401e67a6d7db2c5fe1304e4bbeeb9e1f6ee3871be0c3) |
| 2 | **Init pool** — `PoolDatumV5` (liquidity, ratio, both vkey refs, loan denomination, empty commitment set, empty loan set, admin) | [`8a106cb2…`](https://preprod.cardanoscan.io/transaction/8a106cb2dda054ab783a289bcdc4123b8bb8a881879c53abbeb566a87e143ea4) |
| 3 | **Deposit** — lock collateral with `DepositDatumV5 { commitment, timestamp }`; `commitment = Poseidon255(collateral_amount, secret)`; the secret + amount never leave the depositor | [`686989ff…`](https://preprod.cardanoscan.io/transaction/686989ff429a4ddcd89e61da07bda255c3b5b8d444f447a59912585335e99e17) |
| 3b | **Publish set root** — admin `SetGroupRoot` updates the Merkle root of the commitment set | [`03c6e636…`](https://preprod.cardanoscan.io/transaction/03c6e636545f95d4588b19139f6d3366fef7179964c5d1e0c4ce22f35f16aa84) |
| 4 | **Borrow** — `BorrowAnonymous { proof, loan_amount, loan_nullifier }`; the validator runs `groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext])` **on-chain**; **no collateral UTxO is referenced**; loan paid out; nullifier recorded | [`f473f9c1…`](https://preprod.cardanoscan.io/transaction/f473f9c159c024d2b2c557f3fc06f8768833f155c0512a082645ad36213cad9d) |
| 5 | **Repay** — `RepayAnonymous`; re-attests membership + nullifier; pays **principal + interest**; removes the nullifier (settles the loan) | [`dfba747c…`](https://preprod.cardanoscan.io/transaction/dfba747c872948cd3de5f0515e785f4f747c3fb78651357ea88aa2248ea2a89a) |
| 6 | **Unlock** — `UnlockDeposit { proof, pool_ref, loan_nullifier }`; a commitment-bound proof + the pool reference input prove ownership and that the nullifier is settled; collateral freed **with no signature** | [`3af0d112…`](https://preprod.cardanoscan.io/transaction/3af0d112eda2e92290532a1ac11da44844c7169969d48f1a0ab498c972905f69) |

Off-chain drivers (Mesh, Node ESM): `offchain/cli/v5/{1-park-vkey, 2-init-pool,
3-deposit, 3b-setgrouproot, 4-borrow, 5-repay, 6-unlock}.mjs`, shared helpers in
`offchain/cli/v5/common.mjs`. The Mesh tx builder uses `autoEvaluate` for ExUnits.

---

## 2. zk-proof generation mechanism

Two BLS12-381 Groth16 circuits (`circuits/`), both hashing with **Poseidon255**
(`poseidon-bls12381`) so the in-circuit and on-chain commitment are identical.

### Borrow / repay — `collateral_semaphore.circom`

Proves, in zero knowledge, that a **member** of the commitment set is
sufficiently collateralized, without revealing which one or by how much.

- **Public signals:** `[group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:** (1) `leaf = Poseidon255(collateral_amount, secret)`; (2) Merkle
  membership `leaf ∈ group_merkle_root` (depth 10, Poseidon255 nodes); (3)
  `loan_nullifier = Poseidon255(secret, external_nullifier)`; (4) sufficiency
  `collateral_amount·100 ≥ loan_amount·collateral_ratio`; (5) range checks.

### Unlock — `unlock_proof.circom`

Binds to the **specific** deposit being spent (so nobody can unlock another user's
collateral) and derives the same nullifier for the settlement gate.

- **Public signals:** `[commitment, loan_nullifier, external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`
- **Constraints:** `commitment = Poseidon255(collateral_amount, secret)`;
  `loan_nullifier = Poseidon255(secret, external_nullifier)`; range checks.

**Trusted setup.** Each circuit has a fresh BLS12-381 powers-of-tau → `groth16 setup`
→ phase-2 contribution → `collateral_semaphore_final.zkey` / `unlock_proof_final.zkey`
+ `verification_key_*.json`. Proofs are generated off-chain with snarkjs and the
G1/G2 points are compressed into the on-chain `Proof` type. *The M3 setup is a
single-contributor developer ceremony — adequate to demonstrate the mechanism on
Preprod; a multi-party ceremony is required before mainnet (see M1 Appendix A).*

---

## 3. On-chain verification design

- **Generic Groth16 verifier (reused, not rebuilt):** `modulo-p/ak-381` v0.1.1
  provides `groth_verify(vk, proof, public)` for BLS12-381. `contracts/lib/zk.ak`
  wraps it as `verify_borrow_proof` (5 signals) and `verify_unlock_proof` (3 signals).
- **VKeys as reference inputs.** Both verification keys live at an always-false
  address, pinned by `PoolDatumV5.vkey_ref` / `unlock_vkey_ref`, read via `get_vkey`.
- **Public signals bound to trusted state.** `group_root`, `collateral_ratio`,
  `external_nullifier` come from the pool datum; `loan_nullifier` / `loan_amount`
  from the redeemer are cross-checked against the `open_loans` set and the pool
  value delta — a spender cannot feed the verifier convenient inputs.
- **No signatures on the anonymous paths.** The proof *is* the authorization.
- **Adversarial test suite.** `aiken check` runs 13 checks (0 warnings), including
  validator tests with real proofs: borrow-membership, reused-nullifier-fails,
  repay-with-interest, repay-below-interest-fails, unlock-when-settled,
  **unlock-blocked-while-loan-open**, unlock-wrong-commitment, and on-chain
  proof/tamper checks for both circuits.

---

## 4. Deployed addresses / hashes (Preprod)

| Component | Value |
|---|---|
| `lending_pool_v5` address | `addr_test1wql7d7srrcwe0jetyudxxs02nyyev8xqpe37aj5zp4ruceggseu8g` |
| `lending_pool_v5` hash | `3fe6fa031e1d97cb2b271a6341ea9909961cc00e63eeca820d47cc65` |
| `collateral_v5` address | `addr_test1wq4ucg6rfkplgll6ga9fqmtd2lxzflw3jrsjxsm3sfaptyc3taqhz` |
| `collateral_v5` hash | `2bcc23434d83f47ffa474a906d6d57cc24fdd190e1234371827a1593` |
| Compiler | Aiken v1.1.15, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow (5 signals, depth-10 membership), unlock (3 signals) |

---

## 5. Security & privacy model

The zk-SNARK proof is the **sole authorization** for every borrow, repayment and
unlock — no admin key, no owner signature. Three on-chain properties make that
trustworthy:

- **Bound to chain state.** Public signals are reconstructed from trusted state (the
  pool datum) and cross-checked against the loan set and pool balance delta.
- **Immutable verification keys**, pinned to unspendable reference UTxOs.
- **Repayment-gated unlock.** Collateral can only be freed once its loan nullifier is
  absent from `open_loans`, and the only way to remove it is a valid repayment.

### Privacy boundary (what we deliver, and the honest limits)

The protocol delivers a **set-membership + linkage** privacy model plus
**denomination-bucketed amount hiding**:

- **Delivered:** the collateral amount is never on-chain (fixed denomination + private
  witness); a borrow is unlinkable to any specific deposit (Merkle membership); the
  depositor's identity is not a signer on the anonymous paths (proof instead of key).

We state the limits plainly rather than overclaim — on a transparent UTXO ledger, ZK
hides information *within a set*, it does not make a public ledger opaque:

1. **Anonymity-set size.** Privacy scales with the number of deposits sharing a
   denomination; on a young protocol the practical set is small even though the
   mechanism is sound. It improves with adoption, not with code.
2. **Timing.** ADA entering (deposit) and leaving (loan payout,
   repay) is visible; fixed denominations blur amounts inside the set but timing
   correlation can still relate activity. Timing resistance is out of scope for M3.
3. **Fee-payer.** The wallet that pays fees is visible; sender-level anonymity needs a
   relayer (as Tornado Cash uses).
4. **Anonymity set is admin-curated.** For M3 the commitment-set root is published by
   the protocol admin (`SetGroupRoot`), mirroring the reference Cardano-Semaphore
   group model.
5. **Nullifier set.** Stored as a list for M3; a Merkle-Patricia-Forestry set is the
   scale upgrade.

Cardano L1 was chosen deliberately (M1 §1.2) rather than the Midnight privacy
sidechain; the L1 privacy ceiling is genuinely lower than a purpose-built privacy
chain, and M3 targets that realistic ceiling and documents the boundary honestly.

The approved M1 (architecture) and M2 (smart contracts) Proofs of Achievement are
re-published in-repo at [`docs/poa/M1-POA.pdf`](poa/M1-POA.pdf) and
[`docs/poa/M2-POA.pdf`](poa/M2-POA.pdf).

---

## 6. Next steps (Milestone 4)

Milestone 4 adds a simple web UI over the protocol demonstrated here — CIP-30 wallet
integration, in-browser proof generation, and a guided deposit → borrow → repay →
unlock flow — followed by user testing.
