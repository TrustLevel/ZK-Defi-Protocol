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
| `lending_pool_v5` (parameterised by the NFT policy, the collateral script hash and the borrow / repay / append vkey refs) | Pool liquidity and state. Authorizes `DepositCollateral`, `BorrowAnonymous`, `RepayAnonymous` and `AddLiquidity`. Keeps the commitment set (`group_root`), the open and used loan nullifiers, and the append-only repaid set (`repaid_root`). |
| `collateral_v5` (parameterised by the NFT policy and the settlement vkey ref) | Holds collateral (fixed denomination) under a commitment. Authorizes `UnlockDeposit` via a settlement proof against the NFT-bearing pool. |

The four verification keys (borrow, repay, settlement, append) are parked once as inline
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
   `loan_nullifier`. In the same transaction the repayer inserts a distinct
   **repayment nullifier** `R = Poseidon255(secret, repay_external_nullifier)` into the
   append-only `repaid_root`, with a zero-knowledge append proof. The repay proof
   binds this `R` to the loan being repaid (same secret). Unlock then proves,
   in zero knowledge, **membership of the private `R` in `repaid_root`**. Its public
   signals are `[commitment, repaid_root, repay_external_nullifier]`, and none of them
   is shared with the borrow. So a deposit can only be unlocked after it was repaid,
   **and borrow ↔ unlock cannot be linked**.

### The full private lending cycle (confirmed live on Preprod)

| # | Step | Preprod tx |
|---|------|-----------|
| 1 | **Park VKeys.** Borrow, repay, settlement and append verification keys go on an always-false address. | [`edbfae0e6704…`](https://preprod.cardanoscan.io/transaction/edbfae0e6704086b0f9feddf30c83544c10406faf729792ba57bbdc4b2be1132) |
| 2 | **Init pool + mint the pool NFT.** The tx spends the seed UTxO, mints the single `POOL` token, and locks it with the liquidity and the initial `PoolDatumV5` (empty commitment set, empty repaid set, no open or used nullifiers). | [`e2ecaa36399f…`](https://preprod.cardanoscan.io/transaction/e2ecaa36399f9732f6c56b76489ae58d7b5beaa6aa69a0150ce6ef26b1b5390e) |
| 3 | **Deposit collateral (through the pool).** `DepositCollateral { commitment, append_proof }` locks exactly 20 ADA at the collateral script with `DepositDatumV5 { commitment, timestamp, unlock_to }`, where `commitment = Poseidon255(collateral_amount, secret)`. The append proof, verified **on-chain**, inserts the commitment into `group_root`. Permissionless, and the secret never leaves the depositor. | [`e63eeaab7526…`](https://preprod.cardanoscan.io/transaction/e63eeaab75266f138bf283a705ce741da3c2e805104e2fe18889668be4b7fbc1) |
| 4 | **Borrow.** `BorrowAnonymous { proof, loan_amount, loan_nullifier, recipient }`. The validator runs `groth_verify(vkey, proof, [group_root, nullifier, loan, ratio, ext, recipient])` **on-chain**, and **no collateral UTxO is referenced**. The 10 ADA loan is paid to the recipient key the proof is bound to, and the nullifier is recorded as open and as used. | [`8be8d71a2950…`](https://preprod.cardanoscan.io/transaction/8be8d71a29509f9446aff7d668181470a92e5741af9a8d966cdeee232a468bf1) |
| 5 | **Repay.** `RepayAnonymous { proof, repay_amount, loan_nullifier, repay_nullifier, append_proof }`: a repay proof attests membership, the loan nullifier **and `R` from the same secret**, verified **on-chain**. It pays **exactly principal + interest** (10.5 ADA), settles the loan and **appends that `R` into `repaid_root`** via an on-chain append proof. Permissionless. | [`fad24d65ede8…`](https://preprod.cardanoscan.io/transaction/fad24d65ede8b625ebe6a7f22684fcdb33803f50b5445c1d72ee857ca869cf60) |
| 6 | **Unlock.** `UnlockDeposit { proof, pool_ref }`: a settlement proof binds the spent commitment and proves membership of the private `R` in the `repaid_root` of the NFT-bearing pool. The 20 ADA collateral goes to the deposit's `unlock_to` address, **with no signature and no borrow-shared value**. | [`64f9e36847b7…`](https://preprod.cardanoscan.io/transaction/64f9e36847b7774a69714f944f448c0496795eaa2621c80c83e02324b48584b9) |

All six transactions confirmed `valid_contract: true`. Economics: pool 100 → 90 →
100.5 ADA (principal + 5 % interest), collateral released.

Off-chain drivers (Mesh, Node ESM): `offchain/cli/v5/{1-park-vkey, 2-init-pool,
3-deposit, 4-borrow, 5-repay, 6-unlock}.mjs`, with shared helpers in
`offchain/cli/v5/common.mjs`. Each step finds the pool by its NFT. The Mesh tx
builder evaluates every transaction (ExUnits) before it is submitted.

---

## 2. zk-proof generation mechanism

Four BLS12-381 Groth16 circuits (`circuits/`) all hash with **Poseidon255**
(`poseidon-bls12381`), so the in-circuit and on-chain commitment are identical.

The protocol uses Groth16 because:

- **It is the most mature option on Cardano.** Plutus V3's BLS12-381 builtins and the
  open-source `modulo-p/ak-381` verifier verify Groth16 proofs on-chain today.
- **It has the best cost profile.** It has very small proofs and very cheap
  verification (M1 §1.2). Every step fits in one transaction, including repay, which
  verifies two proofs (§4).

### Borrow — `collateral_semaphore.circom`

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

### Repay — `repay_proof.circom`

Proves the same membership as the borrow and, from the **same secret**, both the loan
nullifier being settled and the repayment nullifier `R` that the repay appends. A repay
can therefore only ever release its own deposit. The circuit has its own verification
key, so a (public) borrow proof is never a valid repay proof.

- **Public signals:** `[group_merkle_root, loan_nullifier, repay_nullifier, loan_amount, collateral_ratio, external_nullifier, repay_external_nullifier]`
- **Private witness:** `secret`, `collateral_amount`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:**
  1. `leaf = Poseidon255(collateral_amount, secret)` and Merkle membership `leaf ∈ group_merkle_root`
  2. `loan_nullifier = Poseidon255(secret, external_nullifier)`
  3. `repay_nullifier = Poseidon255(secret, repay_external_nullifier)`
  4. sufficiency and range checks as in the borrow circuit

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
| `RepayAnonymous` | `R` (the one the repay proof binds) | `repaid_root` |

- **Public signals:** `[old_root, new_root, leaf, index]`
- **Private witness:** `siblings` (the frontier for position `index`)
- **Constraints:** the same path yields `old_root` with leaf `0` (the slot was empty)
  and `new_root` with the inserted leaf (depth 10). The validator binds `old_root` to
  the current root, `new_root` to the continuing datum, `leaf` to the redeemer and
  `index` to the set's next index, then increments it. The tree fills left to right
  and nothing is overwritten.

### Proof generation, end to end

Every proof is generated off-chain by the user and verified on-chain by a validator.
The steps are the same for all four circuits; the functions are in
`offchain/cli/v5/common.mjs`.

1. **Secret and commitment.** At deposit the user draws a random `secret` and computes
   `commitment = Poseidon255(collateral_amount, secret)` (`computeCommitment`). Only
   the commitment goes on-chain; the secret and amount stay with the user.
2. **Derived values.** From the same secret the user derives the loan nullifier
   `Poseidon255(secret, external_nullifier)` (`computeNullifier`) and the repayment
   nullifier `R = Poseidon255(secret, repay_external_nullifier)`
   (`computeRepayNullifier`). The two scalars come from the pool datum.
3. **Merkle path.** The user rebuilds the depth-10 Poseidon255 tree from the set's
   leaves in insertion order (commitments for `group_root`, repayment nullifiers for
   `repaid_root`) and takes the path of their leaf (`merkleProof`). The rebuilt root
   must equal the root in the current pool datum.
4. **Witness input.** Public signals (from the pool datum and the planned redeemer) and
   private witness (`secret`, `collateral_amount`, path) are assembled in the exact
   signal order of the circuit (`generateBorrowProof`, `generateRepayProof`,
   `generateSettlementProof`, `generateLeafAppendProof`).
5. **Proving.** snarkjs `groth16.fullProve` runs the circuit's witness generator
   (`circuits/*_js/*.wasm`) and the proving key (`circuits/keys/*_final.zkey`) and
   returns the proof and its public signals. If any constraint fails (for example an
   `R` that is not in `repaid_root`), no proof can be produced at all.
6. **Off-chain check.** The proof is verified once against the circuit's
   `verification_key_*.json` before anything is built.
7. **Encoding.** The BLS12-381 points are compressed to the byte format of the on-chain
   verifier (G1 48 bytes, G2 96 bytes, with the compression / infinity / sign flags in
   the first byte) and wrapped as `Proof { piA, piB, piC }` (`compressProof`). The
   verification keys are encoded the same way once, when they are parked
   (`buildVkeyDatum`).
8. **On-chain verification.** The proof goes into the redeemer (`R_DepositCollateral`,
   `R_Borrow`, `R_Repay`, `R_Unlock`). The validator rebuilds the public signals from
   the trusted pool state and the redeemer, in the same order, and calls
   `groth_verify` with the verification key at its parameter reference (§3).

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
  wraps it as `verify_borrow_proof` (6 signals), `verify_repay_proof` (7 signals),
  `verify_settlement_proof` (3 signals) and `verify_append_proof` (4 signals).
- **Pool identity by NFT.** The pool validator spends only the input that holds the
  one-shot pool NFT, and finds the continuing output by the NFT at the same address.
  The collateral validator trusts a pool reference input only if it carries the NFT.
  A UTxO that someone merely paid to the pool address can neither be spent as the pool
  nor serve as the unlock's source of `repaid_root`.
- **VKeys as parameters.** The borrow, repay, settlement and append vkey references are script
  parameters, read via `get_vkey` from the reference inputs. No datum can point the
  validators at a different key.
- **Public signals bound to trusted state.** `group_root`, `repaid_root`, the two next
  indices, `collateral_ratio`, `external_nullifier` and `repay_external_nullifier` come
  from the pool datum. Redeemer-supplied values are cross-checked:
  - `loan_nullifier` against the open and used sets
  - `loan_amount` and `repay_amount` against the fixed denominations and the pool value delta
  - `commitment` against the deposit append proof
  - `repay_nullifier` against the repay proof **and** the repay append proof (one value fed to both)
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
| Pool NFT policy | `4346c33b38b46f5b34b60b86bc9ba4ea55f392a3c4cc4cafd060c6ce` (token name `POOL`) |
| NFT seed UTxO | `71eb3a5fed1da2a20e7754e79394d98e063477c9a3ed1c79d590018f76adb5dc#1` |
| `lending_pool_v5` address | `addr_test1wz93tpqvc0l2ez8mqqx5ll395yy24w3h63uxzct3n4xjt6skt4q3p` |
| `lending_pool_v5` hash | `8b15840cc3feac88fb000d4ffe25a108aaba37d4786161719d4d25ea` |
| `collateral_v5` address | `addr_test1wpzmrvq50c8f6wcvsl6nel2g9tghzu8dqe2q2cs8h9grcrqwzdp7q` |
| `collateral_v5` hash | `45b1b0147e0e9d3b0c87f53cfd482ad17170ed0654056207b9503c0c` |
| VKey reference UTxOs | `edbfae0e6704086b0f9feddf30c83544c10406faf729792ba57bbdc4b2be1132` #0 borrow · #1 settlement · #2 append · #3 repay |
| Compiler | Aiken v1.1.19, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow (6 signals), repay (7 signals), settlement (3 signals), append (4 signals); all depth 10 |

The applied script hashes are derived from `contracts/plutus.json` with Mesh
`applyParamsToScript` along the parameter chain (`offchain/cli/v5/common.mjs`,
`deriveScripts`). `aiken blueprint apply` re-optimises the applied program and
therefore yields different (equivalent) bytes and hashes.

**Execution cost, measured live** (Preprod limits per tx: 17,500,000 mem / 10,000,000,000 cpu):

| Tx | Proofs verified | mem | cpu | Fee |
|---|---|---|---|---|
| Init + mint | none | 30,315 | 13,380,902 | 0.20 ADA |
| Deposit | append | 485,924 | 2,550,218,387 (26 %) | 0.62 ADA |
| Borrow | borrow | 480,680 | 2,815,800,439 (28 %) | 0.63 ADA |
| Repay | repay + append | 555,369 | 5,350,130,263 (54 %) | 0.83 ADA |
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
  enters `repaid_root` is a valid repayment **of that deposit's own loan**: the repay
  proof derives `R` and the settled loan nullifier from one secret. An `R`-absent root
  makes the membership proof unsatisfiable, which is the fail-closed test
  `unlock_without_repay_fails`.
- **One loan per deposit.** Each deposit's nullifier can borrow exactly once, so a
  settlement can never be reused for a later loan.
- **Owner-bound payouts.** Loans and collateral are paid only to the recipient the
  proof or the deposit fixed, so proofs cannot be front-run.

**Adversarial test suite.** `aiken check` runs **54 tests (0 warnings)**, including
validator tests with real BLS12-381 proofs:

| Area | Tests |
|---|---|
| Circuits on-chain | Proof verifies, and a tampered signal fails, for each circuit (borrow, repay, settlement, append, deposit append, recipient) |
| Pool NFT | Mint only with the seed, exactly one `POOL`, never burned |
| Pool identity | A pool UTxO without the NFT is not spendable; the NFT cannot leave the pool or its address; vkeys at other references are ignored |
| Deposit | Exact denomination, correct script, matching commitment, valid append, index advance; no other spend can rewrite `group_root` |
| Borrow | Membership succeeds; reused / used nullifier fails; second loan on a repaid deposit fails; insufficient denomination fails; payout to another key, a short payout, or a swapped recipient fails |
| Repay | Exactly principal + interest; under- and over-payment fail; bogus append fails; used nullifiers cannot be cleared; a foreign `R` fails; a copied borrow proof used as a repay proof fails |
| Unlock | Settled unlock succeeds; unlock without repayment fails; wrong commitment fails; forged pool reference fails; vkey at another reference fails; payout to another address, a short payout, or a payout tagged for another deposit fails |

### Independent testing

Independent testers ran the protocol on Preprod with their own wallets and pools; their
dated reports are in [`docs/Tester-Feedback/`](Tester-Feedback/) (index in
[`MILESTONE3-EVIDENCE.md`](MILESTONE3-EVIDENCE.md)). In the break-it run on 2026-11-18
([`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md)),
attacks 1–8 were rejected; attack 9 showed that the repayment nullifier was not bound
to the repaid loan. Commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3) binds it with
the repay proof (§2) and adds both attacks as regression tests
(`repay_with_foreign_repay_nullifier_fails`, `repay_with_copied_borrow_proof_fails`).
On the open loan of the live cycle above, both attacks were rejected by the validator
while the honest repay on the same state was accepted.

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
