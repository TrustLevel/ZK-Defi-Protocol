# M3 Tester Runbook 2 — Break it (pumbiii)

**Your role:** try to **break** the protocol. Do the setup from Runbook 1 (§B) first
(clone, `git checkout m3-poa-v3`, `aiken check`, `npm install`, funded Preprod wallet
in `.env`). Then run each attack below and record whether the protocol **correctly
rejected** it. For this runbook, **"attack rejected" = PASS** (the protocol held).
Return as `MILESTONE3-TESTER-FEEDBACK-<yourname>.md`.

**Tester:** name/handle · background · date · time spent:

---

## Part A — The adversarial test suite (in the code)

`cd contracts && aiken check`. Confirm these negative tests are present and pass
(each proves an attack fails *closed*):

| Test | What it proves | Present & passing? |
|---|---|---|
| `unlock_blocked_while_loan_open_fails` | can't unlock while the loan is outstanding | |
| `borrow_reused_nullifier_fails` | can't take a 2nd loan on the same collateral | |
| `repay_below_interest_fails` | can't repay less than principal + interest | |
| `unlock_wrong_commitment_fails` | can't unlock a deposit you don't own | |
| `tampered_borrow_signal_fails_onchain` / `tampered_unlock_signal_fails_onchain` | a tampered proof is rejected | |

Total checks reported by `aiken check`: ____ (expect 13, 0 failed).

---

## Part B — Live attacks on Preprod (the important part)

Run a normal flow up to **borrow** (`1-park … 4-borrow`, waiting for each). Then:

### Attack 1 — Unlock without repaying (the exact finding that failed last time)
Skip repay. Run `node cli/v5/6-unlock.mjs` **while the loan is still open**.
- Expected: **submission is REJECTED** by the validator (the loan nullifier is still in
  `open_loans`; the script prints `settled? false`).
- Result: attack rejected? (Y = PASS / N = FAIL): ____  · error/tx you saw:

### Attack 2 — Repay less than owed
Edit `5-repay.mjs` so `repay` = principal only (drop the interest), or a smaller number.
Run it.
- Expected: **rejected** (validator requires `repay_amount ≥ principal + interest`).
- Result: rejected? ____ · notes:

### Attack 3 — Reuse the loan (double-borrow)
After a borrow, run `4-borrow.mjs` **again** with the same deposit (same secret).
- Expected: **rejected** (nullifier already in `open_loans`).
- Result: rejected? ____ · notes:

### Attack 4 — Unlock a deposit you don't own
Take any published deposit commitment you did **not** create, and try to unlock it
(you don't have its secret, so you can't generate a valid proof).
- Expected: you **cannot** produce a proof / the tx is **rejected**.
- Result: blocked? ____ · notes:

### Attack 5 — Tamper the config
Try to change the pool's `group_root`/`vkey_ref`/`collateral_ratio` in a borrow or repay
continuation datum (edit the `contDatum` in `4-borrow.mjs`/`5-repay.mjs`), or run
`3b-setgrouproot.mjs` **without** the admin key (different wallet).
- Expected: **rejected** (config is frozen except admin `SetGroupRoot`).
- Result: rejected? ____ · notes:

### Attack 6 — Free-form
Anything else you can think of (replay a proof in a different tx, wrong denomination
loan, spend the pool to yourself, etc.). Describe what you tried and what happened:

---

## Part C — Reviewer-finding checklist

For each finding from the previous Catalyst review, confirm it's addressed:

- [ ] Borrower **cannot** unlock collateral without fully repaying (Attack 1)
- [ ] **Interest** is charged and enforced (Attack 2; repay = principal + interest)
- [ ] The verification key **cannot** be swapped by the spender (it's read from the pool datum, pinned to an unspendable UTxO)
- [ ] Datum/config fields **cannot** be rewritten on a spend (Attack 5)
- [ ] Loan **amounts** carry no per-loan info (fixed denomination); collateral amount is not in the datum (private witness) though the locked UTxO value is public
- [ ] Borrow does **not** reveal which deposit it is (no collateral reference)
- [ ] Adversarial **validator tests** exist and pass (Part A)
- [ ] Evidence is on an **immutable tag** (`m3-poa-v3`), not `main`

---

## Part D — Verdict

- Did any attack **succeed** (i.e. the protocol let you cheat)? If yes, describe exactly — this is the most valuable thing you can report.
- Overall: how hard was it to break? (1 = trivial … 5 = couldn't)
- Weakest spot you found (even if you couldn't fully exploit it):
- Honesty check: do the documented privacy limits in `docs/MILESTONE3.md` §5 match what you actually observe on-chain? (Y/N + notes)
