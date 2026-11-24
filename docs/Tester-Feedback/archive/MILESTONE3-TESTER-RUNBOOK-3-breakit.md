# M3 Tester Runbook 3 — Break it (pumbiii)

> **Archived runbook.** Break-it runbook for the stand tagged `m3-poa-v4`/`m3-poa-v5`. It is the runbook pumbiii followed for [`../MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md`](../MILESTONE3-TESTER-FEEDBACK-pumbiii-2026-11-18.md) (2026-11-18). The command line client it uses (`offchain/cli/v5/`) is part of those tags.

**Your role:** try to **break** the protocol, on your **own** pool with your **own**
wallet. Run each attack below and record whether the protocol **correctly rejected**
it. For this runbook, **"attack rejected" = PASS** (the protocol held).
Return your report as `MILESTONE3-TESTER-FEEDBACK-<yourname>-<date>.md`.

**Tester:** name/handle · background · date · time spent:

**How rejections show up.** The CLI (Mesh) evaluates every transaction against the
validators on Preprod (via Blockfrost) **before** it submits. A transaction the
validator rejects therefore fails at build time with `Tx evaluation failed` and is
**never submitted**. That counts as **rejected by the validator**. Some attacks are
already stopped earlier because no valid proof can be generated; that also counts as
PASS (note which one you saw).

---

## Part 0 — Setup (~20 min)

```bash
git clone <repo> && cd ZK-Defi-Protocol
git checkout m3-poa-v5
cd contracts && aiken check          # aiken v1.1.19 — expect 54 tests, 0 failed
cd ../offchain && npm install
cp ../.env.example ../.env           # Blockfrost Preprod key + YOUR wallet mnemonic
```

Your wallet needs ~150 tADA and **at least three pure-ADA UTxOs of ≥ 5 ADA** (the
init tx spends one as the pool-NFT seed and posts another as collateral). Split UTxOs
with a self-payment first if necessary.

**Baseline cycle** (run from `offchain/`, and after each step run
`node cli/v5/wait.mjs <txHash>`):

```bash
node cli/v5/1-park-vkey.mjs    # four vkeys on an always-false address
node cli/v5/2-init-pool.mjs    # your own pool + its one-shot NFT
node cli/v5/3-deposit.mjs      # 20 ADA collateral through the pool
node cli/v5/4-borrow.mjs       # 10 ADA loan (ZK proof verified on-chain)
node cli/v5/5-repay.mjs        # exactly 10.5 ADA
node cli/v5/6-unlock.mjs       # 20 ADA back to unlock_to
```

| Step | Tx hash | valid_contract |
|---|---|---|
| Park VKeys | | |
| Init + mint | | |
| Deposit | | |
| Borrow | | |
| Repay | | |
| Unlock | | |

Receipts are in `offchain/cli/v5/receipts/`. For a fresh cycle (needed by some
attacks), run `2-init-pool` again: it creates a new pool with a new NFT.

---

## Part A — The adversarial test suite (in the code)

`cd contracts && aiken check`. Confirm these negative tests are present and pass. Each
one proves an attack fails *closed* with real proofs:

| Test | What it proves | Present & passing? |
|---|---|---|
| `unlock_without_repay_fails` | no unlock before the loan is repaid | |
| `borrow_after_repay_same_secret_fails` | a repaid deposit cannot borrow again | |
| `unlock_via_forged_pool_ref_fails` | a UTxO paid to the pool address cannot supply a fake `repaid_root` | |
| `spend_pool_without_nft_fails` | a UTxO without the pool NFT is not the pool | |
| `borrow_payout_to_other_key_fails` / `unlock_to_other_address_fails` | a copied proof cannot redirect funds | |
| `deposit_collateral_wrong_amount_fails` | collateral must be exactly the denomination | |
| `group_root_change_without_append_fails` | nobody can rewrite the commitment set | |
| `repay_below_interest_fails` / `repay_overpay_fails` | repay is exactly principal + interest | |
| `tampered_borrow_signal_fails_onchain` / `tampered_recipient_signal_fails_onchain` | a tampered proof is rejected | |
| `repay_with_foreign_repay_nullifier_fails` / `repay_with_copied_borrow_proof_fails` | a repay can only append the `R` of the loan it settles; a borrow proof is not a repay proof | |

Total reported by `aiken check`: ____ (expect 54, 0 failed).

---

## Part B — Live attacks on Preprod (the important part)

Edit the step scripts in `offchain/cli/v5/` as described, run them, then **revert
your edit** (`git checkout -- offchain/cli/v5`) before the next attack.

### Attack 1 — Unlock without repaying
Fresh cycle up to `4-borrow`. Skip repay and run `6-unlock.mjs`.
- Expected: blocked. `R` is not in `repaid_root`, so no settlement proof exists (the
  script stops at proof generation / root check). If you force a proof against a
  different root, the validator rejects it.
- Result: blocked? ____ · what you saw:

### Attack 2 — Repay a different amount
In `5-repay.mjs` change `const repay = principal + interest;` to `principal` (too little)
and, in a second run, to `principal + interest + 1_000_000` (too much).
- Expected: both **rejected** (repay must be exactly principal + interest).
- Result: rejected (under / over)? ____ / ____

