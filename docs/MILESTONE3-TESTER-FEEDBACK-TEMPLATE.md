# Milestone 3 — Independent Tester Feedback

**Purpose:** Two independent testers each complete one copy of this form. The goal is to
independently verify Milestone 3's core claim — *zk-SNARK proofs are verified **on-chain** for
private collateral + lending/borrowing transactions* — and to assess reproducibility and clarity.

**How to use:** Copy this file to `MILESTONE3-TESTER-FEEDBACK-<yourname>.md`, fill every section,
and return it. Parts A and B require no setup (just a browser). Parts C and D are optional deeper
checks for technically-inclined testers.

---

## Tester
- Name / handle:
- Background (dev / cardano / zk / non-technical):
- Date (YYYY-MM-DD):
- Time spent:

---

## Part A — Verify the on-chain evidence (no setup, ~10 min)

Open each transaction on Cardano **Preprod** cardanoscan and confirm it shows **Script/Contract:
valid** (`valid_contract: true`). These are the six transactions of one full private cycle.

| Step | Tx hash | Confirmed valid? (Y/N) | Notes |
|---|---|---|---|
| VKey park | `b3da94815002b9339390d76491b961da161595c18ff31ce0f1ea2ecbf9001c8e` | | |
| Pool init | `1be3c892140bac8b6ed0db3d5e90ff71a21aed86edf2dfe1de53837a4a52c0f9` | | |
| Deposit collateral | `34f216e73ac4a209a9d392c34ca8e7df6e2ec2a5859d217fe747843ab8747a8a` | | |
| **Borrow** (ZK verified) | `19d9016ad95c3c410e8d66ce469a3f5e4cf2b329380555993fa1028110bb2b37` | | |
| **Repay** (ZK verified) | `8b934c059ab1d352f47277181bb871875907dd34c5506b1e75ac7a8e44a76cf6` | | |
| **Unlock** (ZK verified) | `24281542de3ab7e71e5a683917bd053d5a698ae2dfbf8daac0cf2346771ed609` | | |

URL pattern: `https://preprod.cardanoscan.io/transaction/<hash>`

Sanity check the economics across the cycle (pool 100 → 90 after borrow → 100 after repay):
- [ ] Borrow moved 10 ADA out of the pool
- [ ] Repay returned 10 ADA to the pool
- [ ] Collateral (20 ADA) was released on unlock

**A. Notes / anything that didn't match:**

---

## Part B — Documentation review (no setup, ~15 min)

Read `docs/MILESTONE3.md` (protocol + zk-proof mechanism), `docs/MILESTONE3-TEST-RESULTS.md`,
and `docs/MILESTONE3-EVIDENCE.md`.

- Is it clear **what** is proven and **how** the proof is verified on-chain? (1=unclear … 5=very clear): 
- Could you explain the deposit→borrow→repay→unlock flow after reading? (Y/N):
- Is the "proof is the authorization, no admin signature" design understandable? (Y/N):
- **B. Notes / unclear points / suggested doc improvements:**

---

## Part C — Run the tests locally (optional, ~20 min)

Prereqs: `aiken`, `node`, repo cloned. From the repo root:

```
cd contracts && aiken check        # expect: 2/2 tests pass (on-chain groth_verify)
cd .. && node circuits/tests/gate-bls12381.cjs   # expect: 9/9 pass (off-chain proof gate)
```

| Check | Expected | Your result | Notes |
|---|---|---|---|
| `aiken check` | 2 passed / 0 failed | | |
| off-chain proof gate | 9 passed / 0 failed | | |

Edge cases these tests cover — confirm you see them:
- [ ] Tampered public signal → on-chain verify returns **false**
- [ ] Insufficient collateral → proof generation **rejected**

**C. Notes:**

---

## Part D — Reproduce a fresh cycle on Preprod (optional, advanced)

Using your own Preprod Blockfrost key + a funded Preprod wallet, run the scripts in
`offchain/cli/v5/` (park-vkey → init-pool → deposit → borrow → repay → unlock). Record your own
tx hashes.

- Did a fresh borrow/repay confirm with `valid_contract: true`? (Y/N):
- Your tx hashes:
- **D. Notes / any blockers:**

---

## Part E — Assessment

- Does the on-chain verification convince you the proofs are actually checked by the validator
  (not just off-chain / trusted)? (Y/N + why):
- Reproducibility (1=couldn't … 5=trivial):
- Issues / bugs found:
- Suggestions:

### Overall verdict
- [ ] Pass
- [ ] Pass with notes (list above)
- [ ] Fail (explain)

**Signature / handle + date:**
