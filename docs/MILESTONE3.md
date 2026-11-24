# Milestone 3 — Private Lending with On-Chain zk-SNARK Verification

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** zk-SNARK proofs *verifiable on-chain* for **private** verification
of collateral and loan transactions.
**Status:** Delivered and demonstrated live on Cardano **Preprod**.

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
| `lending_pool_v5` (parameterised by the NFT policy, the collateral script hash and the vkey refs) | Pool liquidity and state. Authorizes `AddLiquidity`, `WithdrawLiquidity`, `DepositCollateral`, `BorrowAnonymous` and `RepayAnonymous`. Keeps the lender set (`lender_root`), the collateral set (`group_root`), the append-only repaid set (`repaid_root`) and two nullifier sets as Merkle Patricia Forestry roots: `loans` (every loan nullifier, open or settled) and `withdrawn` (the withdraw nullifiers of paid-out notes). |
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
   The collateral amount is not in any datum or public signal. A larger position is
   several deposits and several loans, each indistinguishable from any other, and a
   loan is repaid in one amount, principal plus interest; an individual loan size or a
   partial repayment would be a value only that position has.
2. **Asset confidentiality.** Deposits of every accepted collateral asset share one
   collateral set, and every leaf has the same form,
   `commitment = Poseidon255(COLLATERAL_LEAF_TAG, secret)`. The borrow proof shows
   membership in that set without revealing the leaf. A loan therefore does not reveal
   which asset backs it, and the anonymity set is every deposit of every accepted asset.
3. **Deposit ↔ borrow unlinkability.** A borrow proves the collateral commitment is a
   **member of the on-chain commitment set** (a Merkle root). It does **not** reference
   a specific deposit UTxO, so nobody can tell which deposit backs a loan. This is why
   the collateral set is a Merkle root rather than one UTxO per position: a proof that
   spends or references a specific UTxO names the deposit it belongs to.
4. **Settlement-gated, unlinkable unlock.** Repaying a loan marks its
   `loan_nullifier` settled. In the same transaction the repayer inserts a distinct
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
   to redirect funds; no wallet of the user pays for or signs these transactions. The
   reference relayer is `server/src/relayer.mjs`.

**What links and what does not.** Each pair of actions, as the chain shows it:

| Pair | Linked? | Why |
|---|---|---|
| Deposit ↔ borrow | no | the borrow proves membership in the set, without a deposit reference (3) |
| Borrow ↔ repay | yes | both carry the loan nullifier, by design |
| Borrow ↔ unlock | no | the unlock shares no public value with the borrow (4) |
| Repay ↔ unlock | no | the unlock proves membership of a private `R` (4) |
| Deposit ↔ unlock | yes | the unlock spends the deposit UTxO itself |
| Liquidity deposit ↔ withdrawal | no | the withdrawal proves membership in the note set (5) |

So a borrower's activity falls into two groups that the chain cannot join: deposit
and unlock on one side, borrow and repay on the other; a lender's share purchase and
withdrawal cannot be joined either. This holds when each group uses its own address:
the deposit is paid from one wallet and `unlock_to` is a fresh address, the loan goes
to another, and the share payout to a third; funding one of these addresses from
another links them. The live cycle below uses separate addresses for every role.

### The full private lending cycle (confirmed live on Preprod)

Two pools run on the same scripts and verification keys. Every role uses its own
address: the lender (L), the depositor (D), the address the collateral returns to (U),
the borrower who receives the loan and repays (B), the relayer that submits borrow,
unlock and withdrawal (R), and the address the withdrawn share goes to (P).

**Pool 1 lends ADA** and accepts 20 ADA or 500 TOK as collateral:

| # | Step | What is verified on-chain | Preprod tx |
|---|------|---------------------------|-----------|
| 1 | **Park keys.** The five verification keys go to an always-false address. | none | [`c4e8e1b7acf5…`](https://preprod.cardanoscan.io/transaction/c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d) |
| 2 | **Init pool + mint the pool NFT**, with the loan asset (ADA), the accepted collateral assets and empty nullifier sets in the datum. | one-shot minting policy | [`3acf4248a5cb…`](https://preprod.cardanoscan.io/transaction/3acf4248a5cbffb2c3571ae7aa1c52154602d8a7fa52daf1c29d4c8bd6d5e059) |
| 3 | **Publish the scripts** as reference scripts on the always-false address. | none | [`5d90207c5c14…`](https://preprod.cardanoscan.io/transaction/5d90207c5c14d9185d0f97ae76c585cd45dca7b118048cc07cddaeb3a3d50791) |
| 4 | **Deposit 20 ADA** (asset 0) and **deposit 500 TOK** (asset 1), both by D, collateral returning to U. Both commitments enter the same `group_root`. | append proof; exact denomination of the named asset | [`9f7f17cad29f…`](https://preprod.cardanoscan.io/transaction/9f7f17cad29f2e3e584728cb74e595279f23e61d8bf0e9a38bae47e918f974a3), [`fa297a3a89bf…`](https://preprod.cardanoscan.io/transaction/fa297a3a89bfdcf36ee9767e65373480408536ab1ced5347529bcb91099ca926) |
| 5 | **Add liquidity**, two shares of 10 ADA by L. Each note leaf enters `lender_root`. | append proof | [`c75f5bd192e3…`](https://preprod.cardanoscan.io/transaction/c75f5bd192e344809ef52cdf4c2eb57b478541238b0a0755b085e3758d715df9), [`29344705f1fa…`](https://preprod.cardanoscan.io/transaction/29344705f1fadf774f0fc8b6847aab13b4db5879ca7759c2955e8ebaca52125b) |
| 6 | **Borrow 10 ADA**, backed by the TOK deposit, paid to B, submitted by R. Nothing in the transaction names the deposit, its asset or D. The loan nullifier enters the `loans` set as open. | borrow proof (membership, nullifier, recipient); MPF insert | [`b219752d2a64…`](https://preprod.cardanoscan.io/transaction/b219752d2a646c5e67f0302ad949eacea0940913ec5f8a148a32088948fd5b42) |
| 7 | **Repay 10.5 ADA** from B. The loan is marked settled and `R` enters `repaid_root`. | repay proof + append proof; MPF update | [`f854d3c38034…`](https://preprod.cardanoscan.io/transaction/f854d3c380343d1bc5e4857aa4b1a4f77e4fa2c13e1eeb1b5637181f52135aa9) |
| 8 | **Unlock**: the 500 TOK and their ADA go to U, submitted by R. | settlement proof | [`101b958540d6…`](https://preprod.cardanoscan.io/transaction/101b958540d60b074b13c8bada78e6ab4f872d6917255e9bb2517f03f2f55048) |
| 9 | **Withdraw one share**: 10.25 ADA (principal plus its part of the interest) to P, submitted by R. | lender withdraw proof; MPF insert | [`b4c42d0cb457…`](https://preprod.cardanoscan.io/transaction/b4c42d0cb457679afa75166c13ccd943675840cdec8e9a6ccc82ef5b14ac5496) |

**Pool 2 lends the USD test token** (same keys, same collateral list) and ran the
same cycle in USD with the same roles: init [`baaafc06a45d…`](https://preprod.cardanoscan.io/transaction/baaafc06a45dc37979c2a82e2e95a6adb8ddf25811b5069ee9c98e8197d9ae15), two shares of 10 USD,
a deposit of 20 ADA by D, a relayed loan of 10 USD to B [`a7f3f565da9d…`](https://preprod.cardanoscan.io/transaction/a7f3f565da9d33b42ed1a35d2f0393d775228178c8a61823b85a4a37d83f2624), repayment
of 10.5 USD by B [`c1ce59019185…`](https://preprod.cardanoscan.io/transaction/c1ce59019185b7c3cdddd578fad1bb1d9ed45d74be8a0b6d61d71300e4e67517), a relayed unlock to U and a relayed share
withdrawal of 10.25 USD to P [`ed53a299f0d3…`](https://preprod.cardanoscan.io/transaction/ed53a299f0d3263efd6298331d225a34baa339c42ca79b98de4509c604fa26bf). The pool's own 5 ADA did not move.

Every transaction of both cycles is listed in
[`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md) §3; all are
`valid_contract: true`. No protocol transaction carries a value that the deposit side
(D, U) and the loan side (B) share, so the protocol creates no link between them. The
demo addresses were funded from one test wallet (L, which also minted the test
tokens); that funding lies outside the protocol.

Off-chain drivers: the shared protocol module `packages/protocol` (Mesh, Node ESM)
and the command line client on it, `offchain/cli/m4/run.mjs`. Every step finds the pool by its NFT, and the tx
builder evaluates every transaction (ExUnits) before it is submitted.

---

## 2. zk-proof generation mechanism

Five BLS12-381 Groth16 circuits (`circuits/`) all hash with **Poseidon255**
(`poseidon-bls12381`), so the in-circuit and on-chain values are identical. There is
one circuit per action. Each proof then carries only the public signals its action
needs, so actions share only the values the protocol links on purpose (a borrow and
its repay share the loan nullifier; a borrow and an unlock share none), and every step
stays within one transaction.

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
asset, and every accepted denomination is set to cover one loan with a margin
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
`verification_key_*.json`. The powers of tau are universal and shared by all five
circuits. The Preprod keys come from a development setup; production keys come from
the multi-party ceremony described in M1 Appendix A.

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
  - `loan_nullifier` against the `loans` set; `withdraw_nullifier` against the `withdrawn` set
  - the pool value delta against the fixed loan denomination, principal + interest and the share price
  - `commitment` against the append proof and the collateral output
  - `repay_nullifier` against the repay proof **and** the repay append proof (one value fed to both)
  - `recipient` against the payout output

  A spender cannot feed the verifier convenient inputs.
- **Assets, checked on-chain.**
  - Pool value is measured in the loan asset; loans, repayments and share payouts are paid in it.
  - `DepositCollateral` names an accepted collateral asset and requires an output of exactly its denomination, with the commitment, at the collateral script.
  - Unlock pays the deposit's asset and denomination back to its `unlock_to`.
- **Nullifier sets of constant size.** `loans` and `withdrawn` are Merkle Patricia
  Forestry roots (`aiken-lang/merkle-patricia-forestry`). A borrow inserts its loan
  nullifier as open, with a proof that it is not in the set yet; a repay updates it
  from open to settled, with a proof that it is open; nothing deletes. A withdrawal
  inserts its withdraw nullifier the same way. So a nullifier borrows once ever, a
  repaid deposit's `R` can never cover a later loan, a note pays out once, and the
  pool datum keeps its size however many loans and withdrawals the pool has seen: no
  one can grow it until a transaction stops fitting. The nullifiers live in this set
  rather than in the UTxOs they belong to, because a nullifier carried by a UTxO
  would name the position.
- **Scripts by reference.** The pool and collateral scripts are published once as
  reference scripts, so transactions reference them instead of carrying them. The pool
  output may not carry a reference script of its own.
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

| Component | Pool 1 (lends ADA) | Pool 2 (lends USD) |
|---|---|---|
| Deployment file | `packages/protocol/deployments/preprod-m3-ada.json` | `packages/protocol/deployments/preprod-m3-usd.json` |
| Loan asset | ADA | USD `537a02f3e1f878c9e814bf6dc8ebbd584c04b5d49c310331879020b5` · `555344` |
| Accepted collateral | [0] 20 ADA · [1] 500 TOK (`537a02f3…` · `544f4b`) | same |
| Pool NFT policy | `1c00069bd09cb3e6a5d32f5a8e7b852144a8004ede70963e14c20b1a` | `dcc6a744032782058554e242b23dc9d66ac287bf351d122aa8d8bd1f` |
| `lending_pool_v5` hash | `9a81be8900f34a86e80c1a7f6345abe5bd86f60b4700a047e513a3b0` | `102cda4952391ac02b95234a26fb9852655f07b8a9846447c438abbf` |
| `lending_pool_v5` address | `addr_test1wzdgr05fqre54phgpsd87c6940jmmphkpdrspgz8u5f68vquqlfkw` | `addr_test1wqgzekjf2gu34sptj5355fhmnpfx2hc8hz5cgez8csu2h0c5ekrc3` |
| `collateral_v5` hash | `388d33810aee0ba246179fd2d970f76a790f72f771159e0c5301698a` | `163bb361d8fc9b0e78347cc955df2750de39e0a577d6c3fd4ad0ea26` |
| `collateral_v5` address | `addr_test1wqug6vuppthqhgjxz70a9kts7a48jrmj7ac3t8sv2vqknzs9dx5e8` | `addr_test1wqtrhvmpmr7fkrncx37vj4wlyagduw0q54madslaftgw5fsjkjwej` |
| Reference scripts (pool #0, collateral #1) | `5d90207c5c14d9185d0f97ae76c585cd45dca7b118048cc07cddaeb3a3d50791` | `c7914adc284dfbadf136669b998a0561f3a6860c6f33d544df903acbf22a791d` |
| Verification keys | `c4e8e1b7acf51d67bb2ebeb0561ee8b86a71778a4b1e9842ef51a1a9afd90b7d` #0 borrow · #1 settlement · #2 append · #3 repay · #4 lender withdraw | same |

TOK and USD are test tokens minted for this demonstration under one policy
(`537a02f3…`). The applied script hashes are derived from `contracts/plutus.json`
with Mesh `applyParamsToScript` along the parameter chain
(`packages/protocol/src/scripts.mjs`); the golden tests check them against the
deployment.

| Build | Value |
|---|---|
| Compiler | Aiken v1.1.19, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuits | BLS12-381, Groth16, Poseidon255; borrow, repay, settlement, append, lender withdraw; all depth 10 |

**Execution cost, measured live** (Preprod limits per tx: 17,500,000 mem / 10,000,000,000 cpu):

| Tx | Proofs verified | mem | cpu | of the cpu limit | Fee |
|---|---|---|---|---|---|
| Add liquidity | append | 529,267 | 2,580,378,519 | 26 % | 0.57 ADA |
| Deposit | append | 612,406 | 2,607,769,998 | 26 % | 0.58 ADA |
| Borrow | borrow + MPF insert | 598,335 | 2,605,451,995 | 26 % | 0.58 ADA |
| Repay | repay + append + MPF update | 690,582 | 5,151,030,842 | 52 % | 0.78 ADA |
| Unlock | settlement | 336,380 | 2,373,206,815 | 24 % | 0.42 ADA |
| Withdraw a share | lender withdraw + MPF insert | 625,870 | 2,618,035,308 | 26 % | 0.58 ADA |

Figures from pool 1; in pool 2 the CPU steps differ by less than 1 % and the memory by less than 15 %. Pool and collateral scripts are spent by reference, which keeps the fees about 0.15 ADA below inline scripts.

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

**Adversarial test suite.** `aiken check` runs **109 tests**; the validator tests run
with real BLS12-381 proofs. Together with the circuit, protocol-module and relayer
tests, the full list, pass rates and edge cases are in
[`MILESTONE3-TEST-RESULTS.md`](MILESTONE3-TEST-RESULTS.md).

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
| Assets | A token pool lends, takes repayments and pays shares in its token; a payout in ADA, taking the pool's ADA, pushing a foreign token into the pool, or rewriting the loan asset or the collateral list fails |

### Independent testing

Independent testers ran the protocol on Preprod with their own wallets and pools; their
dated reports are in [`docs/Tester-Feedback/`](Tester-Feedback/) (index in
[`MILESTONE3-EVIDENCE.md`](MILESTONE3-EVIDENCE.md), with the stand each report covers).
In the break-it run on 2026-11-18 on an earlier stand
([`MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md)),
attacks 1–8 were rejected; attack 9 showed that the repayment nullifier was not bound
to the repaid loan. Commit
[`6b5cbb3`](https://github.com/TrustLevel/ZK-Defi-Protocol/commit/6b5cbb3) binds it with
the repay proof (§2) and adds both attacks as regression tests
(`repay_with_foreign_repay_nullifier_fails`, `repay_with_copied_borrow_proof_fails`).

### Trust assumptions

- **Pool initialization.** Whoever initializes the pool chooses its configuration: the
  verification keys (script parameters), interest rate, loan asset and loan
  denomination, accepted collateral assets with their denominations, and initial
  liquidity. All of it is public in the init transaction and the script parameters,
  and it is immutable afterwards. Each collateral denomination is chosen to cover one
  loan with a margin at the initializer's prices (the deployed pools: 20 ADA or 500 TOK
  for a loan of 10); the pool has no price feed.
  The client checks that a pool was initialized honestly before it acts
  (`verifyPool` in `packages/protocol/src/chain.mjs`): the init transaction put the NFT
  into the pool address with the empty datum, the parked verification keys are the ones
  in `circuits/keys`, and the pool's totals match its sets. A pool that fails the check
  is refused.
- **Trusted setup.** The Preprod proving and verification keys come from a development
  setup. Production keys come from a multi-party ceremony (M1 Appendix A), which is
  secure as long as one participant is honest.
- **Relayer.** The relayer pays fees and cannot redirect funds or learn secrets. It
  sees the transactions it submits, which are public anyway. Anyone can run one, and a
  user can always submit the transaction themselves. Every relayed transaction costs
  the relayer its fee, and a payout in a native token also its output's min ADA, so the
  reference relayer caps relayed transactions per payout key and per day. A relayer
  could attach its own stake credential to a payout output (the validator binds the
  payment key); the output's funds stay with the recipient.

### Non-goals

The milestone demonstrates *on-chain ZK verification for private lending*, not a
complete money market. The following are not part of it:

- **No price feed, no liquidation.** Collateral value is fixed by the pool's
  denominations. If an accepted asset falls in price, its loans become
  undercollateralized, and nothing on-chain compels a borrower to repay. An oracle and
  a liquidation module are the upgrade path (M1 §6.5, "after MVP").
- **One loan asset per pool.** Borrowing a different asset means using its pool.
- **Capacity.** The lender, commitment and repaid sets are depth-10 Merkle trees
  (1,024 entries each); a pool is full when one of them is. The nullifier sets have no
  such bound. Every pool action spends the single pool UTxO, so a pool processes one
  action per block.
- **Proofs against the current root.** A borrow, repay or withdraw proof is made against
  the current root of its tree. Any action that grows that tree in between (a deposit,
  a repay, a share purchase) makes the proof stale; the client then proves again. A
  third party willing to pay a transaction per block can delay someone's action this
  way, not prevent it for good.
- **No withdrawal without a loan.** Collateral is released through the settlement
  path, so a depositor who never borrowed reclaims it with a loan and its repayment, in
  two transactions: this needs free liquidity of one loan denomination in the pool and
  costs one loan's interest and two fees.

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
   (§1, What links and what does not); funding one from the other links them, and so
   does a collateral `unlock_to` that is the depositing wallet.

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

The review acknowledged that the unlock-without-repay issue is resolved, that interest
is enforced on-chain, and that deposit ↔ borrow and borrow ↔ unlock are unlinkable.

**M1 and M3.** M1 is the approved architecture. It sets what the protocol must
guarantee and outlines how: its acceptance criteria ask that the document "outline"
how zk-SNARKs protect financial data (p. 2), it describes "how the system could be
integrated" (p. 15), lets the contracts be "divided into different modules or even
separate contracts if it's reasonable for the protocol's performance" (p. 22), and
expects that "as our DeFi protocol evolves, we'll need to update circuit logic"
(p. 8). M3 builds this architecture on Cardano L1. Every guarantee M1 states is
delivered:

| M1 guarantee | Delivered in M3 | Evidence |
|---|---|---|
| **Asset confidentiality:** "The specific assets used as collateral remain private" (pp. 11, 15) | All accepted collateral assets share one commitment set; a loan does not reveal which asset backs it (§1 item 2) | Borrow [`b219752d…`](https://preprod.cardanoscan.io/transaction/b219752d2a646c5e67f0302ad949eacea0940913ec5f8a148a32088948fd5b42), backed by the TOK deposit; nothing in it names the deposit or its asset |
| **Amount confidentiality:** "The exact values of collateral, loans, and repayments remain private" (p. 15) | Every amount is a fixed denomination of the pool; no amount carries information about a position, and the collateral amount is in no datum or public signal (§1 item 1) | Borrow and repay public signals (§2); deposits of 20 ADA and 500 TOK in one set |
| **Identity protection:** "Borrower identities cannot be linked to specific loans" (p. 15) | The borrow proves membership in the set without naming a deposit, pays a proof-bound key and is relayed (§1 items 3, 6) | Borrow relayed by R to B; D appears in no loan transaction |
| **Relationship privacy:** "Connections between borrowers and lenders remain private" (p. 15) | Lenders hold anonymous notes in a pool; no loan and no note share a value (§1 item 5) | Pair table in §1 |
| **Activity concealment:** "The timing and frequency of loan-related activities remain private" (p. 15) | A user's actions fall into groups the chain cannot join, so a user's history and frequency cannot be read off the chain (§1, What links and what does not) | Pair table in §1; separate address per role in the live cycle |
| **Anonymous lending:** "Their identity remains disconnected from their lending activity"; "The amount they've lent isn't publicly visible" (p. 11) | A note is one share; a withdrawal proves note membership and reveals a one-time nullifier; a larger position is several notes (§1 item 5) | Withdraw [`b4c42d0c…`](https://preprod.cardanoscan.io/transaction/b4c42d0cb457679afa75166c13ccd943675840cdec8e9a6ccc82ef5b14ac5496), paid to P |
| **Collateral verification** (M1 §2.2; M3 output 1) | At deposit, the validator admits only an accepted denomination under the commitment the append proof inserts; at borrow, the proof shows ownership of a member of that set, one loan per member (§2) | `deposit_*` and `borrow_*` tests; live deposits and borrow |

The points of the review, in order:

**1. Amount and asset confidentiality.** On Cardano L1 the value of every UTxO is
public: a collateral UTxO shows the amount it holds whatever its datum commits to,
and a loan payout shows its amount as the output value. A commitment to the amount
hides it inside the proof, not on the ledger. M3 therefore delivers the guarantee of
p. 15 by making every amount uniform. Each deposit, loan, repayment and share is the
pool's fixed denomination, so the ledger shows what M1 lists as public on-chain data,
"total pool statistics (aggregate amounts without individual breakdowns)" (p. 14),
and no amount that belongs to one position. Collateral of several assets shares one
commitment set, so a loan does not reveal its asset either. M1 committed to Cardano L1
rather than Midnight (p. 5); this is how the guarantee holds there, within Plutus
execution budgets.

**2. Multi-asset support.** A pool lends one asset, ADA or a native token, and accepts
several collateral assets (§1, Assets). On Preprod, pool 1 lends ADA and pool 2 lends
a native token (USD); both accept ADA and TOK as collateral, and pool 1's loan was
backed by the TOK deposit without the transaction revealing it (§1, live cycle; §4).

**3. Anonymous lending.** Delivered (§1, item 5), following the lending flow of M1
§1.4 C (pp. 12–13): a commitment for the position, a nullifier against double
withdrawal, a zero-knowledge proof of position ownership, and no public link between
the lender and the position. `AddLiquidity` carries only the note leaf and one share
price.

**4. Recipient addresses, fee payers, timing.**

- *Fee payers:* borrow, unlock and lender withdrawal are relayed (§1, item 6); no wallet
  of the user pays for or signs them.
- *Recipient addresses:* payouts go to addresses the user chooses for each role, and
  the proofs bind them, so the relayer cannot change them. The live cycle uses a
  separate address for every role (§1).
- *Timing and activity:* a borrower's actions fall into two groups the chain cannot
  join (deposit and unlock; borrow and repay), and a lender's purchase and withdrawal
  cannot be joined either. With each group on its own address, a user's history and frequency are therefore not visible.
  That a transaction happened at a given time is visible on every public ledger (§5,
  Privacy boundary).

**5. Groth16 as the proof system.** M1 evaluates the proof system as a design choice:
the survey asks to "consider both PLONK and Halo2" (p. 5), the recommendation names
PLONK as primary with a contingency (p. 10), and its PLONK figures are expectations
("expected to be 600–800 bytes", p. 18). M1 rates Groth16 best on the two properties
that set transaction cost on Cardano, proof size (~200 bytes) and verification time
(p. 7), and its references include the Groth16 Cardano-Semaphore implementation, both
among the Cardano projects (p. 5) and as the example trusted setup (p. 41). At
implementation, Groth16 was the proof system with a working verifier on Plutus V3's
BLS12-381 builtins (`modulo-p/ak-381`). The result is measured, not expected: every
step is one transaction, and repay verifies two proofs at about half the CPU budget
(§4). Like the PLONK setup in M1 (p. 7), it rests on a trusted setup whose powers of
tau are universal and shared by all circuits; the production ceremony follows M1
Appendix A (§5, Trust assumptions).

**6. Poseidon for commitments and nullifiers.** Poseidon is part of the M1 design:
"Poseidon Hash-Based Commitments — Why Poseidon?" (p. 20), the nullifier structure
`Nullifier = Poseidon(UserSecret || TransactionType || Nonce)` (p. 21) and the
"Poseidon-hashed nullifiers" of the borrowing and lending flows (pp. 12–13). M1 named
Pedersen for the commitment to the collateral amount (pp. 16–17). With uniform amounts
(point 1) there is no amount left to commit to, so one hash function serves every
commitment and nullifier, identical in the circuit and on-chain, and the cheapest in
the circuit, which is why M1 chose it (p. 20).
