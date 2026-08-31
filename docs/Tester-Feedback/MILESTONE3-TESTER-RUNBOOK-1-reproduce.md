# M3 Tester Runbook 1 — Reproduce & verify (pinusch)

**Your role:** confirm the published evidence is real, and independently run the whole
private lending flow yourself from scratch. You are checking *reproducibility*, not
trying to break it (that's Runbook 2). Fill in every box and return this file as
`MILESTONE3-TESTER-FEEDBACK-<yourname>.md`.

**Tester:** name/handle · background · date · time spent:

---

## Part A — Check the published evidence (browser only, ~10 min)

Open each tx on **Preprod** cardanoscan (`https://preprod.cardanoscan.io/transaction/<hash>`)
and confirm it shows **Script/Contract: valid** (`valid_contract: true`).

| Step | Tx hash | valid? (Y/N) | Notes |
|---|---|---|---|
| Park VKeys | `ee6b270fdb93ec1720af401e67a6d7db2c5fe1304e4bbeeb9e1f6ee3871be0c3` | | |
| Init pool | `8a106cb2dda054ab783a289bcdc4123b8bb8a881879c53abbeb566a87e143ea4` | | |
| Deposit | `686989ff429a4ddcd89e61da07bda255c3b5b8d444f447a59912585335e99e17` | | |
| Set group root | `03c6e636545f95d4588b19139f6d3366fef7179964c5d1e0c4ce22f35f16aa84` | | |
| **Borrow** (ZK) | `f473f9c159c024d2b2c557f3fc06f8768833f155c0512a082645ad36213cad9d` | | |
| **Repay** (ZK) | `dfba747c872948cd3de5f0515e785f4f747c3fb78651357ea88aa2248ea2a89a` | | |
| **Unlock** (ZK) | `3af0d112eda2e92290532a1ac11da44844c7169969d48f1a0ab498c972905f69` | | |

Cross-check that the docs match the chain:
- [ ] Every link in `docs/MILESTONE3.md` / `docs/MILESTONE3-EVIDENCE.md` opens and is `valid`.
- [ ] Pool balance path is 100 → 90 (after borrow) → 100.5 (after repay, +interest).
- [ ] The borrow tx does **not** reference the collateral UTxO (privacy claim).
- [ ] The unlock tx has **no signature** authorizing the spend (only the script + proof).
- [ ] The 20 ADA collateral is released on unlock.

Anything that doesn't match, note it here:

---

## Part B — Run the whole flow yourself (turnkey, ~30–45 min)

You will deploy your **own** instance and run the full cycle with your **own** Preprod wallet.

**Setup**
1. `git clone <repo> && cd ZK-Defi-Protocol && git checkout m3-poa-v2`
2. Contracts: `cd contracts && aiken check` → expect **13 checks, 0 failed, 0 warnings**. Record the number you see: ____
3. Off-chain: `cd ../offchain && npm install`
4. Create a Preprod wallet, fund it from the faucet (https://docs.cardano.org/cardano-testnets/tools/faucet), and put its 24-word seed + a Blockfrost Preprod key in `.env`:
   - `ADMIN_WALLET_SEED="word1 word2 …"`
   - `PREPROD_BLOCKFROST_API_KEY="preprod…"`

**Run the cycle** (wait for each to confirm; `node cli/v5/wait.mjs <txHash>`):
```
node cli/v5/1-park-vkey.mjs
node cli/v5/2-init-pool.mjs
node cli/v5/3-deposit.mjs
node cli/v5/3b-setgrouproot.mjs
node cli/v5/4-borrow.mjs
node cli/v5/5-repay.mjs
node cli/v5/6-unlock.mjs
```

Record YOUR tx hashes and confirm each is `valid` on cardanoscan:

| Step | Your tx hash | valid? |
|---|---|---|
| Park | | |
| Init | | |
| Deposit | | |
| Set root | | |
| Borrow | | |
| Repay | | |
| Unlock | | |

- [ ] `aiken check` passed with 13/13.
- [ ] All 7 of your own txs are `valid_contract: true`.
- [ ] The borrow paid you the loan; the unlock returned your collateral.

---

## Part C — Verdict

- Did the published evidence check out? (Y/N + notes)
- Could you reproduce the full cycle independently? (Y/N + notes)
- Docs clear enough to follow without help? (1–5 + what was missing)
- Anything confusing, broken, or that looked wrong:
