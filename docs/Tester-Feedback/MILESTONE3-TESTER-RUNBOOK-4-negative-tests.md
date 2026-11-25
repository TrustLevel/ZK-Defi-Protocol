# M3 Tester Runbook 4 — Negative testing on your own Preprod pools

**Context and authorization.** This runbook is issued by the maintainers of the
ZK-DeFi-Protocol (TrustLevel) for the independent testing of their own open-source
contracts, as part of Project Catalyst milestone 3. Everything runs on the Cardano
**Preprod test network** with test ADA and test tokens that have no value. You deploy
**your own pools** from this repository with **your own wallet**; no case touches a
pool, wallet or funds of anyone else.

**Your role:** check that the validators **reject invalid transactions**. For each
negative case below you build a deliberately invalid transaction against your own
pool and record whether the validator **correctly rejected** it. For this runbook,
**"rejected" = PASS** (the protocol behaved as specified).
Return your report as `MILESTONE3-TESTER-FEEDBACK-<yourname>-<YYYY-MM-DD>.md`.

**Tester:** name/handle · background · date · time spent:

**Stand tested:** tag `m3-v6-rc3`, commit (`git rev-parse HEAD`): ____

**If you already ran Part 0 and Part A on `m3-v6-rc2`:** those results stay valid.
Between rc2 and rc3 the validators, circuits and keys did not change (`aiken check`
gives the same 109 tests); only the client's pool check `verifyPool` was extended
(case 13c), with its tests, and `status` now shows the loan size and interest rate.
Check out rc3, run `npm test` in `packages/protocol` once more (expect 63 pass, 1
skipped) and continue with Part B. Your pools and notes from rc2 can be reused.

**What is new since runbook 3.** Lenders hold private pool shares (`AddLiquidity`,
`WithdrawLiquidity` with a zero-knowledge proof). A pool lends one asset, ADA or a
native token, and accepts several collateral assets, each with a fixed denomination,
in one commitment set. Borrow, unlock and share withdrawal can be submitted by a
relayer. The borrow proof carries no amount and no asset. The loan and withdraw
nullifiers live in two Merkle Patricia Forestry sets (`loans`, `withdrawn`), so the
pool datum keeps its size. The scripts are published as reference scripts. Before
every step the client checks that the pool was initialized honestly (`verifyPool`).
The verification keys and reference scripts sit at a park address that no
transaction can spend (`contracts/validators/always_false.ak`,
`packages/protocol/test/park.test.mjs`). See `docs/MILESTONE3.md` §1 and §3.

**How rejections show up.** The command line client (Mesh) evaluates every
transaction against the validators on Preprod (via Blockfrost) **before** it submits.
A transaction the validator rejects fails at build time with an evaluation error and
is **never submitted**. That counts as **rejected by the validator**. Some cases are
stopped earlier because no valid proof can be generated; that also counts as PASS
(note which one you saw).

---

## Part 0 — Setup

```bash
git clone <repo> && cd ZK-Defi-Protocol
git checkout m3-v6-rc3
cd contracts && aiken check          # aiken v1.1.19 — expect 109 tests, 0 failed
cd ../packages/protocol && npm install && npm test     # expect 63 pass, 1 skipped (live test, needs a key)
cd ../../offchain && npm install
cp ../.env.example ../.env           # Blockfrost Preprod key + YOUR wallet mnemonic
cd cli/m4
```

**Accounts.** One mnemonic, one account per role, selected with `WALLET_ACCOUNT=<n>`:

| Account | Role | Fund from the faucet |
|---|---|---|
| 0 | deploys, mints the test tokens, lends | ~300 tADA |
| 1 | depositor (D) | ~100 tADA |
| 2 | borrower (B): receives the loan, repays | ~50 tADA |
| 3 | relayer (R): submits borrow, unlock and withdraw | ~50 tADA |
| 4 | `unlock_to` (U): receives the collateral back | nothing |
| 5 | share payout (P): receives the withdrawn share | nothing |

Fund D, B and R from the faucet directly, not from account 0, so the privacy check
(case 14) sees only the links the protocol makes. D needs 500 TOK from account 0
(`node run.mjs send --to <D> --unit <TOK unit> --amount 600`), like any holder who
received the token.

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

