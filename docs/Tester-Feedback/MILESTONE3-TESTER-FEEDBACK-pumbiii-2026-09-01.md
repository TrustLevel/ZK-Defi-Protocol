# M3 Tester Feedback — Break it (pumbiii) · v6 private model

**Tester:** pumbiii · 2026-09-01 · ~time: one long session
**Target:** branch `m3-remediation-v6` (private model: fixed loan denominations, nullifier-only
`open_loans`, Merkle-membership borrow, repayment-gated unlock).
**Grading rule (this runbook):** *attack rejected = PASS* (the protocol held).

**How I graded this:** one question — can I move funds I shouldn't be able to move, or is the
proof (and the validator around it) genuinely the gate? I ran the whole flow with my **own**
throwaway wallet (keyhash `55cca2f4…`), on my **own** self-contained
pool, then attacked it.

---

## Part A — Adversarial test suite (in the code)

`cd contracts && aiken check` → **13 checks, 13 passed, 0 failed, 0 warnings.**

| Test | Present & passing? | Trace |
|---|:--:|---|
| `unlock_blocked_while_loan_open_fails` | ✅ | `settled ? False` |
| `borrow_reused_nullifier_fails` | ✅ | |
| `repay_below_interest_fails` | ✅ | |
| `unlock_wrong_commitment_fails` | ✅ | `proof_ok ? False` |
| `tampered_borrow_signal_fails_onchain` | ✅ | |
| `tampered_unlock_signal_fails_onchain` | ✅ | |
| (+ `tampered_public_signal_fails_onchain`, membership/repay/unlock positive cases) | ✅ | |

The negative tests are real (fail-closed), not `True` stubs. Total matches the doc (13).

---

## Part B — Live attacks on Preprod (the important part)

**Baseline first (my own wallet, my own pool) — all `valid_contract=true`:**

| Step | Tx hash |
|---|---|
| Park VKeys | `2bacdbe609136456efe43131a2fed3bb91e5dfca8c8ced756c0edef77ce431fb` |
| Init pool (admin = pumbiii) | `8ab13c5ab0f073088c327d7a940d463b84ff4fb4795f095a30b3481b5618ad0c` |
| Deposit (20 ADA, my secret) | `d61a318af47e1e7bf3aeb9f13750dbc7a26b1b80aee3217aaa2fca2392dd1d89` |
| SetGroupRoot | `6e585245e007a2d9d1a8e4ac268168da4ed8d34dd5ca29cd9d9ad229ee12ccc5` |
| **Borrow** (ZK, on-chain verify) | `6899acde0c9cd8ab5ed1564500960f9f4e6969fd295d14683995cd79fe470dce` |
| **Repay** (principal + interest) | `7d1656a4232acd2fb63c4410165a90c4f407fecafc734ba184daec40414681ff` |
| **Unlock** (no signature) | `d9e3579484949d07e1019e0f37c0bd76b8cdbaecdf479e20f20f76fa9dc33277` |

Economics confirmed on-chain: pool **100 → 90** (borrow paid me 10 ADA) **→ 100.5** (repay, +0.5
interest); **20 ADA collateral released** on unlock. Borrow/repay/unlock carried **no `required_signers`** —
the proof is the authorization. (helper: a self-payment split `6ee55de4…` to get pure-ADA collateral UTxOs.)

**Every failing attack below was rejected by the node at submit time** as
`ConwayUtxowFailure → ValidationTagMismatch (IsValid True) (FailedUnexpectedly (PlutusFailure …))`,
i.e. the on-chain PlutusV3 validator ran and refused. No collateral was consumed (rejected before a block).

### Attack 1 — Unlock without repaying (the exact finding that failed last time)
Ran unlock **while the loan was still open** (off-chain check confirmed `nullifier settled? false`).
- **Rejected? YES (PASS).** Collateral validator failed on-chain — nullifier still in `open_loans`.

### Attack 2 — Repay less than owed
Repaid **10 ADA** when **10.5** was due (principal + 5% interest).
- **Rejected? YES (PASS).** Pool validator failed on-chain (requires `repay ≥ principal + interest`).
- Note: in the v5-era review interest looked "informational". In **v6 it is enforced** — underpay is refused.

### Attack 3 — Reuse the loan (double-borrow)
Borrowed a second time on the same deposit (same secret → same nullifier, already in `open_loans`;
off-chain check `already in open_loans? true`).
- **Rejected? YES (PASS).** Borrow validator failed on-chain (reused nullifier).

