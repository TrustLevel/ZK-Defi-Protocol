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
| `lending_pool_v5` | `4c09216852aec4b5254867f06f30ce73e560638ff32563d8abdc4ff5` | Pool liquidity; authorizes `BorrowAnonymous` / `RepayAnonymous` on-chain; keeps the outstanding-loan set and the admin-published commitment-set root |
| `collateral_v5` (parameterised by the pool hash) | `f027b9d8bf35fafd36836abd41bf6f0d414218561840d60a0a4031e7` | Holds collateral (fixed denomination) with a commitment; authorizes `UnlockDeposit` on-chain, gated on the loan being settled |

The two verification keys are parked once as inline datums on an **unspendable
(always-false) UTxO** and consumed only as **read-only reference inputs**.

### Privacy model

1. **Amount confidentiality.** The collateral amount is **never on-chain** — it is a
   private circuit witness, and collateral is held in a **fixed denomination**, so
   the UTxO value reveals only "one unit", not the position size.
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
| 1 | **Park VKeys** — borrow + unlock verification keys on an always-false UTxO | [`0f3d9603…`](https://preprod.cardanoscan.io/transaction/0f3d96031261456ebe5e9e6210b67cf398c4925e78ab049a996436f867247375) |
| 2 | **Init pool** — `PoolDatumV5` (liquidity, ratio, both vkey refs, empty commitment set, empty loan set, admin) | [`6cd76fb3…`](https://preprod.cardanoscan.io/transaction/6cd76fb343697f9f18af5982f27fe8336372dbaf35e7968497011759d953ce8a) |
| 3 | **Deposit** — lock collateral with `DepositDatumV5 { commitment, timestamp }`; `commitment = Poseidon255(collateral_amount, secret)`; the secret + amount never leave the depositor | [`4d1901c5…`](https://preprod.cardanoscan.io/transaction/4d1901c507fc5b4b2cea0bc420ae07e6a5a0f32e351f1c9d22b4d9ca07a9ec15) |
| 3b | **Publish set root** — admin `SetGroupRoot` updates the Merkle root of the commitment set | [`e9a5ffdf…`](https://preprod.cardanoscan.io/transaction/e9a5ffdfe6f35769b3b99749aec2a048c9758e8315bea9d99f0567d4d430076c) |
| 4 | **Borrow** — `BorrowAnonymous { proof, loan_amount, loan_nullifier }`; the validator runs `groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext])` **on-chain**; **no collateral UTxO is referenced**; loan paid out; nullifier recorded | [`bc620342…`](https://preprod.cardanoscan.io/transaction/bc62034295d37dc10b4fcaab05e33c38161f969867b340e76632a464a11bdebb) |
| 5 | **Repay** — `RepayAnonymous`; re-attests membership + nullifier; pays **principal + interest**; removes the nullifier (settles the loan) | [`e7933333…`](https://preprod.cardanoscan.io/transaction/e79333330567139c844ccc57f4b6ac4e5aba98972dd29f6b5df11304585d5789) |
| 6 | **Unlock** — `UnlockDeposit { proof, pool_ref, loan_nullifier }`; a commitment-bound proof + the pool reference input prove ownership and that the nullifier is settled; collateral freed **with no signature** | [`c4492a39…`](https://preprod.cardanoscan.io/transaction/c4492a390bfbb807b477b7d50d3df22ff31de15e7a66b4349e7f1e2a5dca1720) |

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
| `lending_pool_v5` address | `addr_test1wpxqjgtg22hvfdf9fpnlqmeseee72crr3lej2c7c40wylag8xq2nd` |
| `lending_pool_v5` hash | `4c09216852aec4b5254867f06f30ce73e560638ff32563d8abdc4ff5` |
| `collateral_v5` address | `addr_test1wrcz0wwchu6l4lfksd4t6sdldux5zssc2cvyp4s2pfqrrecw9e63k` |
| `collateral_v5` hash | `f027b9d8bf35fafd36836abd41bf6f0d414218561840d60a0a4031e7` |
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
2. **Loan principals.** For on-chain interest accounting, loan principals are recorded
   in `open_loans` — visible, but **unlinkable to identity**. Per-loan amount privacy
   requires moving interest verification into the circuit (future work).
3. **Value at the edges & timing.** ADA entering (deposit) and leaving (loan payout,
   repay) is visible; fixed denominations blur amounts inside the set but timing
   correlation can still relate activity. Timing resistance is out of scope for M3.
4. **Fee-payer.** The wallet that pays fees is visible; sender-level anonymity needs a
   relayer (as Tornado Cash uses).
5. **Anonymity set is admin-curated.** For M3 the commitment-set root is published by
   the protocol admin (`SetGroupRoot`), mirroring the reference Cardano-Semaphore
   group model.
6. **Nullifier set.** Stored as a list for M3; a Merkle-Patricia-Forestry set is the
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
