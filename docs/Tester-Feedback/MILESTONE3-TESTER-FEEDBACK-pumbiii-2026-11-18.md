# M3 Tester Feedback — Break it (pumbiii) · Runbook 3

**Tester:** pumbiii.
**Background:** adversarial review of Cardano validators and ZK circuits
**Date:** 2026-11-18 
**Target:** tag `m3-poa-v4` (`9e9518f`), fresh local clone, own pool, own wallet (account 0, payment key hash `55cca2f4…`). A second identity, account 1 (key hash `6281394e…`), served as the "other address" and as the third-party attacker.
**Grading rule:** *attack rejected = PASS* (the protocol held).

**Summary.** Attacks 1–8 from the runbook were all **rejected** by the validators. The free-form Attack 9 found a real gap: **the repayment nullifier `R` that a Repay inserts into `repaid_root` is not bound to the loan being repaid.** I exploited it live in two ways:

- **9a (swap):** Repaying loan B while inserting deposit C's `R` unlocks C's collateral **while loan C is still open**.
- **9b (third-party hijack, permanent loss):** A party with **no deposit** copied the victim's borrow proof from the chain, "repaid" the victim's loan with a random `R`, and left the victim's collateral **locked forever**.

---

## Part 0 — Setup

- `aiken v1.1.19`, Node v23.6.0, fresh clone at `m3-poa-v4`, `npm install` clean.
- Wallet: ~9,822 tADA in 7 UTxOs. That is enough pure-ADA UTxOs, so no split was needed.
- Pool (this run): policy `d9dcca86fdf2ca927ae6bf3dc4f5c8e81804700f4a9bf4d7b1cfa6a1`, pool script `02f45ec74ea8919ce0be9870170d7ffe436b69425ee9de2326336ec8`, collateral script `7ea647dac4c37c262fdb5d3ba55e3b377862ba3000001e600da61844`.

**Baseline cycle.** Every transaction in this report was checked through Blockfrost and returned `valid_contract = true`.

| Step | Tx hash | valid_contract |
|---|---|---|
| Park VKeys | `950948812ba2caff14412e56b7803737383dde754573d15b629dcef6321a48e7` | true |
| Init + mint | `f95ddf4c8e80d78aa57f32f09c845e3db33dbf4dfb8201e696b7aa9e311518ba` | true |
| Deposit | `304adbdef86cbbb69aaf5457a818c93dace9f0c93f92884f38822804a9718604` | true |
| Borrow | `861aec80d4012582d7c4df85dc662dadf51f7e009ae88cea5268438287734357` | true |
| Repay | `052afe565cf55c3a4b77700576f699cfa8ba14db76d6987a814e2b23b1d8a0a9` | true |
| Unlock | `00546a0236009a2f53b84f1b20aa212aa612238c1c1e1d4f02991ceb94599b17` | true |

**Method.** I ran attacks 1–8 inside this one cycle, at the stage each one needs:
- before borrow: 8, 4
- loan open: 1, 2, 6, 7
- repaid, not yet unlocked: 5
- after unlock: 3

Each attack is a copy of the step script with a minimal diff. The script files are in `pumbiii-runbook3-scripts/` next to this report. The originals were never edited.

**About traces.** Blockfrost's Ogmios returns `EvaluationFailure: { ScriptFailures: {} }` with no trace. A rejection therefore shows only *that* the validator failed, not *which* check failed. To attribute each rejection to the diff, the honest script ran directly before or after each attack on the same state and succeeded. Examples: the 20 ADA deposit after Attack 8, and the honest borrow after Attack 4.

---

## Part A — Adversarial test suite

`cd contracts && aiken check` reported **49 tests, 49 passed, 0 failed**.

