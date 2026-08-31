# Privacy Model & the M1→M3 Implementation Pivot

**Project 1300196 — ZK DeFi Protocol.** This document is written for the milestone
reviewers. It states, honestly and up front, (1) how the M3 implementation evolved
from the M1 architecture, and (2) exactly what privacy the protocol delivers and
where the limits are on Cardano L1. The approved M1 & M2 Proofs of Achievement are
re-published alongside this file at [`docs/poa/M1-POA.pdf`](poa/M1-POA.pdf) and
[`docs/poa/M2-POA.pdf`](poa/M2-POA.pdf).

---

## 1. The M1 → M3 pivot (implementation change, not an objectives change)

The M1 Architecture Design Document selected **PLONK** as the primary proof system
and described a **UTXO-commitment** nullifier scheme (M1 §1.2.4, §2.3.2). The M3
implementation instead uses **Groth16 over BLS12-381** with a **Merkle-set membership
+ nullifier** anonymity model.

**Why the change:**

- **On-chain verifiability.** M3's acceptance criterion requires proofs *verifiable
  on-chain*. The one production-grade, standalone Groth16 verifier on Cardano today
  is `modulo-p/ak-381` (BLS12-381), already used in production by the sibling
  ZK-Voting project on the same stack. No equivalent standalone on-chain PLONK
  verifier was available to us at M3 time.
- **M1 already pointed here.** M1 §1.2.1 and Appendix A cite **Modulo-P's
  Cardano-Semaphore** (Groth16 + Merkle tree + nullifier MPF) as the reference
  Cardano ZK implementation. The M3 design ports exactly that reference pattern.
- **The objectives are unchanged.** The M1 §2.1 privacy guarantees (asset/amount
  confidentiality, identity protection, relationship privacy) and the M2 lending
  lifecycle (collateral verification, borrow, repay, interest, unlock) are the
  same. Only the *cryptographic system* (PLONK→Groth16) and the *nullifier storage*
  (UTXO-commitment → Merkle Patricia Forestry) changed. Because the project
  objectives are unchanged, this is an implementation choice, not a scope change.

**Trade-off we accept:** Groth16 needs a per-circuit trusted setup (M1 §1.2.3). The
M3 trusted setup is a single-contributor developer ceremony — adequate for a
Preprod milestone demonstrating the mechanism, not for mainnet. A multi-party
ceremony (M1 Appendix A, ≥5 contributors) is required before mainnet and is called
out as future work.

---

## 2. What privacy the protocol delivers

The protocol is a **set-membership + linkage** privacy system (Semaphore-style),
plus **denomination-bucketed amount hiding**. Concretely:

| M1 §2.1 guarantee | How it is delivered | Status |
|---|---|---|
| Amount confidentiality | `collateral_amount` is a private circuit witness; collateral is held in **fixed denominations** so the on-chain `value` reveals only "one unit", not the position size. | Fixed-denomination model |
| Identity protection | The borrower proves **membership in the commitment set** (Merkle root) instead of signing with a pubkeyhash; no `owner` key is exposed on the anonymous path. | Membership proof |
| Relationship privacy (deposit↔borrow unlinkability) | Borrow proves "*some* commitment in the set is sufficient and I own it" — it does **not** reference a specific deposit UTxO. The loan is tracked by a **nullifier**, not a UTxO link. | Nullifier + membership |
| Double-spend / replay prevention | Per-loan **nullifier** in a Merkle Patricia Forestry set; the same collateral cannot fund two loans. | MPF nullifier set |

---

## 3. The honest privacy boundary (Cardano L1 limits)

We state the limits plainly, because an overclaimed "fully private" property is both
untrue and, correctly, a reviewer red flag. On a transparent UTXO ledger, ZK hides
information *within a set*; it does not make a public ledger opaque. The following
are **known limitations**, not defects:

1. **Anonymity-set size.** Privacy scales with the number of participants sharing a
   denomination. On a young protocol the set is small, so the *practical* anonymity
   is thin even though the *mechanism* is sound. This improves monotonically with
   adoption; it is not a code fix.
2. **Value at the edges.** ADA entering (deposit) and leaving (loan payout, repay)
   the system is visible on-chain. Fixed denominations blur amounts *inside* the
   set, but "one unit in / one unit out" plus **timing correlation** can still link
   activity. Timing-analysis resistance is out of scope for M3.
3. **Fee-payer visibility.** The wallet that pays tx fees and provides the script
   collateral is visible. Sender-level anonymity requires a **relayer/third-party
   submitter** (as Tornado Cash uses); the M3 flow signs with the user's own wallet.
4. **eUTXO concurrency.** A stronger *shielded-pool* model (pooled value, per-user
   commitments — Zcash-style) is possible on Cardano but forces every deposit/withdraw
   to spend-and-recreate one shared pool UTXO, which serialises under the eUTXO
   contention model and typically reintroduces a batcher. It is held in reserve as
   the next privacy tier, not built for M3.

**Why L1 at all:** M1 §1.2 deliberately committed to Cardano L1 rather than the
Midnight privacy sidechain ("we clearly stated in our proposal that we will use
Cardano … we do think this is the reason why we got funded"). The privacy ceiling on
L1 is genuinely lower than on a purpose-built privacy chain; M3 targets the realistic
L1 ceiling and documents the boundary rather than overclaiming.

---

## 4. Summary for the reviewer

- The proof system pivoted PLONK→Groth16/BLS12-381 to get **real on-chain
  verification**, following the very reference implementation M1 cited. Objectives
  and guarantees are unchanged.
- Privacy delivered: **membership-based unlinkability + nullifiers + fixed-denomination
  amount hiding** — i.e. the M1 §2.1 guarantees, implemented, not reworded.
- Privacy *not* delivered on L1: large-set anonymity out of the box, edge/timing
  unlinkability, relayer-level sender anonymity, and a full shielded pool. These are
  the honest boundary and the future-work roadmap.
