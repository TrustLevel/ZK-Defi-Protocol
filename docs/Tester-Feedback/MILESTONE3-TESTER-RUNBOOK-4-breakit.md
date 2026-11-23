# M3 Tester Runbook 4 — Break it (pumbiii)

**Your role:** try to **break** the protocol, on your **own** pools with your **own**
wallet. Run each attack below and record whether the protocol **correctly rejected**
it. For this runbook, **"attack rejected" = PASS** (the protocol held).
Return your report as `MILESTONE3-TESTER-FEEDBACK-<yourname>-<date>.md`.

**Tester:** name/handle · background · date · time spent:

**What is new since runbook 3.** Lenders hold private pool shares (`AddLiquidity`,
`WithdrawLiquidity` with a zero-knowledge proof). A pool lends one asset, ADA or a
native token, and accepts several collateral assets, each with a fixed denomination,
in one commitment set. Borrow, unlock and share withdrawal can be submitted by a
relayer. The borrow proof carries no amount and no asset. See `docs/MILESTONE3.md` §1.

**How rejections show up.** The command line client (Mesh) evaluates every
transaction against the validators on Preprod (via Blockfrost) **before** it submits.
A transaction the validator rejects fails at build time with an evaluation error and
is **never submitted**. That counts as **rejected by the validator**. Some attacks are
stopped earlier because no valid proof can be generated; that also counts as PASS
(note which one you saw).

---

## Part 0 — Setup

```bash
git clone <repo> && cd ZK-Defi-Protocol
git checkout m3-v6-rc1
cd contracts && aiken check          # aiken v1.1.19 — expect 107 tests, 0 failed
cd ../packages/protocol && npm install && npm test     # expect 41 pass
cd ../../offchain && npm install
cp ../.env.example ../.env           # Blockfrost Preprod key + YOUR wallet mnemonic
cd cli/m4
```

**Accounts.** One mnemonic, three roles: account 0 deploys, lends and deposits
(account A), account 1 receives loans and share payouts and repays (account B), and
any account can relay. Select them with `WALLET_ACCOUNT=0|1`. Fund account 0 with
~300 tADA from the faucet and account 1 with ~50 tADA (fund B from the faucet, not
from A, if you also want to look at linkability).

**Your test tokens and pools.**

```bash
node run.mjs mint-token --name TOK --amount 1000000      # prints the TOK unit
node run.mjs mint-token --name USD --amount 1000000000   # prints the USD unit

DEPLOYMENT=./my-ada.json node run.mjs deploy --loan ada --collateral ada:20,<TOK unit>:500
DEPLOYMENT=./my-usd.json node run.mjs deploy --loan <USD unit> --collateral ada:20,<TOK unit>:500 \
  --vkeys-from ./my-ada.json
```

The first deploy parks the five verification keys from `circuits/keys/` and creates
the ADA pool; the second reuses those keys for the USD pool. Set `DEPLOYMENT` for every
later command. `node run.mjs status [--note <name>]` shows the pool and a position.

