# Milestone 4 — User Interface for Private DeFi Transactions

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** a simple web-based UI that lets users request loans, verify collateral
and manage repayments using zk-SNARK proofs, tested with users, with documentation and
tooltips.
**Status:** Plan. Builds on the M3 protocol (`contracts/validators/v5/`, tag `m3-poa-v5.1`)
on Cardano **Preprod**, on a separate M4 deployment of the same contracts (§9).

---

## 1. Scope

The milestone as defined in the Catalyst portal, and where each part is delivered:

| Portal item | Delivered by |
|---|---|
| UI integration with smart contracts for private loan issuance and repayment | Web app over `lending_pool_v5` / `collateral_v5` (§3, §4) |
| User flow for generating zk-proofs for loan requests, repayments and collateral verification | In-browser Groth16 proving for deposit, borrow, repay and unlock (§3.3) |
| User testing and protocol updates based on feedback | Test round with privacy-preserving analytics (§6), protocol update (§7) |
| Comprehensive documentation and tooltips | In-app tooltips, user guide, video walkthrough (§8) |
| **AC:** interact with the protocol privately, without revealing transaction or collateral details | Privacy design of the UI (§5) |
| **AC:** protocol updates take user feedback into account | §7 |
| **AC:** documentation and tooltips are comprehensible | §8 |
| **Evidence:** UI code, user-testing analytics, documentation + tooltips + video on GitHub | `ui/`, `docs/m4/` |

The UI adds no new trust: every action is still authorized by a zk-SNARK proof verified
on-chain. There is no admin key and no signature on any protocol path.

---

## 2. UI concept

### Two lenses

Every action shows two panels side by side:

- **What you know:** your secret (kept in the browser), your position, your amounts.
- **What the chain sees:** exactly what the transaction puts on-chain: a commitment, a
  nullifier, "one unit of 20 ADA", and no link to your deposit.

Privacy is not a claim in the docs; the user sees it at every step. When an action
would link two steps on-chain (for example a repayment paid from the wallet that made
the deposit), the chain panel shows that link before the user signs.

### Three areas

**Pool** (public, no wallet needed)
- Liquidity, total borrowed, utilization, interest rate, denominations
  (20 ADA collateral → 10 ADA loan).
- **Anonymity set:** the commitment tree as a grid of leaves. The user's own leaf is not
  highlighted, because the chain does not know which one it is.
- **Activity feed:** deposits, borrows, repayments and unlocks as they appear on-chain,
  showing that they cannot be linked to each other.