### Attack 4 — Unlock a deposit I don't own
Took a foreign published commitment (the maintainer's deposit) and tried to build an unlock proof
with a guessed secret.
- **Blocked? YES (PASS).** Proof generation is impossible: circuit assert
  `commitment = Poseidon255(amount, secret)` fails (`Assert Failed … UnlockProof line 35`).
  Without the secret there is no proof — never reaches the chain.

### Attack 5 — Tamper the config
Did a legit admin `SetGroupRoot` but also mutated a **frozen** field (`collateral_ratio 125 → 50`)
in the continuation datum. (Signed by the real admin, so this isolates the immutability check, not the sig.)
- **Rejected? YES (PASS).** Pool validator failed on-chain (only `group_root` may change).
- Separately, `SetGroupRoot` also requires the **admin signature** (`requiredSignerHash` + validator
  admin check), so a non-admin can't republish the root at all — I signed as admin here only to isolate
  the config-immutability check.

### Attack 6 — Free-form: steal the pool
Spent the pool UTxO (100.5 ADA) and sent its ADA to **my** wallet with **no pool continuation output**.
- **Rejected? YES (PASS).** Pool validator failed on-chain (pool must continue at the script; value conserved).
- This is the one I most wanted to win. I couldn't. **I could not move funds that weren't mine.**

**Positive control (proves the gate is real):** the *same* unlock that was refused in Attack 1
**succeeded** (`d9e3579…`, `valid_contract=true`, 20 ADA returned) once the loan was settled by the
repay. So the Attack-1 rejection is specifically the repayment gate — not an unrelated failure.

---

## Part C — Reviewer-finding checklist

- [x] Borrower **cannot** unlock collateral without fully repaying (Attack 1 + positive control)
- [x] **Interest** is charged and enforced (Attack 2; repay required principal + interest)
- [x] The verification key **cannot** be swapped by the spender (read-only ref at an always-false address; datum-pinned)
- [x] Datum/config fields **cannot** be rewritten on a spend (Attack 5)
- [x] Loan **amounts** carry no per-loan info (fixed 10-ADA denomination; `open_loans` stores only nullifiers)
- [x] Borrow does **not** reference the collateral UTxO (borrow tx `6899acde…` references only the vkey + pool, not the deposit)
- [x] Adversarial **validator tests** exist and pass (Part A, 13/13)
- [x] Pool funds cannot be drained by the spender (Attack 6)
- [~] Evidence on an **immutable tag**, not `main` — *not my scope:* I tested the live branch
  `m3-remediation-v6` with my own instance; tagging the final published evidence is a maintainer step.

---

## Part D — Verdict

- **Did any attack succeed (let me cheat)?** **No.** All six were rejected on-chain (1,2,3,5,6) or made
  impossible off-chain (4). The proof + the validator around it are the gate.
- **How hard to break?** **5 / 5 — couldn't.** Every path I tried to move value I wasn't entitled to
  failed closed, and the failures are the *right* ones (script rejection, not luck).
- **Weakest spot I found:** not a protocol break, but an honest scope note — in v6 **borrowing is gated
  on Merkle membership in the pool's admin-published `group_root`**. So the v5-era "permissionless borrow
  straight out of the maintainer's pool" does **not** transfer to v6: an outsider can only borrow from a
  pool if the admin has published their commitment. That's *anonymous-within-an-admin-curated-set*, which
  matches `docs/MILESTONE3.md §5.4`. It's a design property, not a defect — but reviewers should not read
  v6 as "anyone can borrow from anyone's pool"; membership is permissioned, anonymity is within the set.
- **Honesty check** (docs §5 privacy limits vs. what I observed): **mostly matches**, with two doc
  caveats I only surfaced by tracing the chain (full analysis in **Part E**): (i) §5 "collateral amount
  is **never on-chain**" overclaims —
  the datum holds only the commitment, but the deposit **UTxO value equals the collateral (20 ADA)** and
  is public; (ii) the **unlock re-links deposit↔borrow** via the shared loan nullifier, which §5 doesn't
  flag. Everything else (borrow doesn't reference the deposit; no signer on the anonymous paths;
  admin-curated, adoption-limited set) is as documented.

**Ops gotchas (not protocol):**
- Script txs need a **pure-ADA** UTxO for Cardano collateral — I split one off first.
- During my run the **Blockfrost preprod tx-evaluate/submit endpoints were intermittently unreliable**
  (long hangs, while plain REST was instant). I worked around it by supplying **manual ExUnits**
  (`autoEvaluate` off) — the txs are otherwise identical. **No soundness impact:** every legit cycle tx
  is `valid_contract=true` on-chain (so the manual budget was sufficient), and every attack still failed
  the on-chain script — the workaround only bypasses the flaky *evaluation endpoint*, not the validator.
  Worth documenting for the next tester so they don't chase a phantom "protocol" hang. (The `.env`
  Demeter Kupo/Ogmios endpoints returned 401 — tokens look expired — so I couldn't fail over to them.)

### Overall (break-it)
- [x] **Pass** — zero protocol bugs; every attack failed closed; interest + repayment-gate + config-freeze
  + pool-conservation all enforced on-chain by the PlutusV3 validators.

---

## Part E — Anonymity trace & hardening recommendations

After the break-it run I switched hats and asked the *other* question: not "can I cheat?" but
**"given only the public ledger, how much of who-borrowed-what-against-which-collateral can I
reconstruct?"** I traced my own live cycle on Preprod (read-only, no tx submitted).

**The zk-SNARK delivers *soundness*, not *privacy*.** It stops cheating (proven above); it does not, by
itself, stop a chain-analyst from tracing the flow on a transparent ledger. In my run the practical
borrower anonymity was **near zero**.

**The trace (what an observer sees; `PUMBIII` = my one wallet, `SCRIPT` = pool/collateral validators):**

| Tx | spent inputs | ref inputs | outputs | fee payer |
|---|---|---|---|---|
| Deposit `d61a318a` | PUMBIII | – | SCRIPT:20[datum], PUMBIII | PUMBIII |
| Borrow `6899acde` | SCRIPT:100, PUMBIII | vkey `2bacdbe6#0` | SCRIPT:90[datum], **PUMBIII:10**, PUMBIII | PUMBIII |
| Repay `7d1656a4` | SCRIPT:90, PUMBIII | vkey | SCRIPT:100.5[datum], PUMBIII | PUMBIII |
| Unlock `d9e35794` | PUMBIII, **SCRIPT:20 (the deposit)** | vkey, pool | **PUMBIII:20**, PUMBIII | PUMBIII |

Hard facts from the trace (this is the evidence behind the leak table below):
- **Same wallet pays every tx** → one `addresses/{addr}/txs` query returns the whole lifecycle (Leak 1).
- **Borrow's only ref input is the vkey**, not the deposit → in isolation the borrow *is* deposit-unlinkable.
- **Unlock spends the deposit UTxO** (`SCRIPT:20` = `d61a318a#0`) → the deposit is exposed at unlock.
- The **loan nullifier `126562a2…efa20`** appears in the raw CBOR of **borrow, repay and unlock** — the
  same value present in the borrow (redeemer + pool datum) reappears in the unlock redeemer, so
  deposit↔borrow are re-linked even across wallets (Leak 2).
- The **deposit datum holds only the commitment + timestamp (no amount)**, but the deposit **UTxO value
  is 20 ADA** → the collateral amount is public via the value (Leak 3).
- The pool's **commitment set had size 1** in this run → membership hides nothing here (Leak 4).

**"inherent" vs "fixable" (used below):** *inherent* = a ceiling of the **transparent Cardano L1**, not
a flaw in this team's design — unfixable without a different base layer (a shielded chain). Not a
criticism, just the documented L1 ceiling. *fixable* = solvable within this design (circuit change, or
UX/relayer).

| # | Leak (what an observer reconstructs) | Class | Fix |
|---|---|---|---|
| 1 | **Wallet reuse** — all 5 txs are fee-paid by the same address → one query returns the whole lifecycle | **fixable (UX/infra)** | **M4:** a fresh, unlinkable address **per step** (deposit / loan payout / repay / unlock) + a **relayer** that submits & pays fees, so the user is not the visible fee-payer. |
| 2 | **Unlock re-links deposit↔borrow** — the unlock exposes the same loan nullifier while spending the specific deposit; that nullifier was public in the borrow → chain them, even across wallets | **fixable (circuit)** | Make the loan nullifier a **private witness** of the unlock circuit and prove settlement by **in-circuit non-membership** (nullifier ∉ `open_loans`) instead of revealing it in the redeemer. Dovetails with the planned **MPF nullifier-set** (§5.5) that makes succinct non-membership practical. |
| 3 | **Amounts in the clear** — collateral 20 ADA (UTxO value), loan 10, repay 10.5 | **inherent (L1)** | UTxO values are always public on an L1; already mitigated by **fixed denominations** (bucketing → value reveals only "one unit"). No mechanism change; only the **doc wording** "collateral amount never on-chain" needs softening. |
| 4 | **Anonymity set = 1** in my run → membership hides nothing | **inherent** | A function of **adoption**, not code; grows with same-denomination depositors. |
| 5 | **Timing / pool topology** visible | **inherent (L1)** | Partial mitigation via relayer/batching; out of scope for M3/M4. |

**Two doc fixes recommended:** (a) soften §5 "collateral amount is never on-chain" → "not in the datum,
but the locked value is public; privacy comes from a uniform denomination, not from hiding the number";
(b) add the **unlock → nullifier → borrow** re-linkage (Leak 2) to §5 as a real deposit↔borrow
de-anonymization vector.

### Privacy verdict
- [x] **Pass — conditional.** The privacy *model* is sound and (with the two wording fixes) honestly
  documented; Leaks 3–5 are inherent L1 ceilings and don't block the pass. **Conditions:**
  1. **Leak 1 is implemented in M4** — fresh wallet per step + a relayer for fees.
  2. **Leak 2 is solved** — loan nullifier made private + in-circuit non-membership at unlock.

  Without these two, the delivered anonymity is essentially theoretical on a live chain; with them, the
  "anonymous within a set" claim actually holds against a tracing adversary.

**Signature:** pumbiii / 2026-09-02
