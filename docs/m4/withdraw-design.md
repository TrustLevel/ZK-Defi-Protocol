# Withdraw paths: design draft

<!-- DRAFT for the protocol update after the M4 test round. Not committed. -->

Two different kinds of money: **collateral** (a borrower's own 20 ADA, securing their own loan,
in its own contract) and **liquidity** (lenders' ADA in the pool, from which loans are paid).
The protocol update covers the **lender side** (§2): lenders get their liquidity and the
interest it earned back, as privately as borrowers borrow. §1 is parked (see there).

---

## 1. Take back collateral that never backed a loan (parked)

> **Parked.** Collateral that never backed a loan is already reachable through borrow →
> immediate repay → unlock (cost: 0.5 ADA interest). The design below is kept for reference;
> it is not part of the protocol update.

### What must hold

1. The caller knows the secret behind **this** collateral's commitment.
2. **No loan was taken against it:** its loan nullifier `N = Poseidon255(secret, 7777)` is not
   in `used_nullifiers`.
3. **No loan can be taken against it afterwards.** This is the critical point: the commitment
   stays in `group_root` (the tree is append-only), so after the collateral is gone a borrow
   proof against it would still verify. The withdraw therefore has to **spend `N`**: add it to
   `used_nullifiers`, exactly as a borrow does. A later borrow with this secret then fails the
   "fresh nullifier" check.
4. The collateral goes to its own `unlock_to` (account A, fixed when it was locked), in an output
   tagged with the collateral UTxO's reference (as in unlock), so a copied proof cannot redirect
   it and one output cannot settle two collaterals.

### What it reveals

| Public in the withdraw | Links to | Assessment |
|---|---|---|
| The spent collateral (commitment, `unlock_to`) | its own lock | same as unlock: spending a collateral UTxO is linked to it by design |
| `N` | nothing | `N` was never public before (no borrow) and can never appear later (it is now used), so it matches no loan |
| That this collateral never backed a loan | the collateral | new information, but only about this collateral, which is leaving |

Effect on everyone else: the withdrawn leaf stays in the tree but is publicly known to be out,
so the effective anonymity set for later borrows shrinks by one per withdraw. Observers still
cannot tell which of the remaining leaves have borrowed.

**Why not pay it to account B?** The withdraw spends one specific collateral UTxO, and account A
locked it, so "A's collateral was withdrawn" is visible either way. Paying it to B would add
"A and B belong together"; paying it back to A reveals nothing new. (Borrow is different: there
nobody knows which collateral backs the loan, so the second account protects something.)

Rejected alternative: authorize the withdraw by the `unlock_to` key's signature. It cannot show
that no loan exists, so a borrower could take the loan and then withdraw the collateral.

### Changes

| Layer | Change |
|---|---|
| Circuit | New `withdraw_proof.circom`, small (no Merkle path): public `[commitment, loan_nullifier, external_nullifier]`, private `secret, collateral_amount`; checks `commitment = Poseidon255(amount, secret)` and `N = Poseidon255(secret, external_nullifier)`, range checks as in the other circuits. Phase-2 setup on the existing ptau, verification key parked on-chain like the others. |
| `collateral` validator | New redeemer `WithdrawDeposit { proof, loan_nullifier }`: verifies the withdraw proof against its own datum's commitment, requires the pool UTxO (with the NFT) to be **spent** in the same transaction under `WithdrawCollateral` with the same `N`, pays `unlock_to` with the tag. |
| `lending_pool` validator | New redeemer `WithdrawCollateral { loan_nullifier }`: `N ∉ used_nullifiers`, output datum `used_nullifiers = [N, ..old]`, everything else (roots, open loans, totals, value) unchanged; exactly one collateral input is spent. |
| Tests | Adversarial validator tests in the M3 style: withdraw after borrow (N used) fails; borrow after withdraw fails; proof for another collateral fails; payout to another address fails; two collaterals with one output fails; pool datum tampering fails. |
| Deployment | Validator hashes change, so a new pool (new NFT, addresses). The M4 pool holds no locked collateral today, so nothing has to migrate. |
| App | Relayer route `/api/relay/withdraw` (like unlock: no user wallet in the transaction), a "Take back 20 ADA" action on positions whose collateral is locked and never borrowed, lens "what the chain sees" for it, tooltip update, user guide. |

---

## 2. Lending: add liquidity and take it back, privately

The protocol claims anonymous lending *and* borrowing, so the lender side follows the same
model as the borrower side: putting money in is a visible payment, what happens afterwards is
not linkable to it.

### What stays hidden, what is visible

| Hidden | Visible |
|---|---|
| Which withdrawal belongs to which liquidity deposit | That account A added liquidity, and when |
| Where the withdrawal goes (a fresh account B, fees paid by the relayer) | Pool totals: liquidity, outstanding loans, number of shares |
| How long a lender stayed and how much interest they earned | That *some* lender withdrew, and when |

### Unit: one note = one pool share

Amounts must be uniform, otherwise they link deposit and withdrawal. A fixed ADA amount does not
work with interest: a unit held for a month would pay out more than one added yesterday, and the
payout would reveal the deposit time. So the fixed unit is a **share of the pool**, not an ADA
amount:

- Every lender note is exactly **one share**. Lending more means holding several notes.
- **Share price** = (pool lovelace − fixed reserve + `total_borrowed`) ÷ `total_shares`; with no
  shares outstanding the price is the start price of 10 ADA (one loan). Outstanding loans count
  as pool assets. Each repayment adds 0.5 ADA interest, which raises the price of every share
  at once.
- **Adding liquidity** pays the current price (rounded up, in the pool's favour). The amount only
  shows *when* the share was bought, which is public anyway.
- **Withdrawing** pays the current price (rounded down). Everyone who withdraws against the same
  pool state receives exactly the same amount, whenever they added liquidity, so the amount
  carries no information.

### Flow

1. **Add liquidity (account A).** The browser draws a secret for the note and computes its
   commitment. A pays the share price into the pool; an append proof inserts the commitment
   into a new **lender tree** (`lender_root`, `lender_next_index`) and `total_shares` grows by
   one. The note is backed up like a collateral note.
2. **Withdraw (to account B, via the relayer).** The browser proves in zero knowledge: "I know
   the secret of *some* leaf in the lender tree", reveals that leaf's withdrawal nullifier
   `W = Poseidon255(secret, lender_external_nullifier)`, and binds the proof to B's key. The
   pool checks `W` was never used, records it, pays the current share price to B (output tagged
   with `W`, as loans are tagged with the loan nullifier) and lowers `total_shares` by one. A
   copied proof cannot redirect the payout; the relayer pays the fees, so neither A nor B's
   wallet funds the transaction.
3. **Anonymity set:** all lender notes not yet withdrawn. The app shows its size and warns when
   it is small and when several notes are withdrawn close together (that links them to each
   other).

### Free liquidity

A withdrawal can only take what is actually in the pool. While loans are out, part of the pool
value is owed by borrowers; lenders then wait for repayments. The app shows "free now: X shares".
There is no queue: a queue would keep per-lender state that links a waiting position to the
later withdrawal.

### No loan deadlines (design decision)

Loans carry no deadline and are never written off. A deadline would put a timestamp on every
loan and a write-off would single out which loan defaulted; without them, all loans stay
indistinguishable. The consequence: a loan that is never repaid stays counted as a pool asset,
so its 10 ADA is missing for the lenders who withdraw last, while the borrower's 20 ADA
collateral stays locked. The borrower's incentive works against this: not repaying means losing
20 ADA to keep 10.

### Why no LP token

A transferable LP token in A's wallet would make the share visible and tie A to whoever later
redeems it. The share is a note known only to its owner, redeemed by a proof, like collateral.

### Changes

| Layer | Change |
|---|---|
| Circuits | Adding liquidity reuses the existing append circuit (leaf = note commitment, into the lender tree). New `lender_withdraw` circuit: Merkle membership in `lender_root`, nullifier `W` from the same secret, binding to the recipient key. Same shape as the borrow circuit without the collateral logic. Phase-2 setup on the existing ptau, verification key parked on-chain like the others. |
| Pool datum | New fields `lender_root`, `lender_next_index`, `total_shares`, `lender_nullifiers`, fixed `liquidity_reserve` and `lender_external_nullifier` (static). |
| Pool validator | `AddLiquidity { commitment, append_proof }`: pays the rounded-up share price, appends the commitment, `total_shares + 1`. New `WithdrawLiquidity { proof, nullifier, recipient }`: proof against `lender_root`, `W` fresh then recorded, pays the rounded-down share price to `recipient` tagged with `W`, payout covered by free lovelace above the reserve, `total_shares − 1`. Borrower paths (collateral, borrow, repay) are unchanged apart from freezing the new fields. |
| Tests | Adversarial validator tests in the M3 style: double withdraw with the same `W`; proof against another root; payout to another key; payout above or below the share price; withdraw beyond free liquidity; add liquidity below the price; append at a wrong index; tampering with the lender fields under borrower redeemers. Share-price tests after interest and with loans outstanding. |
| Deployment | Validator hashes change, so a new pool (new NFT, addresses). Liquidity added to the current M4 pool stays there (test ADA; the app already warns). The preview switches only on Dominik's go. |
| App | Lend tab: buy shares (one note each, forced backup), list of own lender notes with the current share price, withdraw to account B via a new relayer route with "free now", two-lens panels and linkage warnings, glossary and user guide. |

### To check during implementation

- The current borrow liquidity check is `loan_amount <= bal_in − total_borrowed`, but `bal_in`
  already excludes the lent-out lovelace, so outstanding loans are counted twice and the pool
  can lend at most about half its liquidity. With lender withdrawals the free-liquidity rule
  should be one formula for both paths (free = pool lovelace − reserve).
- `lender_nullifiers` grows with every withdrawal, like `used_nullifiers`; the datum size limit
  applies to both.

---

## Order

The update ships the lender side (§2) in one new deployment. §1 stays parked.