**Borrow** (the user's positions)
- Each position is a card with a state machine:
  `Deposited → Borrowed → Repaid → Unlocked`.
- Each transition is one button. The card names the account to connect for the step
  (§4). Proof generation is visible: witness → proving → local verification, with timing
  and the note that the secret never left the browser.
- **Note:** the secret, commitment, leaf index and deposit reference are a note the user
  must back up (download) before the deposit is submitted, and can import again on any
  device. Losing the note means losing the collateral; the UI says so plainly.

**Lend**
- Add liquidity, pool statistics, the lender's contribution.
- Withdrawing liquidity is not part of the current protocol; the UI states this openly
  (see §7).

### Position status is computed in the browser

The browser downloads the full public sets (commitments, open and used loan nullifiers,
repayment nullifiers) and derives the state of each note locally. The server never
learns which position a visitor owns.

---

## 3. Architecture

### 3.1 Shared protocol module

`packages/protocol` holds the protocol logic once, for the backend, the web app and
the command line: Poseidon255 leaves and nullifiers, the Merkle trees, BLS12-381 point
compression, circuit inputs, every datum and redeemer, the script parameter chain,
the transaction builders and the chain reader. It has no Node built-ins in the parts
the browser uses. Its tests check it against the chain: values and data hashes of a
Preprod cycle on the M4 pool, the parked verification key, and the deployed script
hashes.

`offchain/cli/m4/run.mjs` is a command line client on this module. It reads the pool
and both trees from the chain and keeps only the user's note locally, as the web app
does. The M3 scripts in `offchain/cli/v5/` stay as they are, as the M3 evidence.

### 3.2 Web app

Next.js with `@meshsdk/react` and CIP-30 wallet connection, the same stack as the
ZK-Voting-App frontend. Deposit and repay are signed by the user's wallet in the
browser; borrow and unlock need no user signature (§5).

### 3.3 In-browser proving

All five proofs are generated with snarkjs in the browser (borrow, repay, settlement and
the append proof used by deposit and repay). Circuit `.wasm` and `.zkey` files
(1–8 MB each) are loaded on demand and cached. Proving runs in a Web Worker so the page
stays responsive, and each proof is verified locally before the transaction is built.

Measured with the app's browser check (`/check`) in Chrome on a laptop (8 cores),
witness + proving + local verification, files cached:

| Proof | Time |
|---|---|
| Append (deposit, repay) | 1.4 s |
| Borrow | 0.7 s |
| Repay | 1.0 s |
| Settlement (unlock) | 0.8 s |

The page stays responsive while proving.

### 3.4 Server

A small Node backend (Fastify), separate from the web app so the relayer key never
lives in the frontend process. It is stateless, holds no user secret and can rebuild
everything from the chain at any time. Three jobs:

1. **Read:** follow the pool NFT's transaction history, decode the `DepositCollateral` and
   `RepayAnonymous` redeemers and serve the leaf lists of `group_root` and `repaid_root`,
   plus the current pool UTxO. Every client rebuilds the roots itself and checks them
   against the on-chain datum. The redeemers are decoded from their CBOR: the leaves are
   255-bit integers and must not pass through a JSON number.
2. **Evaluate and submit:** script evaluation and submission go through the server, so no
   Blockfrost key is shipped to the browser.
3. **Relay:** build, sign and submit borrow and unlock, paying fees and script
   collateral (§5). Rate-limited.

---

## 4. User flow

The user works with two accounts of their wallet (most CIP-30 wallets hold several):
**account A** owns the collateral, **account B** owns the loan. The UI names the account
to connect at each step.

| Step | Proofs (in browser) | Paid from | On-chain effect |
|---|---|---|---|
| Deposit | append (commitment → `group_root`) | account A | 20 ADA locked under a commitment; `unlock_to` = account A |
| Borrow | borrow (membership, recipient-bound) | relayer | 10 ADA to account B |
| Repay | repay + append (R → `repaid_root`) | account B | 10 ADA principal + 5 % interest to the pool |
| Unlock | settlement (R ∈ `repaid_root`) | relayer | 20 ADA to the deposit's `unlock_to` |

---

## 5. Privacy in the UI

M3 named the remaining linkage on a transparent ledger: the wallet that pays fees and the
payout addresses (MILESTONE3 §5, Privacy boundary, item 3). The UI closes it where the
protocol allows:

- **Relayer for borrow and unlock.** Neither step needs funds from the user beyond fees.
  The borrow proof is bound to the recipient key and the unlock pays to the `unlock_to`
  address fixed at deposit, so a relayer can submit both without being able to redirect
  funds. The user's wallet does not appear in these transactions.
- **Two accounts.** The loan output carries the loan nullifier, and the repayment reveals
  it, so borrow and repay are linked by design. Repaying from account B, the account that
  received the loan, keeps that link away from account A and its deposit. Repaying from
  the deposit wallet would connect deposit and borrow through the wallet; the UI shows
  that link in the chain panel before the user signs.
- **Collateral returns to account A.** The unlock spends its own deposit, so it is
  linked to that deposit by design; paying the collateral back to the account that
  deposited it reveals nothing more. What the unlock hides is which repayment, and so
  which loan, it belongs to.
- **Client-side state.** Secrets, notes and position status stay in the browser (§2).
- **No identifying analytics.** See §6.

What stays visible, stated in the UI and the docs:

- Deposit is paid from account A and repay from account B. Repay is linked to its borrow
  by design (both carry the loan nullifier).
- Funding: if account B is funded from account A, that transfer links them. The guide
  asks testers to fund each account separately (for example from the faucet).
- Timing and the size of the anonymity set (MILESTONE3 §5, items 1 and 2).
- The relayer sees the borrow and unlock transactions it pays for, which are public
  anyway; it learns no secret.
- The backend of the hosted preview receives the requests of every step and could, in
  principle, connect them by IP address. It does not log IP addresses, but a user who
  does not want to rely on that runs the stack themselves (§9) or connects through Tor.

---

## 6. User testing and analytics

**Robustness for a shared pool.** All deposits, borrows and repayments spend the single
pool UTxO, and append proofs depend on the current root and index. When another user's
transaction lands first, the UI rebuilds the proof against the new state and submits
again. Between steps it waits for the indexer to catch up. When the wallet has no
pure-ADA UTxO for script collateral, the UI creates one.

**Analytics without identifying data.** The backend keeps counters per day and nothing
else: which step started, was signed, submitted, confirmed or failed (with an error class,
never the message), proof times in 100 ms buckets, retries and the wallet's name. No
event is stored on its own, one request carries one step so nothing links two steps of a
position, and anything outside this vocabulary (addresses, transaction hashes,
commitments, nullifiers, free text) is refused. The counters are public at
`/api/analytics`. Testers can switch counting off in the page footer, which also lists
every request their browser sent. Results are published in `docs/m4/` as data and a
report.

**Feedback.** Testers follow a short task script (deposit, borrow, repay, unlock, add
liquidity) and answer a structured questionnaire, including what they expected to be
able to do and could not.

---

## 7. Protocol update after testing

The protocol update collects every finding from the test round and from our own review,
with equal weight. Each block states how the protocol behaves, what for, and where it is
shown. Every change goes through adversarial validator tests in the M3 style before it
ships. Design detail: `docs/m4/withdraw-design.md` §2.

### Private lending: pool shares in and out

- **How it works.** A lender note is one pool share. Adding liquidity pays exactly the
  current share price and appends the note's leaf to the pool's lender tree
  (`lender_root`) with the append proof. Withdrawing proves in zero knowledge that the
  note is in the lender tree (`lender_withdraw` circuit), reveals a one-time withdraw
  nullifier, and pays the current share price to the key the proof is bound to: account B,
  through the relayer. Share value = pool lovelace − reserve + outstanding loans, so the
  interest from every repayment raises the price of every share at once. Payouts come from
  free liquidity only; while loans are out, lenders wait for repayments. Loans have no
  deadline, a design decision for privacy: no loan carries a timestamp or a write-off, so
  all loans stay indistinguishable. A loan that is never repaid is therefore missing for
  the lenders who withdraw last.
- **What for.** Lenders get their liquidity and its interest back, and nobody can link a
  withdrawal to the liquidity deposit it belongs to, see where it went, or tell how long a
  lender stayed and what they earned. Every share bought against the same pool state costs
  the same, and every share withdrawn against the same pool state pays the same, so amounts
  carry no fingerprint.
- **Where.** Commits `7673d35` (circuit), `c641e74` (on-chain verification), `a48ed7b`
  (tests), `bf8ca12` (validator), `c3a4fdc`/`13c9332` (protocol module), `d2a8407` (CLI),
  `a294f68` (golden tests on the Preprod cycle). Tests: `circuits/tests/lender-withdraw.test.mjs`,
  `contracts/lib/lender_onchain_test.ak`, `contracts/validators/tests/lender_test.ak`,
  `packages/protocol/test/lender.test.mjs`, `packages/protocol/test/plutus.test.mjs`.
  Preprod, pool `packages/protocol/deployments/preprod-m4-lend.json` (lender key parked
  `a5d6c715…`, pool initialised `f96703ed…`): two shares at 10 ADA (`869599d8…`,
  `c07238ca…`), collateral `8f369d4b…`, borrow `2571b27c…`, repay `6638066e…` (share price
  10 → 10.25 ADA), a third share at 10.25 ADA (`1f134c4b…`), one share withdrawn to
  account B through the relayer for 10.25 ADA (`277bc0a9…`; the lender's wallet does not
  appear in it), unlock `e67177ce…`.

### Loans paid from free liquidity

- **How it works.** A loan is paid if it fits into the free liquidity: the lovelace in the
  pool UTxO above the fixed reserve. Lender withdrawals use the same rule.
- **What for.** Lent-out lovelace has already left the pool UTxO; subtracting outstanding
  loans from it a second time would let the pool lend only about half of its liquidity.
- **Where.** Commit `bf8ca12`; test `borrow_lends_more_than_half_the_liquidity` in
  `contracts/validators/tests/lender_test.ak`. Preprod: borrow `2571b27c…` on the
  lender-side pool.

### Collateral that never backed a loan

Collateral is returned through borrow → repay → unlock. Collateral that never backed a loan
is reclaimed the same way, with an immediate repayment (cost: one loan's interest), so the
protocol needs no separate path for it.

## 8. Documentation, tooltips, video

- **Tooltips** at every term and decision point: commitment, nullifier, note, anonymity
  set, why amounts are fixed, why the note must be backed up, what the relayer can and
  cannot do.
- **User guide** in `docs/m4/` for the hosted Preprod preview: wallet setup with two
  accounts, test ADA, the full cycle, recovering a position from a note.
- **Self-hosting guide**: run the same stack locally (§9).
- **Video walkthrough** of the full loan and repayment cycle with in-browser zk-SNARK
  proofs, showing both lenses.

---

## 9. Deployment

- **Contracts:** a separate Preprod deployment of the same `v5` contracts (new pool NFT,
  same parked verification keys). The M3 pool is left untouched.
- **Hosted preview:** web app and backend behind Caddy via Docker Compose on a VPS, for
  the test and review period. The relayer wallet holds only a small amount of test ADA.
- **Self-hosting:** the same Docker Compose setup with `.env.example` (Blockfrost key,
  relayer wallet) and a short guide, so every claim can be checked without the hosted
  preview.

---

## 10. Out of scope

Mainnet, multiple pools or denominations, liquidations and variable interest. One pool,
fixed denominations, Preprod.

---

## 11. Build order

1. M4 deployment of the contracts.
2. Two-account cycle with a relayer, run from the CLI: account A deposits, the relayer
   submits the borrow to account B, account B repays, the relayer submits the unlock.
3. Shared protocol module (`packages/protocol`) and the M4 command line client on it,
   run through a full cycle.
4. Backend: indexer, evaluate and submit, relayer.
5. Web app skeleton with in-browser proving in a Web Worker.
6. Borrower flow: notes, account switching, client-side state, retry on pool contention.
7. Two-lens panels with the linkage indicator.
8. Pool and Lend areas.
9. Analytics and tooltips.
10. Docker Compose, self-hosting guide, hosted preview.
11. Test round, protocol update from the feedback (§7), documentation and video.