**Baseline cycle** on the ADA pool (B = account 1's address):

```bash
export DEPLOYMENT=./my-ada.json
node run.mjs lend     --note l1
node run.mjs lend     --note l2
node run.mjs deposit  --note ca --asset 0                 # 20 ADA
node run.mjs deposit  --note ct --asset 1                 # 500 TOK
node run.mjs borrow   --note ct --to <B>                  # 10 ADA to B, backed by TOK
WALLET_ACCOUNT=1 node run.mjs repay --note ct             # 10.5 ADA from B
node run.mjs unlock   --note ct                           # 500 TOK back
node run.mjs withdraw --note l1 --to <B>                  # one share (10.25 ADA) to B
```

| Step | Tx hash | valid_contract |
|---|---|---|
| Park keys + init ADA pool | | |
| Init USD pool | | |
| Lend ×2 | | |
| Deposit ADA / TOK | | |
| Borrow | | |
| Repay | | |
| Unlock | | |
| Withdraw | | |

Run the same cycle once on the USD pool (B needs 0.5 USD for the interest:
`node run.mjs send --to <B> --unit <USD unit> --amount 1000000`).

**Where to edit for the attacks.** Transactions are built in
`packages/protocol/src/tx.mjs` (`buildDeposit`, `buildBorrow`, `buildRepay`,
`buildUnlock`, `buildAddLiquidity`, `buildWithdrawLiquidity`); the client's own
guards are in `offchain/cli/m4/run.mjs`. Edit, run, then **revert**
(`git checkout -- packages offchain`) before the next attack. Notes with your secrets
are in `offchain/cli/m4/notes/`.

---

## Part A — The adversarial test suite (in the code)

`cd contracts && aiken check`. Confirm these negative tests are present and pass:

| Test | What it proves | Present & passing? |
|---|---|---|
| `unlock_without_repay_fails` | no unlock before the loan is repaid | |
| `borrow_after_repay_same_secret_fails` | a repaid deposit cannot borrow again | |
| `unlock_via_forged_pool_ref_fails` / `spend_pool_without_nft_fails` | the pool is the UTxO with the NFT | |
| `borrow_payout_to_other_key_fails` / `unlock_to_other_address_fails` / `withdraw_redirected_to_other_key_fails` | a copied proof cannot redirect funds | |
| `repay_with_foreign_repay_nullifier_fails` / `repay_with_copied_borrow_proof_fails` | a repay can only append the `R` of the loan it settles | |
| `deposit_second_asset_wrong_amount_fails` / `deposit_ada_under_token_index_fails` / `deposit_unlisted_asset_index_fails` | a deposit locks exactly the denomination of the asset it names | |
| `token_borrow_takes_pool_ada_fails` / `token_borrow_adds_foreign_token_to_pool_fails` | a pool spend moves only the loan asset | |
| `deposit_rewriting_collateral_assets_fails` / `borrow_rewriting_loan_asset_fails` | the asset configuration is fixed | |
| `withdraw_same_note_twice_fails` / `withdraw_beyond_free_liquidity_fails` | a share pays out once, and only from free liquidity | |
| `unlock_token_collateral_without_its_min_ada_fails` | an unlock returns the whole deposit | |

Total reported by `aiken check`: ____ (expect 107, 0 failed).

---

## Part B — Live attacks on Preprod (the important part)

### Attack 1 — Unlock without repaying
Deposit and borrow, skip repay, run `unlock`.
- Expected: blocked (no settlement proof exists while `R` is not in `repaid_root`;
  a proof forced against another root is rejected by the validator).
- Result: ____ · what you saw:

### Attack 2 — Repay a different amount
In `buildRepay`, change `poolValueMoved(pool, due)` to `poolValueMoved(pool, d.loan_denomination)`
(principal only), and in a second run to `poolValueMoved(pool, due + 1_000_000n)`.
- Expected: both **rejected**.
- Result (under / over): ____ / ____

### Attack 3 — Second loan on the same deposit
After a full cycle on a deposit, remove the guard
`if (pool.datum.used_nullifiers.includes(b.nullifier)) …` in `run.mjs` and borrow again.
- Expected: **rejected** (the nullifier is in `used_nullifiers`).
- Result: ____

### Attack 4 — Redirect a loan
(a) In `buildBorrow`, pay `.txOut(recipient, …)` to another address of yours while the
redeemer keeps the bound key. (b) Also put the other key into the redeemer
(`R_Borrow(proof, nullifier, <other key hash>)`).
- Expected: both **rejected**.
- Result (a / b): ____ / ____

### Attack 5 — Redirect an unlock
In `buildUnlock`, pay `.txOut(unlockTo, …)` to another address.
- Expected: **rejected**.
- Result: ____

### Attack 6 — Forged pool reference
With a loan open and not repaid, pay a UTxO to the pool address with a copy of the pool
datum whose `repaid_root` contains your `R`, then unlock against it as the pool
reference.
- Expected: **rejected** (the reference must carry the pool NFT).
- Result: ____

### Attack 7 — Spend a fake pool
Spend the forged UTxO from attack 6 as the pool in a borrow.
- Expected: **rejected**.
- Result: ____

### Attack 8 — Wrong collateral
In `buildDeposit`:
- (a) asset 0, but lock 19 ADA (`assetValue(collateral, collateral.denomination - 1_000_000n)`);
- (b) asset 1, but lock 499 TOK;
- (c) asset 1, but lock 20 ADA instead of the token;
- (d) `--asset 2` with the guard in `run.mjs` removed (no such asset).
- Expected: all **rejected**.
- Result (a / b / c / d): ____ / ____ / ____ / ____

### Attack 9 — Repay with a foreign R
- (a) Two own deposits, both borrowed. Repay one loan but append the other deposit's
  `R`, then try to unlock the other deposit.
- (b) From a wallet with no deposit: repay a victim's open loan with the victim's
  public **borrow** proof and a random `R`.
- (c) Same, with a valid repay proof for the victim's loan but a random `R`.
- Expected: all **rejected**; the honest repay on the same state succeeds.
- Result (a / b / c / control): ____ / ____ / ____ / ____

### Attack 10 — Token pool: take the wrong asset
On the USD pool, in `buildBorrow`:
- (a) pay the loan in ADA instead of USD (`.txOut(recipient, [{ unit: "lovelace", quantity: "10000000" }])`);
- (b) pay the loan correctly but also take 2 ADA from the pool
  (`moveAsset(poolValueMoved(pool, -loan), ADA, -2_000_000n)`);
- (c) in `buildRepay`, pay 10.5 ADA instead of 10.5 USD.
- Expected: all **rejected** (a pool spend moves only its loan asset, by exactly the
  action's amount).
- Result (a / b / c): ____ / ____ / ____

### Attack 11 — Unlock token collateral short
For a TOK deposit, in `buildUnlock` pay back (a) the TOK without its ADA, (b) the ADA
with 499 TOK.
- Expected: both **rejected** (the unlock returns the whole deposit).
- Result (a / b): ____ / ____

### Attack 12 — Lender shares
- (a) Withdraw the same share twice (remove the guard in `run.mjs`).
- (b) Withdraw a share while a loan is out and the free liquidity is below the share
  price (one share, one loan open).
- (c) In `buildWithdrawLiquidity`, pay the share to another key than the proof binds.
- (d) In `buildAddLiquidity`, pay less than the share price.
- Expected: all **rejected**.
- Result (a / b / c / d): ____ / ____ / ____ / ____

### Attack 13 — Rewrite the pool configuration
In any builder, change the continuing datum: add a cheap asset to
`collateral_assets`, lower a denomination, or change `loan_asset`.
- Expected: **rejected** on every spend.
- Result: ____

### Attack 14 — Privacy check (observe, do not attack)
Open your borrow transaction on Cardanoscan. From the chain alone, can you tell which
deposit backs the loan, or whether it is backed by ADA or by TOK? Can you link the
unlock to the borrow, or a share withdrawal to the liquidity deposit it came from?
- Result and notes:

### Attack 15 — Free-form
Replay a proof in another transaction, spend two deposits with one payout, move the
NFT, deposit directly to the collateral address and borrow against it, …

---

## Part C — Checklist

- [ ] Collateral cannot be unlocked before its own loan is fully repaid (1, 9a)
- [ ] Nobody can repay someone else's loan in a way that locks their collateral (9b, 9c)
- [ ] Interest is charged and the repayment is a fixed amount, in the loan asset (2, 10c)
- [ ] A deposit backs exactly one loan (3)
- [ ] Copied proofs cannot redirect a loan, a share or collateral (4, 5, 12c)
- [ ] The pool is recognised by its NFT; a forged or fake pool is rejected (6, 7)
- [ ] A deposit locks exactly the denomination of the asset it names (8)
- [ ] A pool spend moves only the loan asset, by exactly its amount (10)
- [ ] An unlock returns the whole deposit (11)
- [ ] A share pays out once, at the current price, from free liquidity only (12)
- [ ] The asset configuration cannot be changed (13)
- [ ] A borrow reveals neither the deposit nor the collateral asset; unlock and share withdrawal are not linkable to borrow and liquidity deposit (14)
- [ ] Adversarial validator tests exist and pass (Part A)

---

## Part D — Verdict

- Did any attack **succeed**? If yes, describe exactly; this is the most valuable thing you can report.
- Overall: how hard was it to break? (1 = trivial … 5 = couldn't)
- Weakest spot you found (even if you couldn't fully exploit it):
- Honesty check: do the documented limits in `docs/MILESTONE3.md` §5 (trust assumptions, non-goals, privacy boundary) match what you observe on-chain? (Y/N + notes)
