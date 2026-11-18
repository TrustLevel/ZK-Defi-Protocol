# Milestone 3 — Private Lending with On-Chain zk-SNARK Verification

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** zk-SNARK proofs *verifiable on-chain* for **private** verification
of collateral and loan transactions.
**Status:** Delivered and demonstrated live on Cardano **Preprod**.

---

## 1. Protocol overview

The ZK-DeFi-Protocol lets a user deposit collateral, borrow against it, repay with
interest, and reclaim the collateral. Every deposit, borrow, repayment and unlock is
authorized by a real **Groth16 zk-SNARK proof verified on-chain**. **There is no admin
and no signature on any path**: the proof is the authorization. Three Plutus V3
scripts implement it (`contracts/validators/v5/`):

| Script | Role |
|---|---|
| `pool_nft` (minting policy, parameterised by a seed UTxO) | Mints exactly one `POOL` token, once, in the transaction that spends the seed. The pool UTxO carries it, so the validators can tell the real pool from any UTxO someone pays to the pool address. |
| `lending_pool_v5` (parameterised by the NFT policy, the collateral script hash and the borrow / append vkey refs) | Pool liquidity and state. Authorizes `DepositCollateral`, `BorrowAnonymous`, `RepayAnonymous` and `AddLiquidity`. Keeps the commitment set (`group_root`), the open and used loan nullifiers, and the append-only repaid set (`repaid_root`). |
| `collateral_v5` (parameterised by the NFT policy and the settlement vkey ref) | Holds collateral (fixed denomination) under a commitment. Authorizes `UnlockDeposit` via a settlement proof against the NFT-bearing pool. |

The three verification keys (borrow, settlement, append) are parked once as inline
datums on an **unspendable (always-false) address**. The validators read them as
**reference inputs at fixed references given as script parameters**, never from a datum.

### Privacy model

1. **Amount confidentiality.** The collateral amount is **not in the datum**. It is a
   private circuit witness, and collateral is held in a **fixed denomination**, so the
   UTxO value reveals only "one unit", not the position size. The locked lovelace is
   public L1 state, so privacy comes from the uniform denomination, not from hiding
   the number. **Loans and repayments are fixed amounts too.** Every loan payout and
   every repayment is identical, so amounts carry no per-position information.
2. **Deposit ↔ borrow unlinkability.** A borrow proves the collateral commitment is a
   **member of the on-chain commitment set** (a Merkle root). It does **not** reference
   a specific deposit UTxO, so nobody can tell which deposit backs a loan.
3. **Settlement-gated, unlinkable unlock.** Repaying a loan settles its
   `loan_nullifier`. In the same transaction the borrower inserts a distinct
   **repayment nullifier** `R = Poseidon255(secret, repay_external_nullifier)` into the
   append-only `repaid_root`, with a zero-knowledge append proof. Unlock then proves,
   in zero knowledge, **membership of the private `R` in `repaid_root`**. Its public
   signals are `[commitment, repaid_root, repay_external_nullifier]`, and none of them
   is shared with the borrow. So a deposit can only be unlocked after it was repaid,
   **and borrow ↔ unlock cannot be linked**.

### The full private lending cycle (confirmed live on Preprod)

| # | Step | Preprod tx |
|---|------|-----------|
| 1 | **Park VKeys.** Borrow, settlement and append verification keys go on an always-false address. | [`3e018c9063f1…`](https://preprod.cardanoscan.io/transaction/3e018c9063f1c37954079b79285be7bd534efb12dc98f77ad025dffc28790316) |
| 2 | **Init pool + mint the pool NFT.** The tx spends the seed UTxO, mints the single `POOL` token, and locks it with the liquidity and the initial `PoolDatumV5` (empty commitment set, empty repaid set, no open or used nullifiers). | [`5702c1512ad0…`](https://preprod.cardanoscan.io/transaction/5702c1512ad0cf4b19009da3995d21675df6b9920ed047af9631382713ac0d30) |
| 3 | **Deposit collateral (through the pool).** `DepositCollateral { commitment, append_proof }` locks exactly 20 ADA at the collateral script with `DepositDatumV5 { commitment, timestamp, unlock_to }`, where `commitment = Poseidon255(collateral_amount, secret)`. The append proof, verified **on-chain**, inserts the commitment into `group_root`. Permissionless, and the secret never leaves the depositor. | [`7fa28e7d56fd…`](https://preprod.cardanoscan.io/transaction/7fa28e7d56fd7e6060f97d6b9504a7da7dc35bebb5a275e902f5b3b794e6f556) |
| 4 | **Borrow.** `BorrowAnonymous { proof, loan_amount, loan_nullifier, recipient }`. The validator runs `groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext, recipient])` **on-chain**, and **no collateral UTxO is referenced**. The 10 ADA loan is paid to the recipient key the proof is bound to, and the nullifier is recorded as open and as used. | [`d16503550d1c…`](https://preprod.cardanoscan.io/transaction/d16503550d1c822f5a6adaa832c69db4c4f0abfdb0eab1676e4635e89eb2a501) |
| 5 | **Repay.** `RepayAnonymous { proof, recipient, repay_amount, loan_nullifier, repay_nullifier, append_proof }` re-attests membership and the nullifier, and pays **exactly principal + interest** (10.5 ADA). It settles the loan and **self-appends `R` into `repaid_root`** via an on-chain append proof. Permissionless. | [`8fafa79d6bc4…`](https://preprod.cardanoscan.io/transaction/8fafa79d6bc47e6ce215704a5690bae18efcf89c59d3abc1bf8b4110021ea983) |
| 6 | **Unlock.** `UnlockDeposit { proof, pool_ref }`: a settlement proof binds the spent commitment and proves membership of the private `R` in the `repaid_root` of the NFT-bearing pool. The 20 ADA collateral goes to the deposit's `unlock_to` address, **with no signature and no borrow-shared value**. | [`046baceaccbe…`](https://preprod.cardanoscan.io/transaction/046baceaccbe8a7ac9e426655a5cfe5b997fd0ddc430cc6c5033f99e5f021b4a) |

All six transactions confirmed `valid_contract: true`. Economics: pool 100 → 90 →
100.5 ADA (principal + 5 % interest), collateral released.

Off-chain drivers (Mesh, Node ESM): `offchain/cli/v5/{1-park-vkey, 2-init-pool,
3-deposit, 4-borrow, 5-repay, 6-unlock}.mjs`, with shared helpers in
`offchain/cli/v5/common.mjs`. Each step finds the pool by its NFT. The Mesh tx
builder evaluates every transaction (ExUnits) before it is submitted.

---

## 2. zk-proof generation mechanism

Three BLS12-381 Groth16 circuits (`circuits/`) all hash with **Poseidon255**
(`poseidon-bls12381`), so the in-circuit and on-chain commitment are identical.

The protocol uses Groth16 because:

- **It is the most mature option on Cardano.** Plutus V3's BLS12-381 builtins and the
  open-source `modulo-p/ak-381` verifier verify Groth16 proofs on-chain today.
- **It has the best cost profile.** It has very small proofs and very cheap
  verification (M1 §1.2). Every step fits in one transaction, including repay, which
  verifies two proofs (§4).

### Borrow / repay — `collateral_semaphore.circom`

Proves, in zero knowledge, that a **member** of the commitment set is sufficiently
collateralized, without revealing which one or by how much, and binds the proof to
the payout recipient.

- **Public signals:** `[group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier, recipient]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:**
  1. `leaf = Poseidon255(collateral_amount, secret)`
  2. Merkle membership `leaf ∈ group_merkle_root` (depth 10, Poseidon255 nodes)
  3. `loan_nullifier = Poseidon255(secret, external_nullifier)`
  4. sufficiency `collateral_amount·100 ≥ loan_amount·collateral_ratio`
  5. range checks
  6. `recipient` (the payout key hash as an integer) is constrained (`recipient²`), so a proof cannot be re-targeted at another key

### Unlock — `settlement_proof.circom`

Binds to the **specific** deposit being spent and proves the loan is settled,
**without revealing any value that was public at borrow**.

- **Public signals:** `[commitment, repaid_root, repay_external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:**
  1. `commitment = Poseidon255(collateral_amount, secret)`
  2. `R = Poseidon255(secret, repay_external_nullifier)`, a **private** witness that is never revealed
  3. Merkle membership `R ∈ repaid_root` (depth 10)
  4. range checks

### Append — `append_proof.circom` (deposit and repay)

Lets a user grow an append-only set **themselves** (permissionless). It proves a leaf
was inserted at the next free position without disturbing the rest of the tree. The
same circuit and verification key serve both sets:

| Used by | Leaf | Set |
|---|---|---|
| `DepositCollateral` | the collateral commitment | `group_root` |
| `RepayAnonymous` | `R` | `repaid_root` |

- **Public signals:** `[old_root, new_root, leaf, index]`
- **Private witness:** `siblings` (the frontier for position `index`)
- **Constraints:** the same path yields `old_root` with leaf `0` (the slot was empty)
  and `new_root` with the inserted leaf (depth 10). The validator binds `old_root` to
  the current root, `new_root` to the continuing datum, `leaf` to the redeemer and
  `index` to the set's next index, then increments it. The tree fills left to right
  and nothing is overwritten.

**Trusted setup.** Each circuit goes through a BLS12-381 powers-of-tau, then
`groth16 setup`, then a phase-2 contribution, producing `*_final.zkey` and
`verification_key_*.json`. Proofs are generated off-chain with snarkjs, and the
G1/G2 points are compressed into the on-chain `Proof` type. *The M3 setup is a
single-contributor developer ceremony. That is adequate to demonstrate the mechanism
on Preprod; a multi-party ceremony is required before mainnet (see M1 Appendix A).*

---

## 3. On-chain verification design

- **Generic Groth16 verifier (reused, not rebuilt).** `modulo-p/ak-381` v0.1.1
  provides `groth_verify(vk, proof, public)` for BLS12-381. `contracts/lib/zk.ak`
  wraps it as `verify_borrow_proof` (6 signals), `verify_settlement_proof` (3 signals)
  and `verify_append_proof` (4 signals).
- **Pool identity by NFT.** The pool validator spends only the input that holds the
  one-shot pool NFT, and finds the continuing output by the NFT at the same address.
  The collateral validator trusts a pool reference input only if it carries the NFT.
  A UTxO that someone merely paid to the pool address can neither be spent as the pool
  nor serve as the unlock's source of `repaid_root`.
- **VKeys as parameters.** The borrow, settlement and append vkey references are script
  parameters, read via `get_vkey` from the reference inputs. No datum can point the
  validators at a different key.
- **Public signals bound to trusted state.** `group_root`, `repaid_root`, the two next
  indices, `collateral_ratio`, `external_nullifier` and `repay_external_nullifier` come
  from the pool datum. Redeemer-supplied values are cross-checked:
  - `loan_nullifier` against the open and used sets
  - `loan_amount` and `repay_amount` against the fixed denominations and the pool value delta
  - `commitment` and `repay_nullifier` against the append proof
  - `recipient` against the payout output

  A spender cannot feed the verifier convenient inputs.
- **One loan per deposit.** A borrow records its nullifier in `open_loans` (what Repay
  settles) and in the never-shrinking `used_nullifiers`. A nullifier that was ever used
  cannot borrow again, so a repaid deposit's `R` can never cover a later loan.
- **Fixed amounts, checked on-chain.**
  - `DepositCollateral` requires an output of exactly `collateral_denomination` with the commitment at the collateral script.
  - Borrow requires `loan_amount == loan_denomination` and that the collateral denomination covers it at the ratio.
  - Repay requires exactly `principal + interest`.
- **Payouts bound to their owner.**
  - The loan must be paid to the `recipient` key the proof is bound to, in an output tagged with the loan nullifier.
  - The collateral must be paid to the deposit's `unlock_to` address, in an output tagged with the spent deposit's reference.

  A proof copied from the mempool cannot redirect funds, and one output cannot settle two spends.
- **No signatures, no admin.** The proof *is* the authorization for deposit, borrow,
  repay and unlock. The commitment set grows only through `DepositCollateral`, the
  repaid set only through `RepayAnonymous`.

---

## 4. Deployed addresses / hashes (Preprod)

| Component | Value |
|---|---|
| Pool NFT policy | `586a933cb6c1ece99d373e106ff38b4c430d0e606541c8635c0cf049` (token name `POOL`) |
| NFT seed UTxO | `2167979b07ce2d56db946b25353aa8a788d0ab66e50051d2a31c6edc9cd3f530#2` |
| `lending_pool_v5` address | `addr_test1wrveaegrnva5cdujxkzgysztllpyuuv5eusu0scq9rsphfcqadca3` |
| `lending_pool_v5` hash | `d99ee5039b3b4c3792358482404bffc24e7194cf21c7c30028e01ba7` |
| `collateral_v5` address | `addr_test1wq8mxjpxxlgzg4n0wr7y8mgf5ctc54zl52q72hnjpqkyfls9xp6l2` |
| `collateral_v5` hash | `0fb3482637d024566f70fc43ed09a6178a545fa281e55e72082c44fe` |
| VKey reference UTxOs | `3e018c9063f1c37954079b79285be7bd534efb12dc98f77ad025dffc28790316` #0 borrow · #1 settlement · #2 append |
| Compiler | Aiken v1.1.19, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow (6 signals), settlement (3 signals), append (4 signals); all depth 10 |

The applied script hashes are derived from `contracts/plutus.json` with Mesh
`applyParamsToScript` along the parameter chain (`offchain/cli/v5/common.mjs`,
`deriveScripts`). `aiken blueprint apply` re-optimises the applied program and
therefore yields different (equivalent) bytes and hashes.

**Execution cost, measured live** (Preprod limits per tx: 17,500,000 mem / 10,000,000,000 cpu):

| Tx | Proofs verified | mem | cpu | Fee |
|---|---|---|---|---|
| Init + mint | none | 26,721 | 10,851,425 | 0.20 ADA |
| Deposit | append | 485,924 | 2,550,218,387 (26 %) | 0.61 ADA |
| Borrow | borrow | 483,872 | 2,816,388,568 (28 %) | 0.63 ADA |
| Repay | borrow + append | 549,703 | 5,218,597,012 (52 %) | 0.82 ADA |
| Unlock | settlement | 262,819 | 2,345,905,591 (23 %) | 0.45 ADA |

---

## 5. Security & privacy model

The zk-SNARK proof is the **sole authorization** for every deposit, borrow, repayment
and unlock. There is no admin key and no owner signature. Four on-chain properties
make that trustworthy:

- **Authentic state.** The pool is the one UTxO holding the one-shot NFT, and the
  verification keys are fixed by script parameters. Public signals are reconstructed
  from that state and cross-checked against the nullifier sets, the fixed amounts, the
  pool value delta and the append proofs.
- **Settlement-gated unlock.** Collateral can only be freed once a valid settlement
  proof shows the repayment nullifier is a member of `repaid_root`. The only way `R`
  enters `repaid_root` is a valid repayment. An `R`-absent root makes the membership
  proof unsatisfiable, which is the fail-closed test `unlock_without_repay_fails`.
- **One loan per deposit.** Each deposit's nullifier can borrow exactly once, so a
  settlement can never be reused for a later loan.
- **Owner-bound payouts.** Loans and collateral are paid only to the recipient the
  proof or the deposit fixed, so proofs cannot be front-run.

**Adversarial test suite.** `aiken check` runs **49 tests (0 warnings)**, including
validator tests with real BLS12-381 proofs:

| Area | Tests |
|---|---|
| Circuits on-chain | Proof verifies, and a tampered signal fails, for each circuit (borrow, settlement, append, deposit append, recipient) |
| Pool NFT | Mint only with the seed, exactly one `POOL`, never burned |
| Pool identity | A pool UTxO without the NFT is not spendable; the NFT cannot leave the pool or its address; vkeys at other references are ignored |
| Deposit | Exact denomination, correct script, matching commitment, valid append, index advance; no other spend can rewrite `group_root` |
| Borrow | Membership succeeds; reused / used nullifier fails; second loan on a repaid deposit fails; insufficient denomination fails; payout to another key, a short payout, or a swapped recipient fails |
| Repay | Exactly principal + interest; under- and over-payment fail; bogus append fails; used nullifiers cannot be cleared |
| Unlock | Settled unlock succeeds; unlock without repayment fails; wrong commitment fails; forged pool reference fails; vkey at another reference fails; payout to another address, a short payout, or a payout tagged for another deposit fails |

### Trust assumptions

- **Pool initialization.** Whoever initializes the pool chooses its configuration:
  the verification keys (script parameters), interest rate, ratio, denominations and
  initial liquidity. All of it is public in the init transaction and the script
  parameters, and it is immutable afterwards.
- **Trusted setup.** The M3 proving and verification keys come from a
  single-contributor developer ceremony (multi-party required before mainnet).
- **Hashing.** In-circuit and on-chain both use Poseidon255 (`poseidon-bls12381`), so
  commitments and nullifiers agree byte for byte.

### Non-goals (explicitly out of scope for M3)

M3 demonstrates *on-chain ZK verification for private lending*, not a complete money
market. The following are deliberately not delivered here:

- **No liquidation or repayment incentive.** Repay requires exactly `principal +
  interest` (flat interest per loan), but nothing on-chain compels a borrower to repay.
- **Denomination-based collateral.** Amounts are handled by one uniform denomination
  per pool rather than per-deposit value proofs. Variable denominations are a future
  refinement.
- **Capacity.** The commitment and repaid sets are depth-10 Merkle trees (1,024
  entries each). The nullifier sets are lists in the pool datum, which grow with every
  loan and keep the pool to a few hundred loans over its lifetime. A
  Merkle-Patricia-Forestry set is the scale upgrade. Every pool action spends the
  single pool UTxO, so a pool processes one action per block.
- **No withdrawal without a loan.** A deposit is released through the settlement
  path, so a depositor who never borrowed reclaims the collateral by borrowing and
  repaying.

### Privacy boundary

On a transparent UTXO ledger, ZK hides information *within a set*; it does not make a
public ledger opaque. The delivered model (set-membership and linkage privacy, plus
denomination-bucketed amount hiding) has these known limits:

1. **Anonymity-set size.** Privacy scales with the number of deposits sharing a
   denomination. On a young protocol the practical set is small even though the
   mechanism is sound. It improves with adoption, not with code.
2. **Timing.** ADA entering (deposit) and leaving (loan payout, repay) is visible.
   Fixed amounts blur positions inside the set, but timing correlation can still
   relate activity. Timing resistance is out of scope for M3.
3. **Fee payer and addresses.** The wallet that pays fees is visible, and so are the
   payout addresses. The CLI pays loans to `RECIPIENT_ADDRESS` and collateral to
   `UNLOCK_TO_ADDRESS` when set. Fresh addresses per step and a relayer for fees (as
   Tornado Cash uses) are needed for sender-level anonymity.

Unlock proves settlement in zero knowledge and shares no public value with the borrow,
so borrow and unlock cannot be linked.

Cardano L1 was chosen deliberately (M1 §1.2) rather than the Midnight privacy
sidechain. The L1 privacy ceiling is genuinely lower than a purpose-built privacy
chain; M3 targets that realistic ceiling and documents the boundary honestly.

The approved M1 (architecture) and M2 (smart contracts) Proofs of Achievement are
re-published in-repo at [`docs/poa/M1-POA.pdf`](poa/M1-POA.pdf) and
[`docs/poa/M2-POA.pdf`](poa/M2-POA.pdf).

---

## 6. Next steps (Milestone 4)

Milestone 4 adds a simple web UI over the protocol demonstrated here: CIP-30 wallet
integration, in-browser proof generation, and a guided deposit → borrow → repay →
unlock flow, followed by user testing.
