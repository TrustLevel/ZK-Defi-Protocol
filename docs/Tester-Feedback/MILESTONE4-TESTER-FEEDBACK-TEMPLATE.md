# Milestone 4 — Independent Tester Feedback

**Purpose:** Independent testers use the web app for one full private loan cycle and report
what worked, what was unclear and what they missed. The milestone claims: *a simple web UI
lets users request loans, verify collateral and repay with zk-SNARK proofs, privately,
with understandable documentation and tooltips.* Your answers also decide the protocol
update that follows the test (Part F).

**How to use:** Copy this file to `MILESTONE4-TESTER-FEEDBACK-<yourname>.md`, fill every
section, and return it. You need a browser wallet and about 55 test ADA. Read
[docs/m4/user-guide.md](../m4/user-guide.md) first, or try without it and tell us where you
got stuck (both are useful).

**App:** <https://lending.trustlevel.io> (Cardano Preprod, test ADA only)

---

## Tester
- Name / handle:
- Background (dev / cardano / zk / non-technical):
- Date (YYYY-MM-DD):
- Time spent:
- Wallet and browser (e.g. Eternl, Chrome 131):
- Did you read the user guide before starting? (Y/N):

---

## Part A — Setup (~10 min)

Two accounts in your wallet, each funded **separately** from the
[Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet): account A about
45 test ADA, account B about 10 test ADA.

- Setting up two accounts was (1=hard … 5=easy):
- Was it clear **why** the app wants two accounts? (Y/N):
- **A. Notes:**

---

## Part B — One full cycle in the UI (~20 min)

Run lock collateral (A), borrow (to B), repay (B), unlock. Each step's progress list links the
transaction on cardanoscan; copy the hash.

| Step | Tx hash | Worked first time? (Y/N) | Proof time shown | Notes |
|---|---|---|---|---|
| Lock collateral | | | | |
| Borrow (relayer) | | | n/a | |
| Repay | | | | |
| Unlock (relayer) | | | n/a | |

- Did you always know **which account** to use for the next step? (Y/N):
- Did any step fail or confuse you? What did the screen say?
- **B. Notes:**

---

## Part C — Privacy check (~15 min)

1. **Pool tab:** can you tell which square of the anonymity set is your collateral? (Y/N):
2. **Borrow transaction on cardanoscan:** which addresses are inputs? Does account A appear
   anywhere? (list):
3. **Unlock transaction on cardanoscan:** where did the 20 ADA go? Can you see which repayment
   it belongs to? (Y/N + why):
4. **Two lenses:** did "What the chain sees" match what cardanoscan showed? (Y/N + differences):
5. Try one step from the "wrong" account (for example: repay from account A, or send the loan to
   A). Did the app warn you before you signed? (Y/N, you can cancel before signing):
6. In your own words: what can an observer learn about you from this cycle, and what not?

- Privacy design understandable (1=unclear … 5=very clear):
- **C. Notes:**

---

## Part D — Recovering a position (~5 min)

Start a new position and lock its collateral (or use one that is not unlocked yet). Then open the app in a
private window or another browser and **Import note**.

- Did the imported position show the right step? (Y/N):
- Was it clear that losing the note means losing the collateral? (Y/N):
- **D. Notes:**

---

## Part E — Lending: buy and withdraw a share (~15 min)

Lend tab. Buy one share from **account A**, then withdraw it to **account B** (see "Lending" in
the user guide). If a loan was repaid in between, the share price has gone up.

| Step | Tx hash | Worked first time? (Y/N) | Price / amount shown | Notes |
|---|---|---|---|---|
| Buy share (A) | | | | |
| Withdraw (relayer → B) | | | | |

- **Withdraw transaction on cardanoscan:** does account A appear anywhere? Can you tell which
  purchase it belongs to? (Y/N + why):
- Was it clear what a share is and how its price grows? (1=unclear … 5=very clear):
- Was it clear when a share can be withdrawn (free liquidity)? (Y/N):
- **E. Notes:**

---

## Part F — Tooltips and documentation (~10 min)

Hover or tap the underlined words. Rate how clear each explanation is (1=unclear … 5=clear):

| Term | Clarity | Comment |
|---|---|---|
| Collateral (vs. liquidity) | | |
| Share / share price | | |
| Note | | |
| Commitment | | |
| Anonymity set | | |
| Loan nullifier | | |
| Repayment marker | | |
| Fixed amounts | | |
| Relayer | | |
| Account A / Account B | | |
| Script collateral (if you saw it) | | |
| Proof | | |

- User guide (`docs/m4/user-guide.md`) clarity (1=unclear … 5=very clear):
- Footer "usage counts": did what your browser sent match what the app says it counts? (Y/N):
- Terms or steps that need an explanation and have none:
- **F. Notes:**

---

## Part G — What did you expect and could not do?

Everything you list here goes into the protocol update list.

- Was there anything you wanted to do and could not? (free text):
- Collateral comes back only through borrow → repay → unlock. Taking it back without a loan
  works by borrowing and repaying right away (costs the 0.5 ADA interest). Is that acceptable,
  or would you want a direct way? (1=fine as is … 5=need a direct way):
- Anything else you would change first?

---

## Part H — Assessment

- Could you take a private loan and repay it **without revealing which collateral backed it**?
  (Y/N + why):
- Could you lend and withdraw **without the withdrawal pointing back to your purchase**? (Y/N + why):
- Overall ease of use (1=hard … 5=easy):
- Proof times acceptable? (Y/N):
- Issues / bugs found:
- Suggestions:

### Overall verdict
- [ ] Pass
- [ ] Pass with notes (list above)
- [ ] Fail (explain)

**Signature / handle + date:**