| Test | Present & passing? |
|---|:--:|
| `unlock_without_repay_fails` | ✅ |
| `borrow_after_repay_same_secret_fails` | ✅ |
| `unlock_via_forged_pool_ref_fails` | ✅ |
| `spend_pool_without_nft_fails` | ✅ |
| `borrow_payout_to_other_key_fails` / `unlock_to_other_address_fails` | ✅ / ✅ |
| `deposit_collateral_wrong_amount_fails` | ✅ |
| `group_root_change_without_append_fails` | ✅ |
| `repay_below_interest_fails` / `repay_overpay_fails` | ✅ / ✅ |
| `tampered_borrow_signal_fails_onchain` / `tampered_recipient_signal_fails_onchain` | ✅ / ✅ |

Total: **49** (expected 49, 0 failed).

**Missing:** there is no test where a Repay appends an `R` that does not belong to the loan being repaid (see Attack 9).

---

## Part B — Live attacks on Preprod

### Attack 1 — Unlock without repaying → **PASS (rejected)**
- **1a**, unmodified `6-unlock.mjs` while the loan is open: the script stops locally because `repay.json` does not exist. No proof is possible.
- **1b**, forced: I built a settlement proof against a self-made root `merkleRoot([R])` and used the **real** pool as reference. The proof generated and verified off-chain, but the validator **rejected** it with `Tx evaluation failed`. The proof's `repaid_root` is not the pool's root.

### Attack 2 — Repay a different amount → **PASS (rejected / rejected)**
- Under-payment (`repay = principal`, 10 ADA) was **rejected**.
- Over-payment (`principal + interest + 1 ADA`, 11.5 ADA) was **rejected**.
- Extra variant 2c: the redeemer states the correct 10.5 ADA, but only 10 ADA is paid into the pool. This was also **rejected**.

### Attack 3 — Second loan on the same deposit → **PASS (rejected)**
After the full baseline cycle I removed the local `used_nullifiers` guard. The membership proof still generates, because the commitment remains in `group_root`, but the validator **rejected** the transaction.

### Attack 4 — Redirect a loan → **PASS (rejected / rejected)**
- (a) The loan output went to account 1 while the redeemer and proof stayed for account 0. **Rejected.**
- (b) Account 1's key hash was also put in the redeemer, still with the proof made for account 0. **Rejected.**
- Control: the honest borrow on the same state succeeded right after (`861aec80…`).

### Attack 5 — Redirect an unlock → **PASS (rejected)**
After the repay, the unlock output went to account 1 instead of `unlock_to`. The settlement proof was valid, but the validator **rejected** the transaction. The honest unlock succeeded right after (`00546a02…`).

### Attack 6 — Forged pool reference → **PASS (rejected)**
I paid a 15 ADA UTxO to the pool script address (`8c35f355a00579706152e712c22e87c79ae4768efd0f88c3f1823e77d52d3326#0`). Its inline datum is copied from the pool, with these changes:
- `repaid_root = merkleRoot([R])`
- `next_index = 1`
- empty `open_loans` and `used_nullifiers`

The unlock used this UTxO as the pool reference with `[R]` at index 0. The settlement proof was valid against the forged root, but the validator **rejected** the transaction because the reference input carries no pool NFT.

