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
| Park VKeys | `880446043ab5345038b03f31705082d8dbeb8b5929a31bfe92bbeae9caddc211` | | |
| Init pool | `9aa40d4f1364fe47bf71df256bc5f0b062cb32284491635fc24ef4c1fd09332c` | | |
| Deposit | `fd6ace7bd7dcf3e436611fabcfa5dcd087f29f70aa6327624e1ecff3917900b5` | | |
| Set group root | `9737b260bd2fcf0a4bfd583a9e7e5096f0c9e5c077a459b55525aa8b3252de02` | | |
| **Borrow** (ZK) | `8bc3d205f67eaa6d965e2f59e24210abba4251bbba2ae31e96f13507b5fc45b9` | | |
| **Repay** (ZK, self-appends R) | `f8756c92addb71fae26c6bdf160be3028266825199b5acf53d202bd89d316a38` | | |
| **Unlock** (ZK settlement) | `43f4339ea8aac1d34bb14581e02aaabcc3f2e23ce15dd2f1c30118a805f02521` | | |

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
1. `git clone <repo> && cd ZK-Defi-Protocol && git checkout m3-poa-v3`
2. Contracts: `cd contracts && aiken check` → expect **17 checks, 0 failed, 0 warnings**. Record the number you see: ____
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

- [ ] `aiken check` passed with 17/17.
- [ ] All 7 of your own txs are `valid_contract: true`.
- [ ] The borrow paid you the loan; the unlock returned your collateral.

---

## Part C — Verdict

- Did the published evidence check out? (Y/N + notes)
- Could you reproduce the full cycle independently? (Y/N + notes)
- Docs clear enough to follow without help? (1–5 + what was missing)
- Anything confusing, broken, or that looked wrong:
