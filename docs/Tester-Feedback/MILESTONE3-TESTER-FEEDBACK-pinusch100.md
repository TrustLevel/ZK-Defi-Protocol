# Milestone 3 — Independent Tester Feedback

---

## Tester
- Name / handle: **pinusch100**
- Background (dev / cardano / zk / non-technical): dev — Cardano/Plutus (Aiken), some zk (circom/snarkjs, Groth16 basics)
- Date (YYYY-MM-DD): 2026-08-26
- Time spent: ~90 min

---

## Part A — Verify the on-chain evidence (no setup, ~10 min)

Open each transaction on Cardano **Preprod** cardanoscan and confirm it shows **Script/Contract:
valid** (`valid_contract: true`). These are the six transactions of one full private cycle.

| Step | Tx hash | Confirmed valid? (Y/N) | Notes |
|---|---|---|---|
| VKey park | `b3da94815002b9339390d76491b961da161595c18ff31ce0f1ea2ecbf9001c8e` | Y | valid_contract true; fee 0.1938 ADA |
| Pool init | `1be3c892140bac8b6ed0db3d5e90ff71a21aed86edf2dfe1de53837a4a52c0f9` | Y | valid_contract true; pool created with 100 ADA |
| Deposit collateral | `34f216e73ac4a209a9d392c34ca8e7df6e2ec2a5859d217fe747843ab8747a8a` | Y | valid_contract true; 20 ADA locked at collateral_v5 |
| **Borrow** (ZK verified) | `19d9016ad95c3c410e8d66ce469a3f5e4cf2b329380555993fa1028110bb2b37` | Y | valid_contract true; **no signature on the spend** — proof is the auth. Fee 1.819 ADA |
| **Repay** (ZK verified) | `8b934c059ab1d352f47277181bb871875907dd34c5506b1e75ac7a8e44a76cf6` | Y | valid_contract true; fee 1.818 ADA |
| **Unlock** (ZK verified) | `24281542de3ab7e71e5a683917bd053d5a698ae2dfbf8daac0cf2346771ed609` | Y | valid_contract true; fee 1.779 ADA |

URL pattern: `https://preprod.cardanoscan.io/transaction/<hash>`

Sanity check the economics across the cycle (pool 100 → 90 after borrow → 100 after repay):
- [x] Borrow moved 10 ADA out of the pool — confirmed: borrow tx has a 100 ADA pool input, a 90 ADA pool output + a 10 ADA loan output.
- [x] Repay returned 10 ADA to the pool — confirmed: 90 ADA pool + 10 ADA repayment in → 100 ADA pool out.
- [x] Collateral (20 ADA) was released on unlock — confirmed: 20 ADA collateral input → 20 ADA released back to the borrower.

**A. Notes / anything that didn't match:**
Everything matched. All six show `valid_contract: true`. I traced the ADA flow on-chain rather than
just eyeballing the "valid" flag, and the pool balance genuinely walks 100 → 90 → 100 with the
collateral (20) freed at the end — the economics are internally consistent, not just cosmetically
"valid". The three proof-verifying txs (borrow/repay/unlock) cost ~1.8 ADA each vs ~0.18 ADA for the
setup txs; that's the on-chain BLS12-381 Groth16 verification showing up in the fee. The docs
explain this is a deliberately over-budgeted ExUnit setting (upper bound), which is fair, but worth a
heads-up for anyone eyeballing fees. Nice touch: the borrow spend carries **no `extra_signatories`**
— you can see there's no admin key authorizing it, only the proof.

---

## Part B — Documentation review (no setup, ~15 min)

Read `docs/MILESTONE3.md` (protocol + zk-proof mechanism), `docs/MILESTONE3-TEST-RESULTS.md`,
and `docs/MILESTONE3-EVIDENCE.md`.

- Is it clear **what** is proven and **how** the proof is verified on-chain? (1=unclear … 5=very clear): **5**
- Could you explain the deposit→borrow→repay→unlock flow after reading? (Y/N): **Y**
- Is the "proof is the authorization, no admin signature" design understandable? (Y/N): **Y**
- **B. Notes / unclear points / suggested doc improvements:**
  The docs are strong — better than most Catalyst M3 write-ups I've read. What actually convinced me
  wasn't the "valid_contract: true" flags, it was §3 "On-chain verification design", specifically the
  **public-signal binding** part: the validator doesn't trust redeemer-supplied signals — `commitment`
  is read from the referenced collateral UTxO, the loan/repay amounts are cross-checked against the
  pool value delta and `total_borrowed`, and `collateral_ratio` comes from the pool datum. That closes
  the obvious "just pass in whatever public signals you want" attack, and it's the thing a skeptical
  reviewer will look for. Consider pulling that point up higher / making it more prominent.

  Small suggestions:
  1. A one-line sequence diagram (park → init → deposit → borrow → repay → unlock, with which UTxO is
     spent vs. referenced at each step) would make the flow instant to grasp. Right now you have to
     hold the reference-input-vs-spend distinction in your head.
  2. `MILESTONE3.md` §4 could also surface the ExUnit headroom numbers (~43k mem / ~2.27B cpu vs the
     V3 limits, ~4.4x cpu headroom). They're in TEST-RESULTS.md and they're a genuinely reassuring
     data point — worth not burying.
  3. Minor: clarify that the borrow/repay/unlock fees shown are *upper-bound* right in the evidence
     table caption, not only in the note below it.

---

## Part C — Run the tests locally (optional, ~20 min)

Prereqs: `aiken`, `node`, repo cloned. From the repo root:

```
cd contracts && aiken check        # expect: 2/2 tests pass (on-chain groth_verify)
cd .. && node circuits/tests/gate-bls12381.cjs   # expect: 9/9 pass (off-chain proof gate)
```

| Check | Expected | Your result | Notes |
|---|---|---|---|
| `aiken check` | 2 passed / 0 failed | **2 passed / 0 failed** | `collateral_proof_verifies_onchain` (mem 42,467 / cpu 2,268,410,848) and `tampered_public_signal_fails_onchain` (mem 43,068 / cpu 2,268,582,897) both pass |
| off-chain proof gate | 9 passed / 0 failed | **9 passed / 0 failed** | ran first try, no missing deps |

Edge cases these tests cover — confirm you see them:
- [x] Tampered public signal → on-chain verify returns **false** — saw it both off-chain (gate #8) and on-chain (`tampered_public_signal_fails_onchain`). The on-chain one is the important one: flipping `loan_amount` in the public signals makes the *validator's* `groth_verify` return false, so the spend would fail. That's the real proof this isn't just an off-chain check.
- [x] Insufficient collateral → proof generation **rejected** — gate #9: 10 ADA collateral vs 10 ADA loan @125% (1e9 < 1.25e9) fails the circuit's `ge.out === 1` constraint, no witness can be produced.

**C. Notes:**
Reproducibility is excellent — `aiken check` and the gate ran turnkey with no fiddling. Two nits:
1. Gate check #9 prints a raw `ERROR: 4 Error in template ProveOwnership_73 line: 81` line *immediately
   before* the `✅ insufficient collateral -> proof generation rejected`. That error IS the expected
   rejection (the circuit refusing to build a witness), but a first-time reader could easily think
   something broke. A one-word `(expected)` annotation next to that print would remove the doubt.
2. Watch the working directory: `node circuits/tests/gate-bls12381.cjs` must be run from the repo
   root, not from `contracts/` (the path in the "cd contracts && … && cd .." block is relative). Minor,
   but I tripped on it for a second.

The `aiken check` tests are the standout — they call `zk.verify_collateral_proof`, i.e. the *exact*
helper the v5 validators use, against a real BLS12-381 proof fixture. So "the test passes" and "the
validator would accept this proof on-chain" are the same statement. That's the right way to test this.

---

## Part D — Reproduce a fresh cycle on Preprod (optional, advanced)

Using your own Preprod Blockfrost key + a funded Preprod wallet, run the scripts in
`offchain/cli/v5/` (park-vkey → init-pool → deposit → borrow → repay → unlock). Record your own
tx hashes.

- Did a fresh borrow/repay confirm with `valid_contract: true`? (Y/N): **Y** — full independent cycle, all 6 txs `valid_contract: true`.
- Your tx hashes (my own funded Preprod wallet, *different* from the maintainer's M3 wallet):

  | Step | My fresh tx hash | valid_contract | Fee (ADA) |
  |---|---|:---:|---|
  | Park VKey | `576ddc402135cf2607e44eafc36798058cf7beb73ef5868c37dbe55dd61af379` | true | 0.1969 |
  | Init pool | `985fc22ef8d3162d8f07682f36cb477cfa15f31056318907f7ccf183e8fed421` | true | 0.1748 |
  | Deposit | `ab6f898cbc97a84f8dc152757311d020313ce6c24bd821e4f5a2584ca47afd0b` | true | 0.1757 |
  | **Borrow** | `15fdb8258bcf099593d5779b881eab137127aa34caae0e7220ece3f9c5a11381` | true | **0.6304** |
  | **Repay** | `9f286161563243a72515ac6daa103b44c7fb62b78a4e3c9380f7870ee13a7e87` | true | **0.6320** |
  | **Unlock** | `f3f058c0d52e0d0bc5186deae8d22de3d84b4f9148c4f960d35c9e270340bd8a` | true | 1.7793 |

- **D. Notes / any blockers:**
  I reproduced the whole park → init → deposit → borrow → repay → unlock cycle from scratch on Preprod
 (commitment `12937705853738531303147574099403735548568466735580408700800152128528810669360`). All six confirmed `valid_contract: true`, so the on-chain `groth_verify` accepts a
  *brand-new* proof I generated myself — this is the strongest evidence for me: it's not a replay of the
  maintainer's proofs, it's the validator verifying my own SNARK.

  **Genuinely interesting finding — the fee optimisation in the docs is real.** My **borrow/repay came
  in at ~0.63 ADA**, vs the ~1.82 ADA in the published M3 evidence. That matches exactly what
  TEST-RESULTS.md §3 predicts: `4-borrow.mjs`/`5-repay.mjs` were retuned to `mem 900k / steps 4B` and
  it materially lowers the proof-tx fee. My **unlock was still 1.78 ADA** — consistent, because
  `6-unlock.mjs` wasn't retuned. So the "upper bound" caveat in the docs is honest and now
  independently confirmed on-chain.

  **Two real gotchas I hit reproducing it (worth documenting for the next tester):**
  1. **Collateral must be pure ADA.** My wallet's only UTxO also held some native tokens (leftovers
     from earlier testing). The three script txs (borrow/repay/unlock) failed with
     `ConwayUtxowFailure (… CollateralContainsNonADA …)` because Mesh tried to use that mixed UTxO as
     the Cardano *script collateral*. Fix was trivial — split off a pure-ADA UTxO with a one-off
     self-payment first — but the CLI doesn't do this for you, and the error is opaque. A line in the
     run instructions ("fund the wallet with at least one pure-ADA UTxO for collateral") would save the
     next person 20 minutes.
  2. **Blockfrost UTxO-index lag between steps.** After a tx confirms in a block, Blockfrost's
     address-UTxO view lags a few seconds, so firing the next step immediately intermittently fails
     (`All inputs are spent` / stale input). `wait.mjs` only checks "tx is in a block", not "UTxO set
     updated". A ~15–20s settle (or a retry) between steps fixes it. Worth either baking a short settle
     into `wait.mjs` or noting it in the run steps.

---

## Part E — Assessment

- Does the on-chain verification convince you the proofs are actually checked by the validator
  (not just off-chain / trusted)? (Y/N + why): **Y, and Part D removed my last bit of doubt.** Four
  independent things line up: (1) the Aiken test exercises the very helper the validators call and
  shows a valid proof → `true`, a tampered signal → `false`; (2) on-chain the public signals are
  *bound to chain state* (commitment from the referenced collateral UTxO, amounts cross-checked vs the
  pool delta), so you can't just feed the verifier convenient inputs; (3) the live borrow/repay/unlock
  spends carry no signature at all — if the proof weren't actually being checked, those UTxOs would be
  spendable by anyone, and they're not; (4) **I generated my own proofs from my own secret and the
  validator accepted them on-chain** (Part D) — so it's demonstrably verifying fresh SNARKs, not
  replaying the maintainer's. That's on-chain verification, not a trusted off-chain gate.
- Reproducibility (1=couldn't … 5=trivial): **Local tests 5/5** (aiken 2/2, gate 9/9, first try).
  **Live cycle 4/5** — it reproduces end-to-end and every tx is `valid_contract: true`, but I lost ~20
  min to the two operational gotchas in D-note (pure-ADA collateral + Blockfrost index lag). Neither is
  a protocol issue; both are CLI/ops rough edges that a couple of doc lines would smooth out.
- Issues / bugs found: **No protocol/validator bugs.** Operational only: (i) script txs fail with an
  opaque `CollateralContainsNonADA` if the wallet has no pure-ADA UTxO for collateral (D-note 1); (ii)
  Blockfrost UTxO-index lag between steps causes intermittent `All inputs are spent` (D-note 2); (iii)
  cosmetics — the gate's expected-error print (C-note 1) and the relative path in the Part C command
  block (C-note 2).
- Suggestions: document the pure-ADA-collateral prerequisite + bake a short settle/retry into
  `wait.mjs` (both from Part D); sequence diagram (B-1); surface the ExUnit headroom in MILESTONE3.md
  (B-2); annotate the expected error in the gate output (C-1); mark proof-tx fees as upper-bound in the
  evidence table caption, and note the retuned borrow/repay fees (~0.63 ADA) I measured (A / B-3).

### Overall verdict
- [x] Pass
- [ ] Pass with notes (list above)
- [ ] Fail (explain)

> Marking **Pass** — the core M3 claim (on-chain zk-SNARK verification of private collateral/loan
> txs) holds up under independent checking. All notes above are polish, not blockers.

**Signature / handle + date:** pinusch100 — 2026-08-26