**Baseline cycle** on the ADA pool (`<B>`, `<U>`, `<P>` are the addresses of accounts
2, 4 and 5; `WALLET_ACCOUNT=<n> node run.mjs address` prints an account's address):

```bash
export DEPLOYMENT=./my-ada.json
WALLET_ACCOUNT=0 node run.mjs lend --note l1
WALLET_ACCOUNT=0 node run.mjs lend --note l2
WALLET_ACCOUNT=1 UNLOCK_TO_ADDRESS=<U> node run.mjs deposit --note ca --asset 0   # 20 ADA
WALLET_ACCOUNT=1 UNLOCK_TO_ADDRESS=<U> node run.mjs deposit --note ct --asset 1   # 500 TOK
WALLET_ACCOUNT=3 node run.mjs borrow   --note ct --to <B>   # 10 ADA to B, backed by TOK, relayed
WALLET_ACCOUNT=2 node run.mjs repay    --note ct            # 10.5 ADA from B
WALLET_ACCOUNT=3 node run.mjs unlock   --note ct            # 500 TOK back to U, relayed
WALLET_ACCOUNT=3 node run.mjs withdraw --note l1 --to <P>   # one share (principal + interest) to P, relayed
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
`WALLET_ACCOUNT=0 node run.mjs send --to <B> --unit <USD unit> --amount 1000000`).

**Where to edit for the negative cases.** Transactions are built in
`packages/protocol/src/tx.mjs` (`buildDeposit`, `buildBorrow`, `buildRepay`,
`buildUnlock`, `buildAddLiquidity`, `buildWithdrawLiquidity`); the client's own
guards are in `offchain/cli/m4/run.mjs`, and the nullifier-set proofs come from
`packages/protocol/src/mpf.mjs`. Edit, run, then **revert** before the next case:
`git checkout -- :/packages :/offchain` (works from any folder of the repo). Notes with
your secrets are in `offchain/cli/m4/notes/`.

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

| `repay_of_settled_loan_fails` / `borrow_rewriting_loans_set_fails` | the loans set only moves by a proven insert or open → settled update | |
| `pool_output_with_reference_script_fails` | the pool output carries no reference script | |
| `offchain_roots_match_onchain` | the off-chain and on-chain MPF libraries compute the same roots | |

Total reported by `aiken check`: ____ (expect 109, 0 failed).

---

## Part B — Negative cases: mapping, live sample, observations

Every negative case of this runbook is covered by a deterministic test in the
repository. Part B has three steps: (1) confirm each mapping by reading the test,
(2) run three cases live on your own Preprod pools, (3) record the observations.

### B1 — Each case and the test that covers it

For each row, open the test, confirm that it builds the invalid transaction the case
describes and that it passes, and fill in the last column. The Aiken tests are in
`contracts/validators/tests/` and `contracts/lib/` (run with `aiken check`); the
JavaScript tests in `packages/protocol/test/` (run with `npm test`).

| Case | Invalid transaction | Tests | Covers the case? (Y/N, note) |
|---|---|---|---|
| 1 | Unlock without repaying | `unlock_without_repay_fails` | |
| 2 | Repay principal only, or more than due | `repay_below_interest_fails`, `repay_overpay_fails` | |
| 3 | Second loan on the same deposit, during or after the first | `borrow_reused_nullifier_fails`, `borrow_after_repay_same_secret_fails` | |
| 4 | Loan paid to a key the proof does not bind, or short | `borrow_payout_to_other_key_fails`, `borrow_redeemer_recipient_swapped_fails`, `borrow_underpays_recipient_fails` | |
| 5 | Unlock paid to another address, or one payout for two deposits | `unlock_to_other_address_fails`, `unlock_payout_tagged_for_other_deposit_fails` | |
| 6 | Unlock against a pool reference without the pool NFT | `unlock_via_forged_pool_ref_fails` | |
| 7 | A UTxO without the pool NFT spent as the pool, or the NFT leaving the pool | `spend_pool_without_nft_fails`, `continuing_output_without_nft_fails` | |
| 8 | Wrong collateral: short amount, wrong asset for the index, unlisted or negative index | `deposit_collateral_wrong_amount_fails`, `deposit_second_asset_wrong_amount_fails`, `deposit_ada_under_token_index_fails`, `deposit_token_under_ada_index_fails`, `deposit_unlisted_asset_index_fails`, `deposit_negative_asset_index_fails` | |
| 9 | Repay that appends a different `R`, or uses a borrow proof as a repay proof | `repay_with_foreign_repay_nullifier_fails`, `repay_with_copied_borrow_proof_fails`, `repay_bogus_append_fails` | |
| 10 | Token pool: loan or repay in ADA, the pool's ADA taken, a foreign token added | `token_borrow_paid_in_ada_fails`, `token_repay_in_ada_fails`, `token_borrow_takes_pool_ada_fails`, `token_borrow_adds_foreign_token_to_pool_fails` | |
| 11 | Unlock of token collateral short of the token, of its ADA, or paid in ADA | `unlock_token_collateral_short_of_token_fails`, `unlock_token_collateral_without_its_min_ada_fails`, `unlock_token_collateral_paid_in_ada_fails` | |
| 12 | Share withdrawn twice, beyond free liquidity, to another key; share bought below price | `withdraw_same_note_twice_fails`, `withdraw_beyond_free_liquidity_fails`, `withdraw_redirected_to_other_key_fails`, `withdraw_paid_to_other_key_fails`, `add_first_share_underpaid_fails` | |
| 13 | Pool configuration or sets rewritten by a spend | `deposit_rewriting_collateral_assets_fails`, `borrow_rewriting_loan_asset_fails`, `borrow_rewriting_loans_set_fails`, `withdraw_rewriting_lender_root_fails` | |
| 13b | Pool datum grows with use until a transaction no longer fits | `mpf.test.mjs` (200 loans and 200 withdrawals, same datum size); `m3-cycle.test.mjs` (datum size through both live cycles) | |
| 13c | Pool initialized with other nullifier scalars, an interest rate above 100 %, a zero denomination, no collateral, or an unpaid reserve | `verify-pool.test.mjs` (the client refuses the pool) | |
| 15 | Spending the parked verification keys or reference scripts | `park.test.mjs` (the park address has no spendable script) | |

### B2 — Live sample on your own Preprod pools (required)

Run these three cases live. They are the ones with the most history: case 1 was the
original critical issue, case 9 the last finding (2026-11-18), case 12a covers the
lender side. Each runs on your own pool from Part 0; revert your edits afterwards
(`git checkout -- :/packages :/offchain`).

**Case 1 — Unlock without repaying.** Deposit (account 1) and borrow (account 3, to B),
skip the repay, then `WALLET_ACCOUNT=3 node run.mjs unlock --note <note>`.
- Expected: no settlement proof can be generated while `R` is not in `repaid_root`
  (the client stops before building), so nothing is submitted.
- Result: ____ · what you saw:

**Case 9a — Repay that appends a different R.** Make two deposits from account 1 and
borrow against both (to B). In the `repay` step of `offchain/cli/m4/run.mjs`, when
repaying the first loan, append the second deposit's `R` instead of the first one's:
use `computeRepayNullifier(<second secret>)` both as the leaf of `appendInput` and as
`R` for `buildRepay`. Then repay normally as a control.
- Expected: the edited repay is rejected at evaluation; the control repay succeeds.
- Result (edited / control): ____ / ____

**Case 12a — Withdraw a share twice.** Withdraw a share (`withdraw --note <l>`), then
withdraw it again. The client refuses first (`sets.withdraw`); bypass that by reusing
the `withdrawnProof` and `newWithdrawnRoot` of the first withdrawal.
- Expected: rejected at evaluation (the withdraw nullifier is already in `withdrawn`).
- Result: ____

### B3 — Observations

**Case 13c live (optional).** In `run.mjs` `deploy`, set `repay_external_nullifier`
to `8889n`, deploy to a new file, run `status` on it.
- Expected: `pool verification: the pool's nullifier scalars are not the protocol's`.
- Result: ____

**Case 14 — Privacy check (observe only).** Open a borrow of yours on Cardanoscan. From
the chain alone, can you tell which deposit backs it, or whether ADA or TOK? Can you
link an unlock to a borrow, or a share withdrawal to the share purchase it came from?
Compare with "What links and what does not" in `docs/MILESTONE3.md` §1 (deposit ↔
unlock and borrow ↔ repay are linked by design). Note which links come from your own
funding transfers rather than from the protocol.
- Result and notes:

**Case 16 — Further cases of your choice (optional).** Any other invalid transaction
you think the validators might accept, against your own pools. Report each with what
you built and what happened.

---

## Part C — Checklist

- [ ] Collateral cannot be unlocked before its own loan is fully repaid (1, 9)
- [ ] Nobody can repay someone else's loan in a way that locks their collateral (9)
- [ ] Interest is charged and the repayment is a fixed amount, in the loan asset (2, 10)
- [ ] A deposit backs exactly one loan (3)
- [ ] Copied proofs cannot redirect a loan, a share or collateral (4, 5, 12)
- [ ] The pool is recognised by its NFT; a UTxO without it is rejected as the pool (6, 7)
- [ ] A deposit locks exactly the denomination of the asset it names (8)
- [ ] A pool spend moves only the loan asset, by exactly its amount (10)
- [ ] An unlock returns the whole deposit (11)
- [ ] A share pays out once, at the current price, from free liquidity only (12)
- [ ] The asset configuration cannot be changed (13)
- [ ] The pool datum keeps its size; the pool cannot be frozen by growing it (13b, by test)
- [ ] A pool that was not initialized honestly is refused by the client (13c, by test)
- [ ] A borrow reveals neither the deposit nor the collateral asset; unlock and share withdrawal are not linkable to borrow and liquidity deposit (14)
- [ ] The parked verification keys and reference scripts cannot be spent (15)
- [ ] Adversarial validator tests exist and pass (Part A)

---

## Part D — Verdict

- Did any invalid transaction get **accepted**? If yes, describe it exactly; this is the most valuable thing you can report.
- Overall: how robust did the validators prove? (1 = an invalid transaction was accepted easily … 5 = every case was rejected)
- Weakest spot you found (even if no case got through):
- Honesty check: do the documented limits in `docs/MILESTONE3.md` §5 (trust assumptions, non-goals, privacy boundary) match what you observe on-chain? (Y/N + notes)
