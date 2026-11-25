# Milestone 3 — Independent Tester Feedback

**Purpose:** Two independent testers each complete one copy of this form. The goal is to
independently verify Milestone 3's core claim — *zk-SNARK proofs are verified **on-chain** for
private collateral + lending/borrowing transactions* — and to assess reproducibility and clarity.

**How to use:** Copy this file to `MILESTONE3-TESTER-FEEDBACK-<yourname>.md`, fill every section,
and return it. Parts A and B require no setup (just a browser). Parts C and D are optional deeper
checks for technically-inclined testers.

---

## Tester
- Name / handle: **Pumbiii**
- Background (dev / cardano / zk / non-technical): Full stack dev, security-leaning
- Date (YYYY-MM-DD): 26-08-2026
- Time spent: 2 h

**How I graded this:** one question — can I move funds I shouldn't be able to move, or is the SNARK
genuinely the gate? Everything below serves that.

I don't review by walking the happy path — I go looking for the trust assumption that, if it's wrong, makes the whole
  claim collapse. Here that assumption is: *the proof, and nothing but the proof, authorizes a spend.*
---

## Part A — Verify the on-chain evidence (no setup, ~10 min)

**Verdict: all six valid. No hidden authorization path found.**

| Step | Tx hash | Valid? | What I actually checked |
|---|---|:--:|---|
| VKey park | `b3da94815002b9339390d76491b961da161595c18ff31ce0f1ea2ecbf9001c8e` | Y | datum holds the vkey; address is a script (unspendable), not a key I could later swap |
| Pool init | `1be3c892140bac8b6ed0db3d5e90ff71a21aed86edf2dfe1de53837a4a52c0f9` | Y | datum's `vkey_ref` points at the parked UTxO above |
| Deposit | `34f216e73ac4a209a9d392c34ca8e7df6e2ec2a5859d217fe747843ab8747a8a` | Y | commitment lives in the datum, not supplied at borrow time |
| Borrow | `19d9016ad95c3c410e8d66ce469a3f5e4cf2b329380555993fa1028110bb2b37` | Y | **no signatories on the spend** |
| Repay | `8b934c059ab1d352f47277181bb871875907dd34c5506b1e75ac7a8e44a76cf6` | Y | no signatories |
| Unlock | `24281542de3ab7e71e5a683917bd053d5a698ae2dfbf8daac0cf2346771ed609` | Y | no signatories |

Economics: pool 100 → 90 → 100, collateral 20 released.
- [x] Borrow moved 10 ADA out
- [x] Repay returned 10 ADA
- [x] Collateral (20 ADA) released

**A. Notes:** I wasn't checking whether the flags say "valid" — I was checking *what authorizes each
spend*. On the three interesting txs there are **no `required_signers`**. So either the proof is real
or these UTxOs are free money for anyone. That's the exact thing I set out to test in Part D.

---

## Part B — Documentation review (no setup, ~15 min)

**Verdict: clear on what M3 claims; I'd want the trust boundary and the non-goals spelled out.**

- What/how proven on-chain (1–5): **5**
- Could explain the flow after reading (Y/N): **Y**
- "Proof is the authorization, no admin signature" understandable (Y/N): **Y**

**B. Notes — read through a threat-model lens:**
- **Trust anchor = the parked vkey.** Everything reduces to "is the right verification key being used?"
  The docs cover this (always-false address, read-only reference input) but I'd promote it to an
  explicit *Trust assumptions* section: whoever set `vkey_ref` at pool-init defines what a valid proof
  is. That's the one privileged action in the whole system; name it.
- **Be explicit about M3 non-goals.** Reading the validator, `interest_rate` is carried in the datum
  but **not enforced on-chain** (the code comment even says "informational"), and there's no
  liquidation / repayment-incentive path — nothing on-chain compels a borrower to ever repay. That's
  completely fine for *this* milestone (M3 is "prove ZK verification on-chain", not "ship a complete
  money market"), but the docs should state it so a reviewer doesn't mistake M3 for a finished lending
  product.
- **Asymmetry worth a footnote:** borrow checks the pool delta *exactly* (`== balance - loan`), repay
  checks it loosely (`total_borrowed <= previous`, value `== balance + repay`). Not exploitable for M3
  as far as I can see, but the asymmetry deserves a one-line rationale.

I did **not** find a documentation error.

---

## Part C — Run the tests locally (optional, ~20 min)

**Verdict: pass — but a green suite means nothing until you prove it can go red. So I read the tests before I trusted them.**

| Check | Expected | Result |
|---|---|---|
| `aiken check` | 2/2 | **2/2 pass** |
| off-chain gate | 9/9 | **9/9 pass** |

Edge cases these tests cover — confirm you see them:
- [x] Tampered public signal → on-chain verify returns **false**
- [x] Insufficient collateral → proof generation **rejected**

**C. Notes — my worry was vacuous tests, so I audited how they're built, not just that they're green:**
- `contracts/lib/zk_onchain_test.ak` is **auto-generated** from a real snarkjs proof
  (`gen-onchain-fixture.cjs` → `groth16.fullProve`, then point-compressed into the on-chain byte
  format). It is **not** a hand-written `True`. Good — the "pass" is a real proof clearing the real
  verifier.
- The pass/fail pair is the tell: both tests feed the **identical** `vkey()` and `proof()` and the same
  commitment; the *only* difference is one public signal — `10000000` in the passing test vs `10000001`
  in the failing one. **One unit** of drift on a public input flips the verifier from accept to reject.
  That's a verifier that actually binds to its inputs, not one that rubber-stamps.
- Where I'd push back: there are only **two** on-chain cases. The one that matters most (public-signal
  binding) is covered, but I'd want on-chain negatives for a **malformed proof** and a **wrong vkey**
  too — right now those live only in the off-chain gate. Not an M3 blocker; the on-chain claim is
  demonstrated. Just where I'd spend the next hour of test-writing.

---

## Part D — Reproduce a fresh cycle on Preprod (optional, advanced)

**This is the whole review for me.** I didn't reproduce the maintainer's cycle in a sandbox of my own
— that only proves the code runs. I attacked the actual trust claim:

> **Can a wallet that is not the pool owner, holding none of the owner's keys, pull real ADA out of
> the owner's live pool — using only a proof?**

If yes, the SNARK is genuinely the gate. If it needed a signature, my attempt would fail. So I tried it.

**Setup:** a throwaway wallet I control (keyhash `55cca2f4…`), faucet-funded, no relationship to the
maintainer. I posted my **own** collateral with my **own** secret (I can't borrow against the
maintainer's deposit — a proof requires knowing the secret; that limitation is correct). Then I
targeted the **maintainer's existing live M3 pool UTxO** `8b934c059ab1d352…#0` (100 ADA).

- Fresh borrow/repay confirmed `valid_contract: true`? **Y.**
- Tx hashes:

  | Step | Tx | Valid | Fee (ADA) |
  |---|---|:--:|---|
  | My deposit (20 ADA, my secret) | `ef15a7647f747f55d0fa59c687d13b7d6cdd7f034dced912f69f331c71610d8d` | true | 0.1728 |
  | **Borrow from the maintainer's pool** | `03662fda6f4e65c83c0e548b55e69325bc9b2c90bbe3cb8690df0ce60d8477f4` | true | 0.6304 |
  | Repay | `07acda68a167c8148b2b794f7c49a1ad801a7c93211f86db1195c873e0a15d99` | true | 0.6289 |
  | Unlock | `f8fe1da496c5c35b19c72f9a9163cae0d8352317f44e5f40f03b5460f2987150` | true | 1.7793 |

**What the borrow tx `03662fda…` proves, decoded input-by-input:**
- **It spent `8b934c059ab1d352…#0` — the maintainer's own pool UTxO.** Not a clone, not my pool. Their
  100 ADA was the input.
- Read-only refs: the maintainer's parked vkey `b3da9481…#0` (unspendable address → I'm forced to
  verify against exactly their published key) + my deposit for the commitment.
- Outputs: 90 ADA continues at the pool script (`total_borrowed` → 10); **10 ADA arrived in my
  wallet.**
- Witnesses: **my key only.** The pool owner signed nothing and was never contacted.

**Conclusion I couldn't shake it off:** a stranger extracted real value from someone else's pool with
nothing but a zk-SNARK the validator checked on-chain. That's not "anonymous borrowing" — it's
**permissionless** borrowing, and it's the strongest evidence M3 could possibly produce. I then repaid
(pool restored to 100 ADA at a fresh UTxO) and unlocked my collateral, so I left the pool as I found it.

**Blockers (ops, not protocol):**
- Script txs need a **pure-ADA UTxO** for Cardano collateral — my first borrows died with
  `CollateralContainsNonADA` until I split one off.
- Blockfrost's UTxO index lags block-confirmation by seconds; firing steps back-to-back throws
  `All inputs are spent`. A short settle between steps fixes it.

---

## Part E — Assessment

**What I tried to break, and what happened:**
- *Borrow without the owner's signature* → **succeeded** (as designed). The proof is the authorization.
- *Borrow against collateral I don't own* → **impossible** (I can't produce the proof). Correct.
- *Feed the verifier a bad signal* → **rejected** on-chain (Part C). Correct.
- *Swap the verification key* → **can't** — it's pinned at an unspendable address and read-only.

- Convinced the proofs are checked on-chain, not off-chain/trusted? (Y/N): **Y, without reservation.**
  I moved someone else's money using only a proof. There is no other reading of that.
- Reproducibility (1–5): **4.** The protocol side is solid; I dock one point purely for the two
  undocumented ops gotchas that cost real time on a live run.
- Issues / bugs found: **Zero protocol bugs.** Everything I flagged (interest not enforced, no
  liquidation, loose repay accounting) is out-of-scope-for-M3, not a defect — but should be stated as
  non-goals. Ops: pure-ADA collateral + index-lag need documenting.
- Suggestions: add a *Trust assumptions & non-goals* section (the vkey-setter is the one privileged
  role; interest/liquidation are future scope); document the pure-ADA-collateral prerequisite.

### Overall verdict
- [x] Pass
- [ ] Pass with notes (list above)
- [ ] Fail (explain)

**Signature / handle + date:** Pumbiii / 26-08-2026
