# ZK Private-Lending Protocol

A zero-knowledge lending/borrowing protocol on Cardano. Each deposit, loan, repayment
and collateral unlock is authorized by a Groth16 zk-SNARK proof verified **on-chain**
by Aiken validators. The borrower proves, in zero knowledge, that they know the secret
behind a sufficiently-collateralized deposit, **without exposing that secret**, and
there is no admin and no signature on any path.

## Milestone 3 status

Milestone 3 is **complete and live on Cardano Preprod**:

- On-chain Groth16 (BLS12-381) verification working inside the Aiken validators.
- The full lifecycle runs end-to-end on Preprod:
  **park verification keys → init pool (mint pool NFT) → deposit → borrow → repay → unlock**.

Evidence and details:

- [docs/MILESTONE3.md](docs/MILESTONE3.md)
- [docs/MILESTONE3-EVIDENCE.md](docs/MILESTONE3-EVIDENCE.md)
- [docs/MILESTONE3-TEST-RESULTS.md](docs/MILESTONE3-TEST-RESULTS.md)
- [docs/Tester-Feedback/](docs/Tester-Feedback/)

### Deployed scripts (Preprod)

| Script | Hash |
|-----------|-------------|
| `pool_nft` (minting policy) | `586a933cb6c1ece99d373e106ff38b4c430d0e606541c8635c0cf049` |
| `lending_pool_v5` | `d99ee5039b3b4c3792358482404bffc24e7194cf21c7c30028e01ba7` |
| `collateral_v5`   | `0fb3482637d024566f70fc43ed09a6178a545fa281e55e72082c44fe` |

### On-chain transactions (Cardanoscan, Preprod) — all `valid_contract: true`

| Step | Transaction |
|------|-------------|
| Park verification keys | [3e018c9063f1…](https://preprod.cardanoscan.io/transaction/3e018c9063f1c37954079b79285be7bd534efb12dc98f77ad025dffc28790316) |
| Init pool + mint pool NFT | [5702c1512ad0…](https://preprod.cardanoscan.io/transaction/5702c1512ad0cf4b19009da3995d21675df6b9920ed047af9631382713ac0d30) |
| Deposit collateral (append proof into the commitment set) | [7fa28e7d56fd…](https://preprod.cardanoscan.io/transaction/7fa28e7d56fd7e6060f97d6b9504a7da7dc35bebb5a275e902f5b3b794e6f556) |
| Borrow (ZK membership proof verified on-chain, recipient-bound) | [d16503550d1c…](https://preprod.cardanoscan.io/transaction/d16503550d1c822f5a6adaa832c69db4c4f0abfdb0eab1676e4635e89eb2a501) |
| Repay (self-appends R to repaid set) | [8fafa79d6bc4…](https://preprod.cardanoscan.io/transaction/8fafa79d6bc47e6ce215704a5690bae18efcf89c59d3abc1bf8b4110021ea983) |
| Unlock collateral (settlement proof) | [046baceaccbe…](https://preprod.cardanoscan.io/transaction/046baceaccbe8a7ac9e426655a5cfe5b997fd0ddc430cc6c5033f99e5f021b4a) |

## How it works

0. **Init** — the pool is created together with a one-shot NFT; the validators
   recognise the real pool by it.
1. **Deposit** — the depositor locks exactly one collateral unit (20 ADA) through the
   pool with a Poseidon commitment `commitment = Poseidon255(collateral_amount, secret)`
   and a ZK append proof that inserts it into the on-chain anonymity set (a Merkle
   root). Permissionless, no admin.
2. **Borrow** — the borrower generates a Groth16 proof that their commitment is a
   **member** of the set and is sufficiently collateralized
   (`collateral_amount·100 ≥ loan_amount·collateral_ratio`) — without revealing which
   deposit it is. The lending-pool validator verifies the proof on-chain and pays the
   fixed loan to the recipient key the proof is bound to. Each deposit backs exactly
   one loan. Public signals: `[group_root, loan_nullifier, loan_amount,
   collateral_ratio, external_nullifier, recipient]`.
3. **Repay** — the borrower repays exactly principal + interest, settles the loan nullifier, and
   self-appends a distinct repayment nullifier `R` into an append-only repaid set (a ZK
   append proof — permissionless, no admin).
4. **Unlock** — the borrower proves, in zero knowledge, membership of the private `R` in
   the repaid set (settlement proof). Its public signals `[commitment, repaid_root,
   repay_external_nullifier]` share nothing with the borrow, so borrow ↔ unlock cannot be
   linked. The collateral is paid to the address fixed at deposit. The secret is never
   revealed on any path.

## Tech stack

- **On-chain:** [Aiken](https://aiken-lang.org/), with Groth16 verification via
  [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381) (BLS12-381).
- **Circuits:** [circom](https://docs.circom.io/) + Groth16 (snarkjs), Poseidon
  hash over the BLS12-381 scalar field.
- **Off-chain:** [Mesh](https://meshjs.dev/) transaction building (Node.js).

## Repository layout

```
circuits/            circom circuits + proving/verification keys + fixture/gate tests
contracts/           Aiken validators (pool NFT, pool, collateral), on-chain ZK verification + tests
offchain/cli/v5/     Mesh scripts driving the full Preprod lifecycle
docs/                Milestone 3 documentation, evidence, tester reports
```

## Build & test

Prerequisites: [Aiken](https://aiken-lang.org/installation-instructions),
Node.js 18+, and (to recompile circuits) circom + snarkjs.

```bash
# On-chain: compile validators and run the ZK on-chain tests
cd contracts && aiken build && aiken check      # 49/49 tests pass

# Borrow circuit: proof + tampered-signal checks
cd offchain/cli && node v5/test-semaphore-proof.mjs
```

> The proving keys (`circuits/keys/*_final.zkey`) **are committed** for turnkey
> testing, together with the `verification_key_*.json` files the deployed vkey UTxOs
> hold. A fresh trusted setup produces new keys whose proofs do not verify against
> the deployed ones — see `circuits/keys/README.md`.

## Run the protocol (Preprod)

```bash
cd offchain
cp ../.env.example ../.env      # then fill in your Blockfrost key + wallet seed
npm install

node cli/v5/1-park-vkey.mjs     # park the three verification keys
node cli/v5/2-init-pool.mjs     # initialize the pool + mint the pool NFT
node cli/v5/3-deposit.mjs       # deposit collateral through the pool
node cli/v5/4-borrow.mjs        # borrow (ZK proof verified on-chain)
node cli/v5/5-repay.mjs         # repay the loan
node cli/v5/6-unlock.mjs        # unlock the collateral
# between steps: node cli/v5/wait.mjs <txHash>
```

Each step reads `PREPROD_BLOCKFROST_API_KEY` and `ADMIN_WALLET_SEED` (the wallet seed)
from `.env` and writes a receipt (with the tx hash) under `offchain/cli/v5/receipts/`;
`2-init-pool` writes `deployment.json`, from which every later step derives the
scripts. Optional: `RECIPIENT_ADDRESS` (loan payout) and `UNLOCK_TO_ADDRESS`
(collateral payout) — key addresses, default the wallet.
