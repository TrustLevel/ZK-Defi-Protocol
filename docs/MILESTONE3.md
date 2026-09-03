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
or admin signature on any of the value-moving paths**. Two Plutus V3 validators
implement it (`contracts/validators/v5/`):

| Validator | Script hash (Preprod) | Role |
|---|---|---|
| `lending_pool_v5` | `76c8efd63189120023acdccb59a226ab2bc8d27ce55c3561d495fa5b` | Pool liquidity; authorizes `BorrowAnonymous` / `RepayAnonymous` on-chain; keeps the outstanding-loan set, the commitment-set root, and the append-only repaid-set root |
| `collateral_v5` (parameterised by the pool hash) | `7f955bbc57a95d355eb3c8107327fd52ebef2c4ac0ed4a1a5f83976b` | Holds collateral (fixed denomination) with a commitment; authorizes `UnlockDeposit` on-chain via a settlement proof |

The four verification keys (borrow / repay / settlement / append) are parked once as
inline datums on an **unspendable (always-false) UTxO** and consumed only as
**read-only reference inputs**.

### Privacy model

1. **Amount confidentiality.** The collateral amount is **not in the datum** — it is a
   private circuit witness — and collateral is held in a **fixed denomination**, so the
   UTxO value reveals only "one unit", not the position size (the locked lovelace itself
   is public L1 state; privacy comes from the uniform denomination, not from hiding the
   number). **Loans are also a fixed denomination**, so every loan payout is identical
   and loan amounts carry no per-loan information (the outstanding-loan set stores only
   nullifiers).
2. **Deposit ↔ borrow unlinkability.** A borrow proves the collateral commitment is a
   **member of the on-chain commitment set** (a Merkle root) — it does **not**
   reference a specific deposit UTxO. Nobody can tell which deposit backs a loan.
3. **Settlement-gated, unlinkable unlock.** Repaying a loan removes its
   `loan_nullifier` `N` from `open_loans` (the double-borrow gate) **and**, in the same
   transaction, inserts a distinct **repayment nullifier**
   `R = Poseidon255(secret, repay_external_nullifier)` into an **append-only
   `repaid_root`** — the borrower does this themselves with a zero-knowledge append
   proof, no admin. The repay proof proves `N` **and** `R` **from the same secret**, and
   the validator feeds that one `R` to both the repay proof and the append proof, so the
   `R` that lands in `repaid_root` is exactly the one bound to the settled loan — a repay
   can only ever settle its own deposit. Unlock then proves, in zero knowledge,
   **membership of the private `R` in `repaid_root`**. Its public signals are
   `[commitment, repaid_root, repay_external_nullifier]` — none of which is shared with
   the borrow — so a deposit can only be unlocked after it is genuinely repaid, **and
   borrow ↔ unlock cannot be linked**.

### The full private lending cycle (confirmed live on Preprod)