### Attack 7 — Spend a fake pool → **PASS (rejected)**
I used the same forged UTxO as the pool input to `4-borrow`, with a continuing output without the NFT (I don't own it). Its empty nullifier lists mean only the missing NFT can make it fail. The membership proof was valid against the forged datum's `group_root`, but the validator **rejected** the transaction. The 15 ADA stay locked at the pool address, which is expected: no NFT, so the UTxO is not spendable.

### Attack 8 — Under-collateralized deposit → **PASS (rejected)**
Locking 19 ADA instead of 20 was **rejected**. Control: the 20 ADA deposit on the same pool state succeeded immediately after (`304adbde…`).

### Attack 9 — Free-form → **FAIL: two live exploits**

**Root cause.** In `RepayAnonymous` (`contracts/validators/v5/lending_pool_v5.ak:167-217`) the validator checks two proofs that are independent of each other:

1. The **membership proof** attests `loan_nullifier` for some secret in `group_root`.
2. The **append proof** attests that `repay_nullifier` was appended to `repaid_root`.

Nothing proves that `repay_nullifier = Poseidon(secret, 8888)` for the **same** secret as `loan_nullifier`. The source comment says "A bogus R only harms the repayer". That is only true if the repayer is the borrower. And the membership proof is not bound to the repayer: it uses the same circuit and the same public signals as the **borrow** proof, which is public in the borrow transaction's redeemer.

#### 9a — R swap: unlock a deposit whose loan is still open (own deposits)

| Step | Tx hash | valid_contract |
|---|---|---|
| Deposit B (index 1) | `b1cadee697d12ffa604b9aed9c1a82b3d5bfef8e8678b01c2a40a85fce987e49` | true |
| Borrow on B | `730d9d4e4feabdbeb0a196e8101cf09054b42f54ae42c5b114a0f7896604bc09` | true |
| Deposit C (index 2) | `52db2fef878dcd2a5092b65a50601797b711885a69123c67d41af40f63fbc70e` | true |
| Borrow on C | `371faff988d5a1198dc7628cb1ba5723b8bab3b9b0d576c25c388bf7dd275e32` | true |
| **Repay loan B, appending R_C** | `1031b80d0a5be2ff29387f92855bbc9624717f310a0a181d08de6f701146ca4b` | **true** |
| **Unlock C with unmodified `6-unlock.mjs`** | `39a41fd4539911334ec20cb2b8d5d5df9ce9f85867308cd71e1c08d59a34e2a6` | **true** |

On-chain pool datum after the unlock, decoded from the inline CBOR:
- **loan C open: true**, loan B open: false, `total_borrowed = 10 ADA`
- collateral C: **released**
- collateral B: still locked, even though loan B is paid

Cleanup: repay loan C appending R_B (`f3ac36d9…`), then unlock B (`522c61c2…`). Afterwards the pool is consistent: `open_loans = []`, balance 101.5 = 100 + 3 × 0.5 interest.

**Impact.** Collateral is **not tied to its own loan**. The checklist claim "collateral cannot be unlocked before *the* loan is repaid" fails per deposit. On its own, the attacker gains nothing: every unlock still needs one paid repay. But it enables 9b.

#### 9b — Third-party repay hijack: permanent loss of a victim's collateral

The attacker is pumbiii account 1. It holds **no deposit** and uses **only public chain data**:

1. It reads the victim's borrow redeemer from the transaction that created the current pool UTxO (`/txs/{hash}/redeemers`): the proof, `loan_nullifier` and recipient.
2. It rebuilds the repaid set from all public Repay redeemers (field 4 = `R`). The result matches the on-chain `repaid_root`.
3. It submits `RepayAnonymous` with the **copied borrow proof**, pays 10.5 ADA, and appends a **random R**.

| Step | Tx hash | valid_contract |
|---|---|---|
| Fund attacker (2 × 15 ADA) | `454c9e483a3720fd5f7a35117f089b5de6754928b11951343327b0fb6c88a39a` | true |
| Victim deposit (index 3) | `84cec0c727ec02d8124eb01f905463d5115cbde25c97ba7c569d87fbe382aef0` | true |
| Victim borrow | `3239f4c14369b984c8e6e8afe4f86ba0f72c744aff0fa54ddcdf07656a6e3c59` | true |
| **Attacker "repays" victim's loan with junk R** | `aad0803b7938cd537ad3c3cc3a701275f65ac6d52228a6f9da0423717acd8ab8` | **true** |

What the victim can still do afterwards:
- **Honest `5-repay.mjs`:** rejected by the validator. The loan is no longer in `open_loans`.
- **`6-unlock.mjs`:** impossible. The victim's `R` is not in `repaid_root`, and the settlement circuit fails with `Assert Failed … SettlementProof line 104`.
- **On-chain state:** victim loan open = false, victim nullifier used = true, collateral `84cec0c7…#1` **still locked**. No path remains (no admin, no second repay), so the 20 ADA are **permanently locked**.

**Preconditions and cost:**
- The copied borrow proof is only valid while `group_root` is unchanged since the victim's borrow, i.e. no deposit in between.
- Independently of that, **any** honest Repay can be front-run from the mempool: copy its membership proof, swap in your own `R` and append proof, and pay.
- Cost to the attacker: 10.5 ADA. *Derived, not run live:* if the attacker appends the `R` of their **own** deposit with an open loan instead of a junk `R`, they also free their own collateral. Their net cost is then ≈ 0.5 ADA, and they keep an open loan backed by no collateral.

**Suggested fix:** make the Repay proof attest `R` from the same secret.
- Use a repay circuit whose public signals include `repay_nullifier`, with `R = Poseidon(secret, repay_ext)` from the same `secret` as `loan_nullifier` and membership.
- Domain-separate it from the borrow circuit, for example with a different external nullifier or a separate vkey, so a borrow proof is never a valid repay proof.
- A copied Repay then just pays the victim's loan with the victim's own `R`, which is harmless.
- Add the negative test `repay_with_foreign_repay_nullifier_fails`.

**Other free-form observations (no exploit):**
- Two deposits with the same secret share one commitment, nullifier and `R`. One loan and one repay would then unlock both. That concerns only the depositor's own money. Not run live.
- Operational note: twice, a pool transaction submitted directly after `wait.mjs` reported confirmation failed evaluation with `extraRedeemers: spend:N`. The Blockfrost evaluator lags behind the address index. Waiting ~30 s fixed it. `wait.mjs` could also wait for the evaluator, or the steps could retry.

---

## Part C — Checklist

- [ ] Collateral **cannot** be unlocked before the loan is fully repaid (Attack 1): **partly.** Attack 1 holds, but per deposit it fails (9a: collateral C was released while loan C was open).
- [x] **Interest** is charged and the repayment is a fixed amount (Attack 2)
- [ ] A deposit backs **exactly one** loan, so no loan without collateral (Attack 3): **partly.** One loan per nullifier holds (Attack 3), but 9a leaves a loan open with its collateral gone.
- [ ] Copied proofs **cannot** redirect a loan or collateral (Attacks 4, 5): **partly.** Payouts hold (4, 5), but a copied proof **can** be redirected into a Repay that destroys the victim's unlock (9b).
- [x] The pool is recognised by its **NFT**; a forged or fake pool is rejected (Attacks 6, 7)
- [x] The verification keys **cannot** be swapped (fixed by script parameters; `*_with_vkey_at_other_ref_fails` tests pass)
- [x] Collateral is exactly the denomination; the commitment set grows **only** from real deposits; there is **no admin** (Attack 8, Part A)
- [x] Loan and repay amounts carry no per-loan info; the collateral amount is not in the datum
- [x] Borrow does **not** reveal which deposit backs it (no collateral reference)
- [x] Adversarial **validator tests** exist and pass (Part A). A test for 9 is missing.
- [x] Evidence is on an **immutable tag** (`m3-poa-v4`)

---

## Part D — Verdict

- **Did any attack succeed?** **Yes: 9b.** A third party with no deposit can permanently lock any borrower's collateral by repaying that borrower's loan with a foreign `R`. Built from public chain data, run live on Preprod (`aad0803b…`). 9a (R swap) is the same root cause between one user's own deposits.
- **How hard to break (1–5):** **3.** The runbook attacks (1–8) are solid, and the NFT, payout binding and amount checks all held. The flaw lies in the binding between the two Repay proofs, not in any single check.
- **Weakest spot:** `RepayAnonymous`. `repay_nullifier` is not tied to the loan's secret, and the membership proof is not bound to the repayer. It is even identical to the public borrow proof.
- **Honesty check (`docs/MILESTONE3.md` §5): N, with one gap.**
  - The non-goals (no liquidation, denominations, capacity, no withdrawal without a loan) match what I observed.
  - "The only way R enters repaid_root is a valid repayment" is literally true. But **which** `R` enters is not tied to **which** loan was repaid, so "settlement-gated unlock" holds per pool, not per deposit.
  - "Owner-bound payouts … proofs cannot be front-run" holds for loan and unlock payouts, but not for Repay (9b).