### Attack 3 — Second loan on the same deposit
After a full baseline cycle (repay **and** unlock done), the deposit's commitment is
still in `group_root`. In `4-borrow.mjs` delete the local guard line
`if ((pool.used_nullifiers || []).includes(...)) throw ...` and run it.
- Expected: **rejected** (the nullifier is in `used_nullifiers`). This would otherwise
  be a loan with no collateral behind it.
- Result: rejected? ____

### Attack 4 — Redirect a loan (front-running)
Fresh cycle up to `3-deposit`. In `4-borrow.mjs`:
- (a) keep the proof, but pay the loan output to another address you control
  (change `.txOut(recipientAddr, …)` to `.txOut("<other addr>", …)`), and
- (b) in a second run, also put that other address's key hash into the redeemer
  (`R_Borrow(…, paymentKeyHash("<other addr>"))`) while keeping the proof made for your key.
- Expected: both **rejected** (the loan must go to the key the proof is bound to; a
  re-targeted proof does not verify).
- Result: rejected (a / b)? ____ / ____

### Attack 5 — Redirect an unlock (front-running)
Fresh cycle up to `5-repay`. In `6-unlock.mjs` change
`.txOut(deposit.unlockTo, …)` to another address.
- Expected: **rejected** (the collateral must go to the deposit's `unlock_to`).
- Result: rejected? ____

### Attack 6 — Forged pool reference
Fresh cycle up to `4-borrow` (loan open, not repaid).
1. Pay a small UTxO **to the pool script address** (no validator runs on a payment)
   with an inline datum copied from the pool, but with `repaid_root` set to a root
   that contains your `R`: in a scratch script use
   `poolDatumFrom(pool, { repaid_root: merkleRoot([computeRepayNullifier(secret)]), next_index: 1 })`.
2. In `6-unlock.mjs`, use that UTxO instead of `fetchPool(...)` as the pool reference,
   and `[R]` as `repaidNullifiers` with index `0` (there is no `repay.json` yet).
- Expected: **rejected** (the pool reference must carry the pool NFT).
- Result: rejected? ____

### Attack 7 — Spend a fake pool
Using the forged UTxO from Attack 6, try to spend it **as the pool** in
`4-borrow.mjs` (replace `poolUtxo` with it).
- Expected: **rejected** (only the UTxO holding the pool NFT is the pool).
- Result: rejected? ____

### Attack 8 — Under-collateralized deposit
In `3-deposit.mjs` lock 19 ADA instead of `COLLATERAL_DENOMINATION` in the collateral
output.
- Expected: **rejected** (a deposit must be exactly the denomination).
- Result: rejected? ____

### Attack 9 — Repay with a foreign R (own deposits and third party)
- (a) Two own deposits B and C, both borrowed. Repay loan B, but append C's `R`
  (`computeRepayNullifier(secretC)`) with a matching append proof; then try to unlock C.
- (b) From a second wallet with **no deposit**: take a victim's open loan, build
  `RepayAnonymous` with the victim's **borrow** proof (public in the borrow tx's
  redeemer), pay 10.5 ADA and append a random `R`.
- (c) Same as (b), but with a valid **repay** proof for the victim's loan and a random
  `R` in the redeemer.
- Expected: all **rejected**. The repay proof derives the loan nullifier and `R` from
  one secret, and a borrow proof is not a repay proof (own vkey). Run the honest
  `5-repay.mjs` on the same state as control: it must succeed.
- Result: rejected (a / b / c)? ____ / ____ / ____ · control ok? ____

### Attack 10 — Free-form
Anything else: replay a proof in another tx, spend two deposits with one payout,
move the NFT, change a frozen datum field, deposit directly to the collateral address
and try to borrow against it, … Describe what you tried and what happened:

---

## Part C — Checklist

- [ ] Collateral **cannot** be unlocked before **its own** loan is fully repaid (Attacks 1, 9a)
- [ ] Nobody can repay someone else's loan in a way that locks their collateral (Attack 9b, 9c)
- [ ] **Interest** is charged and the repayment is a fixed amount (Attack 2)
- [ ] A deposit backs **exactly one** loan, so no loan without collateral (Attack 3)
- [ ] Copied proofs **cannot** redirect a loan or collateral (Attacks 4, 5)
- [ ] The pool is recognised by its **NFT**; a forged or fake pool is rejected (Attacks 6, 7)
- [ ] The verification keys **cannot** be swapped (fixed by script parameters)
- [ ] Collateral is exactly the denomination; the commitment set grows **only** from real deposits; there is **no admin** (Attack 8, Part A)
- [ ] Loan and repay amounts carry no per-loan info; the collateral amount is not in the datum (the locked UTxO value is public)
- [ ] Borrow does **not** reveal which deposit backs it (no collateral reference)
- [ ] Adversarial **validator tests** exist and pass (Part A)
- [ ] Evidence is on an **immutable tag** (`m3-poa-v5`), not `main`

---

## Part D — Verdict

- Did any attack **succeed** (the protocol let you cheat)? If yes, describe exactly; this is the most valuable thing you can report.
- Overall: how hard was it to break? (1 = trivial … 5 = couldn't)
- Weakest spot you found (even if you couldn't fully exploit it):
- Honesty check: do the documented limits in `docs/MILESTONE3.md` §5 match what you actually observe on-chain? (Y/N + notes)