| # | Step | Preprod tx |
|---|------|-----------|
| 1 | **Park VKeys** — borrow, repay, settlement and append verification keys on an always-false UTxO | [`7940faba06e3…`](https://preprod.cardanoscan.io/transaction/7940faba06e3dcd236a816c9b11a24916fe14a2f4e8ec8a7690ec383c30118df) |
| 2 | **Init pool** — `PoolDatumV5` (liquidity, ratio, four vkey refs, loan denomination, empty commitment set, empty repaid set, `next_index = 0`, empty loan set, admin) | [`9d1040c824fe…`](https://preprod.cardanoscan.io/transaction/9d1040c824fec51f99ae2a64a424c26262e78fc98672ee82641293f5e7545d53) |
| 3 | **Deposit** — lock collateral with `DepositDatumV5 { commitment, timestamp }`; `commitment = Poseidon255(collateral_amount, secret)`; the secret + amount never leave the depositor | [`5c01c374f234…`](https://preprod.cardanoscan.io/transaction/5c01c374f234690ac489e22538b09d0799996b7b026c98522d60b05f751e516c) |
| 3b | **Publish set root** — admin `SetGroupRoot` updates the Merkle root of the commitment set (the deposit anonymity set is admin-curated for M3) | [`454862e9d7c8…`](https://preprod.cardanoscan.io/transaction/454862e9d7c8251b327d46218760edfdc9191c29969fb899bae205bc229dc2e4) |
| 4 | **Borrow** — `BorrowAnonymous { proof, loan_amount, loan_nullifier }`; the validator runs `groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext])` **on-chain**; **no collateral UTxO is referenced**; loan paid out; nullifier recorded | [`2167979b07ce…`](https://preprod.cardanoscan.io/transaction/2167979b07ce2d56db946b25353aa8a788d0ab66e50051d2a31c6edc9cd3f530) |
| 5 | **Repay** — `RepayAnonymous { proof, repay_amount, loan_nullifier, repay_nullifier, append_proof }`; the repay proof proves the loan nullifier `N` **and** the repayment nullifier `R` **from the same secret** (binding `R` to this loan); pays **principal + interest**; removes `N` (settles the loan); **self-appends that same `R` into `repaid_root`** via an on-chain append proof — permissionless | [`53ef694c983d…`](https://preprod.cardanoscan.io/transaction/53ef694c983dcf6cc7911dbae6280d46330c5afb3994eade529f8badf90ed8b1) |
| 6 | **Unlock** — `UnlockDeposit { proof, pool_ref }`; a settlement proof binds the spent commitment and proves membership of the private `R` in `repaid_root` (read from the pool reference input); collateral freed **with no signature and no borrow-shared value** | [`71eb3a5fed1d…`](https://preprod.cardanoscan.io/transaction/71eb3a5fed1da2a20e7754e79394d98e063477c9a3ed1c79d590018f76adb5dc) |

All seven transactions confirmed `valid_contract: true`. Economics: pool 100 → 90 →
100.5 ADA (principal + 5% interest), collateral released.

Off-chain drivers (Mesh, Node ESM): `offchain/cli/v5/{1-park-vkey, 2-init-pool,
3-deposit, 3b-setgrouproot, 4-borrow, 5-repay, 6-unlock}.mjs`, shared helpers in
`offchain/cli/v5/common.mjs`. The Mesh tx builder uses `autoEvaluate` for ExUnits.

---

## 2. zk-proof generation mechanism

Four BLS12-381 Groth16 circuits (`circuits/`), all hashing with **Poseidon255**
(`poseidon-bls12381`) so the in-circuit and on-chain commitment are identical.

### Borrow — `collateral_semaphore.circom`

Proves, in zero knowledge, that a **member** of the commitment set is sufficiently
collateralized, without revealing which one or by how much.

- **Public signals:** `[group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:** (1) `leaf = Poseidon255(collateral_amount, secret)`; (2) Merkle
  membership `leaf ∈ group_merkle_root` (depth 10, Poseidon255 nodes); (3)
  `loan_nullifier = Poseidon255(secret, external_nullifier)`; (4) sufficiency
  `collateral_amount·100 ≥ loan_amount·collateral_ratio`; (5) range checks.

### Repay — `repay_proof.circom`

Authorizes a repayment and **binds the repayment nullifier `R` to the loan being
repaid** by proving both nullifiers from one secret. Without this binding a repay of
loan A could insert an `R` for a different deposit D, letting D later unlock while its
loan stays unpaid; here `N` and `R` share one secret, so a repay can only settle its
own deposit.

- **Public signals:** `[group_merkle_root, loan_nullifier, repay_nullifier, loan_amount, collateral_ratio, external_nullifier, repay_external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:** (1) `leaf = Poseidon255(collateral_amount, secret)`; (2) Merkle
  membership `leaf ∈ group_merkle_root`; (3) `loan_nullifier = Poseidon255(secret,
  external_nullifier)`; (4) `repay_nullifier = Poseidon255(secret,
  repay_external_nullifier)` — **the same secret as (3)**; (5) sufficiency; (6) range
  checks. The validator feeds the redeemer's single `repay_nullifier` to **both** this
  proof (as `R`) and the append proof (as the inserted leaf), so the `R` written to
  `repaid_root` is exactly the one this proof binds to `N`'s secret.

### Unlock — `settlement_proof.circom`

Binds to the **specific** deposit being spent (so nobody can unlock another user's
collateral) and proves the loan is settled — **without revealing any value that was
public at borrow**.

- **Public signals:** `[commitment, repaid_root, repay_external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:** (1) `commitment = Poseidon255(collateral_amount, secret)`;
  (2) `R = Poseidon255(secret, repay_external_nullifier)` — a **private** witness,
  never revealed; (3) Merkle membership `R ∈ repaid_root` (depth 10); (4) range checks.

### Repay append — `append_proof.circom`

Lets a repayer grow the append-only repaid set **themselves** (permissionless), proving
`R` was inserted at the next free position without disturbing the rest of the tree.

- **Public signals:** `[old_root, new_root, leaf, index]`
- **Private witness:** `siblings` (the frontier for position `index`)
- **Constraints:** the same path with leaf `0` yields `old_root` (the slot was empty),
  and with leaf `R` yields `new_root` (depth 10). The validator binds `old_root =
  repaid_root`, `new_root = out.repaid_root`, `leaf = R`, `index = next_index`, and
  `next_index += 1`, so the tree fills left-to-right with no overwrite.

**Trusted setup.** Each circuit has a BLS12-381 powers-of-tau → `groth16 setup` →
phase-2 contribution → `*_final.zkey` + `verification_key_*.json`. Proofs are generated
off-chain with snarkjs and the G1/G2 points are compressed into the on-chain `Proof`
type. *The M3 setup is a single-contributor developer ceremony — adequate to
demonstrate the mechanism on Preprod; a multi-party ceremony is required before
mainnet (see M1 Appendix A).*

---

## 3. On-chain verification design

- **Generic Groth16 verifier (reused, not rebuilt):** `modulo-p/ak-381` v0.1.1
  provides `groth_verify(vk, proof, public)` for BLS12-381. `contracts/lib/zk.ak`
  wraps it as `verify_borrow_proof` (5 signals), `verify_repay_proof` (7 signals),
  `verify_settlement_proof` (3 signals) and `verify_append_proof` (4 signals).
- **VKeys as reference inputs.** All four verification keys live at an always-false
  address, pinned by `PoolDatumV5.{vkey_ref, repay_vkey_ref, settlement_vkey_ref,
  append_vkey_ref}`, read via `get_vkey`.
- **Public signals bound to trusted state.** `group_root`, `repaid_root`,
  `collateral_ratio`, `external_nullifier`, `repay_external_nullifier`, `next_index`
  come from the pool datum; redeemer-supplied values (`loan_nullifier`, `loan_amount`,
  `repay_nullifier`) are cross-checked against the `open_loans` set, the pool value
  delta, and the append proof — a spender cannot feed the verifier convenient inputs.
  On repay the single `repay_nullifier` is bound by the repay proof (to `N`'s secret)
  **and** is the leaf the append proof inserts, so it cannot be aimed at another deposit.
- **No signatures on the value-moving paths.** The proof *is* the authorization for
  borrow, repay and unlock. (The admin signs only `SetGroupRoot`, which moves no value.)
- **Adversarial test suite.** `aiken check` runs 22 checks (0 warnings), including
  validator tests with real proofs: borrow-membership, reused-nullifier-fails,
  repay-with-interest, repay-below-interest-fails, **repay-bogus-append-fails**,
  **repay-append-leaf-mismatch-fails** and **repay-cannot-settle-other-deposit-fails**
  (the `R`-binding: a repay's `R` must be the one bound to `N`'s secret),
  unlock-when-settled, **unlock-without-repay-fails** (fail-closed), unlock-wrong-
  commitment, a structural check that `UnlockDeposit` carries no `loan_nullifier`, and
  on-chain proof/tamper checks for all four circuits.

---

## 4. Deployed addresses / hashes (Preprod)

| Component | Value |
|---|---|
| `lending_pool_v5` address | `addr_test1wpmv3m7kxxy3yqpr4nwvkkdzy64jhjxj0nj4cdtp6j2l5kcxu8a6c` |
| `lending_pool_v5` hash | `76c8efd63189120023acdccb59a226ab2bc8d27ce55c3561d495fa5b` |
| `collateral_v5` address | `addr_test1wple2kau27546d27k0ypque8l4fwhmevftqw6js6t7pew6cu33g44` |
| `collateral_v5` hash | `7f955bbc57a95d355eb3c8107327fd52ebef2c4ac0ed4a1a5f83976b` |
| Compiler | Aiken v1.1.15, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow (5 signals), repay (7 signals), settlement (3 signals), append (4 signals); all depth-10 |

**ExUnit headroom (Plutus V3 limits: 17,500,000 mem / 10,000,000,000 cpu).** A single
on-chain `groth_verify` costs on the order of ~2.3–2.8 B cpu. The repay transaction
runs **two** proofs (the repay proof + the append proof) and measured **541,369 mem /
5,355,980,007 cpu** live — comfortably within limits (≈3 % mem, ≈54 % cpu). Published
fees are an upper bound; independent testers reproduced borrow/repay at lower cost.

---

## 5. Security & privacy model

The zk-SNARK proof is the **sole authorization** for every borrow, repayment and
unlock — no admin key, no owner signature (the admin signs only `SetGroupRoot`, which
moves no value). Three on-chain properties make that trustworthy:

- **Bound to chain state.** Public signals are reconstructed from trusted pool-datum
  state and cross-checked against the loan set, the pool balance delta, and (on repay)
  the append proof.
- **Immutable verification keys**, pinned to unspendable reference UTxOs.
- **Settlement-gated unlock.** Collateral can only be freed once a valid settlement
  proof shows the repayment nullifier is a member of `repaid_root`; the only way `R`
  enters `repaid_root` is a valid repayment (an empty / `R`-absent root makes the
  membership proof unsatisfiable — this is the fail-closed test `unlock_without_repay_fails`).

### Trust assumptions

The system has exactly one privileged bootstrap action and one privileged maintenance
action — both are censorship-only, never theft:

- **VKey selection at pool init.** Whoever sets the four `*_vkey_ref` fields at
  init defines what a valid proof is. This is the single trust anchor; the keys sit at
  an unspendable address and are read-only thereafter.
- **Admin-curated deposit set (`group_root`).** The commitment-set root is published by
  the admin (`SetGroupRoot`), mirroring the reference Cardano-Semaphore group model. The
  admin can include or withhold a commitment (a liveness/censorship power over
  onboarding) but **cannot move funds, forge a proof, or unlock anyone's collateral.**
  The repaid set is **not** admin-curated — it grows permissionlessly on repay.
- **Trusted setup.** The M3 proving/verification keys come from a single-contributor
  developer ceremony (multi-party required before mainnet).
- **Hashing.** In-circuit and on-chain both use Poseidon255 (`poseidon-bls12381`), so
  commitments and nullifiers agree byte-for-byte.

### Non-goals (explicitly out of scope for M3)

M3 demonstrates *on-chain ZK verification for private lending*, not a complete money
market. The following are deliberately not delivered here:

- **No liquidation / repayment incentive.** Repay enforces a `principal + interest`
  floor (`repay_amount ≥ due`), but nothing on-chain compels a borrower to ever repay;
  the `interest_rate` datum field drives that floor and is otherwise informational.
- **Collateral coverage is denomination-based.** Amounts are handled by a uniform
  fixed denomination rather than a per-deposit value proof — every collateral UTxO is
  identical, so there is no per-position amount to reveal or to bind. A value-binding
  deposit proof (for variable denominations) is a future refinement.
- **Accounting asymmetry.** Borrow checks the pool delta exactly (`== balance − loan`);
  repay checks a floor (`repay_amount ≥ due`, value `== balance + repay_amount`). This
  is intentional (over-repayment is permitted, under-repayment rejected) and not
  exploitable within M3.

### Privacy boundary (honest limits)

On a transparent UTXO ledger, ZK hides information *within a set*; it does not make a
public ledger opaque. The delivered model (set-membership + linkage privacy, plus
denomination-bucketed amount hiding) has these known limits:

1. **Anonymity-set size.** Privacy scales with the number of deposits sharing a
   denomination; on a young protocol the practical set is small even though the
   mechanism is sound. It improves with adoption, not with code.
2. **Timing.** ADA entering (deposit) and leaving (loan payout, repay) is visible;
   fixed denominations blur amounts inside the set but timing correlation can still
   relate activity. Timing resistance is out of scope for M3.
3. **Fee-payer.** The wallet that pays fees is visible; sender-level anonymity needs a
   relayer (as Tornado Cash uses).
4. **Deposit set is admin-curated** (`group_root`; see Trust assumptions).
5. **Nullifier / repaid sets.** Stored as a list / depth-10 Merkle tree for M3; a
   Merkle-Patricia-Forestry set is the scale upgrade.

Unlock proves settlement in zero knowledge and shares no public value with the borrow,
so borrow and unlock cannot be linked.

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
