# Milestone 3 — Private Lending with On-Chain zk-SNARK Verification

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** zk-SNARK proofs *verifiable on-chain* for **private** verification
of collateral and loan transactions.
**Status:** Delivered and demonstrated live on Cardano **Preprod**.

<!-- PENDING (internal, remove before tagging): values marked PENDING below are filled
from the asset-pool deployment and the test run on the tagged stand. -->

---

## 1. Protocol overview

The ZK-DeFi-Protocol is a private lending pool. Lenders add liquidity and withdraw it
with the interest it earned; borrowers deposit collateral, borrow against it, repay
with interest and reclaim the collateral. Every action is authorized by a real
**Groth16 zk-SNARK proof verified on-chain**. **There is no admin and no signature on
any path**: the proof is the authorization. Three Plutus V3 scripts implement it
(`contracts/validators/v5/`):

| Script | Role |
|---|---|
| `pool_nft` (minting policy, parameterised by a seed UTxO) | Mints exactly one `POOL` token, once, in the transaction that spends the seed. The pool UTxO carries it, so the validators can tell the real pool from any UTxO someone pays to the pool address. |
| `lending_pool_v5` (parameterised by the NFT policy, the collateral script hash and the vkey refs) | Pool liquidity and state. Authorizes `AddLiquidity`, `WithdrawLiquidity`, `DepositCollateral`, `BorrowAnonymous` and `RepayAnonymous`. Keeps the lender set (`lender_root`), the collateral set (`group_root`), the open and used loan nullifiers, the withdraw nullifiers and the append-only repaid set (`repaid_root`). |
| `collateral_v5` (parameterised by the NFT policy and the settlement vkey ref) | Holds collateral (one fixed denomination of an accepted asset) under a commitment. Authorizes `UnlockDeposit` via a settlement proof against the NFT-bearing pool. |

**Assets.** A pool is configured at initialization with:

- one **loan asset** (ADA or a native token). Liquidity, loans, repayments and lender
  shares are all denominated in it;
- a list of **accepted collateral assets**, each with its own fixed denomination
  (for example 20 ADA or 10 of a stablecoin). Deposits of all accepted assets share
  one collateral set.

The five verification keys (borrow, repay, settlement, append, lender withdraw) are
parked once as inline datums on an **unspendable (always-false) address**. The
validators read them as **reference inputs at fixed references given as script
parameters**, never from a datum.

### Privacy model

1. **Amount confidentiality.** Every amount is a fixed denomination of the pool: each
   collateral deposit, each loan, each repayment (principal + interest) and each lender
   share at a given pool state. Amounts therefore carry no per-position information.
   The collateral amount is not in any datum or public signal.
2. **Asset confidentiality.** Deposits of every accepted collateral asset share one
   collateral set, and every leaf has the same form,
   `commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)`. The borrow proof shows
   membership in that set without revealing the leaf. A loan therefore does not reveal which asset backs it, and the anonymity
   set is every deposit of every accepted asset.
3. **Deposit ↔ borrow unlinkability.** A borrow proves the collateral commitment is a
   **member of the on-chain commitment set** (a Merkle root). It does **not** reference
   a specific deposit UTxO, so nobody can tell which deposit backs a loan.
4. **Settlement-gated, unlinkable unlock.** Repaying a loan settles its
   `loan_nullifier`. In the same transaction the repayer inserts a distinct
   **repayment nullifier** `R = Poseidon255(secret, repay_external_nullifier)` into the
   append-only `repaid_root`, with a zero-knowledge append proof. The repay proof
   binds this `R` to the loan being repaid (same secret). Unlock then proves, in zero
   knowledge, **membership of the private `R` in `repaid_root`**. None of its public
   signals is shared with the borrow. So a deposit can only be unlocked after it was
   repaid, **and borrow ↔ unlock cannot be linked**.
5. **Anonymous lending.** A lender note is one pool share. `AddLiquidity` appends the
   note's leaf `Poseidon255(LENDER_LEAF_TAG, secret)` to `lender_root`. A withdrawal
   proves in zero knowledge that some note is in `lender_root`, reveals a one-time
   withdraw nullifier and pays the current share price to the key the proof is bound
   to. Nobody can link a withdrawal to the liquidity deposit it belongs to, see how
   long the lender stayed or what they earned.
6. **No fee-payer link.** Borrow, unlock and lender withdrawal need no funds from the
   user, and their proofs fix where the money goes (the borrow and withdraw proofs are
   bound to a recipient key, the unlock pays the deposit's own `unlock_to`). A
   third-party relayer can therefore pay the fees and submit them without being able
   to redirect funds, and the user's wallet does not appear in these transactions.
   The reference relayer is `server/src/relayer.mjs`.

Together, 3 to 6 mean that the actions of one user cannot be grouped on-chain: deposit,
borrow, unlock, liquidity deposit and withdrawal are pairwise unlinkable, so neither the
history nor the frequency of a user's activity can be reconstructed. Repay is linked to
its own borrow by design (both carry the loan nullifier); it is paid by the account
that received the loan.

### The full private lending cycle (confirmed live on Preprod)

PENDING: table of the live cycle on the asset-pool deployment:
park vkeys → init pool + mint NFT → add liquidity (two notes) → deposit collateral in
two different accepted assets → borrow (relayed) → repay → unlock (relayed) →
withdraw a share (relayed). Each row: step, what it proves, Preprod tx link.

Off-chain drivers: the shared protocol module `packages/protocol` (Mesh, Node ESM)
and the command line client on it. Every step finds the pool by its NFT, and the tx
builder evaluates every transaction (ExUnits) before it is submitted.

---

## 2. zk-proof generation mechanism

Five BLS12-381 Groth16 circuits (`circuits/`) all hash with **Poseidon255**
(`poseidon-bls12381`), so the in-circuit and on-chain values are identical.

The protocol uses Groth16 because:

- **It is the most mature option on Cardano.** Plutus V3's BLS12-381 builtins and the
  open-source `modulo-p/ak-381` verifier verify Groth16 proofs on-chain today.
- **It has the best cost profile.** It has very small proofs and very cheap
  verification (M1 §1.2). Every step fits in one transaction, including repay, which
  verifies two proofs (§4).

### Borrow — `collateral_semaphore.circom`

Proves, in zero knowledge, that the borrower owns **some** member of the collateral
set, without revealing which one or in which asset, and binds the proof to the payout
recipient.

- **Public signals:** `[group_merkle_root, loan_nullifier, external_nullifier, recipient]`
- **Private witness:** `secret`, Merkle path (`siblings`, `pathIndices`)
- **Constraints:**
  1. `leaf = Poseidon255(COLLATERAL_LEAF_TAG, secret)`
  2. Merkle membership `leaf ∈ group_merkle_root` (depth 10, Poseidon255 nodes)
  3. `loan_nullifier = Poseidon255(secret, external_nullifier)`
  4. range checks
  5. `recipient` (the payout key hash as an integer) is constrained, so a proof cannot be re-targeted at another key

Sufficiency is enforced on-chain, not in the proof. A leaf enters `group_root` only
through `DepositCollateral`, which locks exactly the fixed denomination of an accepted
asset, and every accepted denomination covers one loan at the pool's collateral ratio
(§5, Trust assumptions). The nullifier allows one loan per leaf. Every member of the
set is therefore sufficient, so the proof carries no amount, ratio or price, and
reveals nothing about the asset.

### Repay — `repay_proof.circom`

Proves the same membership as the borrow and, from the **same secret**, both the loan
nullifier being settled and the repayment nullifier `R` that the repay appends. A repay
can therefore only ever release its own deposit. The circuit has its own verification
key, so a (public) borrow proof is never a valid repay proof.

- **Public signals:** `[group_merkle_root, loan_nullifier, repay_nullifier, external_nullifier, repay_external_nullifier]`
- **Private witness:** `secret`, Merkle path
- **Constraints:**
  1. `leaf = Poseidon255(COLLATERAL_LEAF_TAG, secret)` and Merkle membership `leaf ∈ group_merkle_root`
  2. `loan_nullifier = Poseidon255(secret, external_nullifier)`
  3. `repay_nullifier = Poseidon255(secret, repay_external_nullifier)`
  4. range checks

### Unlock — `settlement_proof.circom`

Binds to the **specific** deposit being spent and proves the loan is settled,
**without revealing any value that was public at borrow**.

- **Public signals:** `[commitment, repaid_root, repay_external_nullifier]`
- **Private witness:** `secret`, Merkle path
- **Constraints:**
  1. `commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)`
  2. `R = Poseidon255(secret, repay_external_nullifier)`, a **private** witness that is never revealed
  3. Merkle membership `R ∈ repaid_root` (depth 10)
  4. range checks

### Lender withdraw — `lender_withdraw.circom`

Takes one pool share out without revealing which note it is.

- **Public signals:** `[lender_root, withdraw_nullifier, lender_external_nullifier, recipient]`
- **Private witness:** `secret`, Merkle path
- **Constraints:**
  1. `leaf = Poseidon255(LENDER_LEAF_TAG, secret)` and Merkle membership `leaf ∈ lender_root` (depth 10)
  2. `withdraw_nullifier = Poseidon255(secret, lender_external_nullifier)`; the pool records it, so a note pays out once
  3. `recipient` is constrained, so the payout cannot be redirected

The amount is not part of the proof: every note is one share, and the pool pays the
current share price, the same for every note.

### Append — `append_proof.circom` (liquidity, deposit and repay)

Lets a user grow an append-only set **themselves** (permissionless). It proves a leaf
was inserted at the next free position without disturbing the rest of the tree. The
same circuit and verification key serve all three sets:

| Used by | Leaf | Set |
|---|---|---|
| `AddLiquidity` | the lender note leaf | `lender_root` |
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

Every proof is generated off-chain by the user (in the CLI, or in the browser in M4)
and verified on-chain by a validator. The steps are the same for all five circuits;
the functions are in `packages/protocol/src/crypto.mjs`.

1. **Secret and leaf.** At deposit the user draws a random `secret` and computes
   `commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)`; a lender computes the note leaf
   `Poseidon255(LENDER_LEAF_TAG, secret)`. Only the leaf goes on-chain; the secret
   stays with the user.
2. **Derived values.** From the same secret the user derives the nullifiers: loan
   nullifier, repayment nullifier `R` and withdraw nullifier, each as
   `Poseidon255(secret, scalar)` with a scalar from the pool datum.
3. **Merkle path.** The user rebuilds the depth-10 Poseidon255 tree from the set's
   leaves in insertion order and takes the path of their leaf. The rebuilt root must
   equal the root in the current pool datum.
4. **Witness input.** Public signals (from the pool datum and the planned redeemer) and
   private witness (secret, path) are assembled in the exact signal order of
   the circuit.
5. **Proving.** snarkjs `groth16.fullProve` runs the circuit's witness generator
   (`circuits/*_js/*.wasm`) and the proving key (`circuits/keys/*_final.zkey`) and
   returns the proof and its public signals. If any constraint fails (for example an
   `R` that is not in `repaid_root`), no proof can be produced at all.
6. **Off-chain check.** The proof is verified once against the circuit's
   `verification_key_*.json` before anything is built.
7. **Encoding.** The BLS12-381 points are compressed to the byte format of the on-chain
   verifier (G1 48 bytes, G2 96 bytes, with the compression / infinity / sign flags in
   the first byte) and wrapped as `Proof { piA, piB, piC }`. The verification keys are
   encoded the same way once, when they are parked.
8. **On-chain verification.** The proof goes into the redeemer. The validator rebuilds
   the public signals from the trusted pool state and the redeemer, in the same order,
   and calls `groth_verify` with the verification key at its parameter reference (§3).

**Trusted setup.** Each circuit goes through a BLS12-381 powers-of-tau, then
`groth16 setup`, then a phase-2 contribution, producing `*_final.zkey` and
`verification_key_*.json`. *The Preprod setup is a single-contributor developer
ceremony. That is adequate to demonstrate the mechanism on Preprod; a multi-party
ceremony is required before mainnet (M1 Appendix A).*

---

## 3. On-chain verification design

- **Generic Groth16 verifier (reused, not rebuilt).** `modulo-p/ak-381` v0.1.1
  provides `groth_verify(vk, proof, public)` for BLS12-381. `contracts/lib/zk.ak`
  wraps it per circuit.
- **Pool identity by NFT.** The pool validator spends only the input that holds the
  one-shot pool NFT, and finds the continuing output by the NFT at the same address.
  The collateral validator trusts a pool reference input only if it carries the NFT.
  A UTxO that someone merely paid to the pool address can neither be spent as the pool
  nor serve as the unlock's source of `repaid_root`.
- **VKeys as parameters.** The vkey references are script parameters, read via
  `get_vkey` from the reference inputs. No datum can point the validators at a
  different key.
- **Public signals bound to trusted state.** Roots, next indices and nullifier scalars
  come from the pool datum. Redeemer-supplied values are cross-checked:
  - `loan_nullifier` against the open and used sets; `withdraw_nullifier` against the withdraw set
  - `loan_amount`, `repay_amount` and share payments against the fixed denominations, the share price and the pool value delta
  - `commitment` against the append proof and the collateral output
  - `repay_nullifier` against the repay proof **and** the repay append proof (one value fed to both)
  - `recipient` against the payout output

  A spender cannot feed the verifier convenient inputs.
- **Assets, checked on-chain.**
  - Pool value is measured in the loan asset; loans, repayments and share payouts are paid in it.
  - `DepositCollateral` names an accepted collateral asset and requires an output of exactly its denomination, with the commitment, at the collateral script.
  - Unlock pays the deposit's asset and denomination back to its `unlock_to`.
- **One loan per deposit.** A borrow records its nullifier in `open_loans` (what Repay
  settles) and in the never-shrinking `used_nullifiers`. A nullifier that was ever used
  cannot borrow again, so a repaid deposit's `R` can never cover a later loan.
- **Share accounting.** Share value = pool balance − reserve + outstanding loans, so
  the interest from every repayment raises the price of every share at once. Loans and
  withdrawals are paid only from free liquidity (pool balance above the reserve).
- **Payouts bound to their owner.**
  - The loan must be paid to the `recipient` key the borrow proof is bound to, in an output tagged with the loan nullifier.
  - A share must be paid to the `recipient` key the withdraw proof is bound to.
  - The collateral must be paid to the deposit's `unlock_to` address, in an output tagged with the spent deposit's reference.

  A proof copied from the mempool cannot redirect funds, and one output cannot settle
  two spends. This is also what makes the relayer safe (§1, item 6).
- **No signatures, no admin.** The proof *is* the authorization for every action. The
  sets grow only through their own redeemers.

---

## 4. Deployed addresses / hashes (Preprod)

PENDING: pool NFT policy, seed UTxO, `lending_pool_v5` and `collateral_v5` addresses
and hashes, vkey reference UTxOs, loan asset and accepted collateral assets of the
asset-pool deployment.

| Component | Value |
|---|---|
| Compiler | Aiken v1.1.19, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow, repay, settlement, append, lender withdraw; all depth 10 |

**Execution cost, measured live** (Preprod limits per tx: 17,500,000 mem / 10,000,000,000 cpu):

PENDING: mem / cpu / fee per transaction type of the live cycle.

---

## 5. Security & privacy model

The zk-SNARK proof is the **sole authorization** for every action. There is no admin
key and no owner signature. Four on-chain properties make that trustworthy:

- **Authentic state.** The pool is the one UTxO holding the one-shot NFT, and the
  verification keys are fixed by script parameters. Public signals are reconstructed
  from that state and cross-checked against the nullifier sets, the fixed amounts, the
  pool value delta and the append proofs.
- **Settlement-gated unlock.** Collateral can only be freed once a valid settlement
  proof shows the repayment nullifier is a member of `repaid_root`. The only way `R`
  enters `repaid_root` is a valid repayment **of that deposit's own loan**: the repay
  proof derives `R` and the settled loan nullifier from one secret. An `R`-absent root
  makes the membership proof unsatisfiable (`unlock_without_repay_fails`).
- **One payout per note and per deposit.** Each deposit's nullifier can borrow exactly
  once, and each lender note's withdraw nullifier pays out exactly once.
- **Owner-bound payouts.** Loans, shares and collateral are paid only to the recipient
  the proof or the deposit fixed, so proofs cannot be front-run.

**Adversarial test suite.** PENDING: `aiken check` count on the tagged stand. Validator
tests run with real BLS12-381 proofs:

| Area | Tests |
|---|---|
| Circuits on-chain | Proof verifies, and a tampered signal fails, for each circuit |
| Pool NFT | Mint only with the seed, exactly one `POOL`, never burned |
| Pool identity | A pool UTxO without the NFT is not spendable; the NFT cannot leave the pool or its address; vkeys at other references are ignored |
| Liquidity | A share costs exactly the current price; withdraw pays the share price to the bound key only; a used withdraw nullifier fails; withdraw beyond free liquidity fails |
| Deposit | Exact denomination of an accepted asset; an unlisted asset or a wrong amount fails; correct script, matching commitment, valid append, index advance |
| Borrow | Membership succeeds; reused / used nullifier fails; second loan on a repaid deposit fails; payout to another key, a short payout, or a swapped recipient fails |
| Repay | Exactly principal + interest in the loan asset; under- and over-payment fail; bogus append fails; used nullifiers cannot be cleared; a foreign `R` fails; a copied borrow proof used as a repay proof fails |
| Unlock | Settled unlock succeeds; unlock without repayment fails; wrong commitment fails; forged pool reference fails; vkey at another reference fails; payout to another address, in another asset, short, or tagged for another deposit fails |

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

### Trust assumptions

- **Pool initialization.** Whoever initializes the pool chooses its configuration: the
  verification keys (script parameters), interest rate, collateral ratio, loan asset,
  accepted collateral assets with their denominations, and initial liquidity. All of it
  is public in the init transaction and the script parameters, and it is immutable
  afterwards. Each collateral denomination is chosen to cover one loan at the ratio at
  the initializer's prices; the pool has no price feed.
- **Trusted setup.** The Preprod proving and verification keys come from a
  single-contributor developer ceremony (multi-party required before mainnet).
- **Relayer.** The relayer pays fees and cannot redirect funds or learn secrets. It
  sees the transactions it submits, which are public anyway. Anyone can run one, and a
  user can always submit the transaction themselves.

### Non-goals

The milestone demonstrates *on-chain ZK verification for private lending*, not a
complete money market. The following are not part of it:

- **No price feed, no liquidation.** Collateral value is fixed by the pool's
  denominations. If an accepted asset falls in price, its loans become
  undercollateralized, and nothing on-chain compels a borrower to repay. An oracle and
  a liquidation module are the upgrade path (M1 §6.5, "after MVP").
- **One loan asset per pool.** Borrowing a different asset means using its pool.
- **Capacity.** The lender, commitment and repaid sets are depth-10 Merkle trees
  (1,024 entries each). The nullifier sets are lists in the pool datum, which keep the
  pool to a few hundred loans over its lifetime. A Merkle-Patricia-Forestry set is the
  scale upgrade. Every pool action spends the single pool UTxO, so a pool processes one
  action per block.
- **No withdrawal without a loan.** Collateral is released through the settlement
  path, so a depositor who never borrowed reclaims it by borrowing and repaying at once.

### Privacy boundary

On a transparent UTXO ledger, ZK hides the link between actions and the position they
belong to; the movement of value into and out of the scripts stays public. The known
limits:

1. **Anonymity-set size.** Privacy scales with the number of deposits and notes in a
   pool. On a young protocol the practical set is small even though the mechanism is
   sound. It improves with adoption, not with code.
2. **Single transactions stay visible.** Each deposit, loan payout, repayment, share
   purchase and withdrawal is a public transaction with a time. What is hidden is which
   of them belong together (§1); an observer still sees *that* something happened at a
   given time.
3. **Assets at deposit.** A deposit shows which accepted asset was locked, as it shows
   that one denomination was locked. Which asset backs a given loan stays hidden.
4. **Addresses.** Payouts go to addresses the user chooses. The user keeps them apart
   (the M4 UI uses two wallet accounts); funding one from the other links them.

Cardano L1 was chosen deliberately (M1 §1.2) rather than the Midnight privacy
sidechain. The L1 privacy ceiling is lower than that of a purpose-built privacy chain;
the protocol targets that ceiling and documents the boundary.

The approved M1 (architecture) and M2 (smart contracts) Proofs of Achievement are
re-published in-repo at [`docs/poa/M1-POA.pdf`](poa/M1-POA.pdf) and
[`docs/poa/M2-POA.pdf`](poa/M2-POA.pdf).

---

## 6. Next steps (Milestone 4)

Milestone 4 puts a web UI over this protocol: CIP-30 wallet integration, in-browser
proof generation, a guided flow for lenders and borrowers with the relayer, and user
testing.

---

## 7. Note to reviewer

This section answers the points of the previous review. Page numbers refer to
[`docs/poa/M1-POA.pdf`](poa/M1-POA.pdf).

**What M3 is assessed against.** The M3 acceptance criteria are:

| Acceptance criterion | Where it is met |
|---|---|
| zk-SNARK proofs must allow for private verification of collateral and loan transactions. | §1 Privacy model, §2, §3; live cycle in §1 |
| zk-SNARK library must allow private lending and borrowing transactions. | Lending: `AddLiquidity` / `WithdrawLiquidity` with `lender_withdraw` (§1 item 5). Borrowing: deposit, borrow, repay, unlock (§1 items 1–4). Library: `packages/protocol`, `circuits/` |
| Test cases must perform transactions and verifications in a reasonable time. | Execution cost per transaction (§4), proof times and pass/fail rates in [`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md) |
| Documentation must be comprehensible and cover the entire zk proof generation. | §2, Proof generation, end to end |

The review confirms the first criterion is met: the unlock-without-repay issue is
resolved, interest is enforced on-chain, and deposit ↔ borrow and borrow ↔ unlock are
unlinkable. The second criterion asks for private lending as well as borrowing, which
item 3 below covers. M1 was approved as an architecture document. Its acceptance criteria ask how zk-SNARKs
protect financial data and that the protocol be "modular and scalable and easy to
implement" (p. 2). The points below show where the built protocol follows M1, and
where the implementation on Cardano L1 determined the concrete component.

**1. Amount and asset confidentiality.** M1 §2.1 promises that collateral assets and
the values of collateral, loans and repayments remain private (p. 15). Both are
delivered (§1, items 1 and 2):

- Every amount is a fixed denomination, so no amount carries information about a
  position.
- Collateral of several assets shares one commitment set, and a loan does not reveal
  which asset backs it.

The values locked in a UTxO are public on Cardano L1. Hiding arbitrary amounts there
would need range proofs and a shielded pool with encrypted notes, a separate protocol
of the size of Zcash Sapling. M1 committed to Cardano L1 and explicitly not to Midnight
(p. 5). Fixed denominations are the way to make amounts uninformative on L1 within
Plutus execution budgets.

**2. Multi-asset support.** A pool lends one asset, ADA or a native token, and accepts
several collateral assets (§1, Assets). The live cycle uses two collateral assets
(§1). PENDING: assets of the deployment.

**3. Anonymous lending.** Delivered (§1, item 5): lender notes in `lender_root`, a
zero-knowledge withdrawal with a one-time nullifier, payout to a key bound in the
proof. This is the lending flow of M1 §1.4 C (pp. 12–13): a commitment for the
position, a nullifier against double withdrawal, a ZK proof of position ownership, and
no public link between the lender and the position. `AddLiquidity` carries only the
note leaf and one share price.

**4. Borrower privacy: recipient addresses, fee payers, timing.**

- *Fee payers:* borrow, unlock and lender withdrawal are relayed (§1, item 6). The
  user's wallet does not appear in them.
- *Recipient addresses:* payouts go to keys the user chooses for each step, and the
  proofs bind them, so the relayer cannot change them.
- *Timing and activity:* M1 promises that "the timing and frequency of loan-related
  activities remain private" (p. 15). The actions of one user are pairwise unlinkable
  (§1), so the frequency and history of a user's activity cannot be reconstructed. The
  existence of a transaction at a given time is a property of every public ledger and
  is stated in §5, Privacy boundary.

**5. Groth16 instead of PLONK.** M1 states the choice of proof system as a
recommendation with a contingency: "we consider PLONK as the primary zero-knowledge
proof system. However, as a contingency plan, we will maintain awareness of Halo2
developments" (p. 10), and describes "how the system could be integrated" (p. 15). M1
itself rates Groth16 best on the two properties that set transaction cost on Cardano,
proof size (~200 bytes against 600–800) and verification time (p. 7), and lists the
Groth16 Cardano-Semaphore implementation among its references (p. 5). During
implementation, Groth16 was the system with a working on-chain verifier on Plutus V3's
BLS12-381 builtins (`modulo-p/ak-381`); repay verifies two proofs in one transaction at
about half the CPU budget (§4).

**On the trusted setup:** M1 already requires one. Its PLONK also needs a universal
trusted setup (comparison table, p. 7), and M1 Appendix A, "Trusted Setup for PLONK"
(p. 40), specifies a multi-party ceremony. Groth16 needs the same ceremony once per
circuit. The trust assumption is the same as in M1: a multi-party ceremony before
mainnet (§5, Trust assumptions).

**6. Poseidon instead of Pedersen.** Poseidon is part of the M1 design. M1 has a
section "Poseidon Hash-Based Commitments — Why Poseidon?" with
`Nullifier = Poseidon(UserSecret || TransactionType || Nonce)` (p. 20), and its
borrowing and lending flows create "Poseidon-hashed nullifiers" (pp. 12–13). Pedersen
was named for the commitment to the collateral amount (p. 17). With fixed
denominations the amount is no longer a variable to commit to, so one hash function
serves every commitment and nullifier, identical in the circuit and on-chain.
