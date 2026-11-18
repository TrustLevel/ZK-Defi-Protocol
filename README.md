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
| `pool_nft` (minting policy) | `4346c33b38b46f5b34b60b86bc9ba4ea55f392a3c4cc4cafd060c6ce` |
| `lending_pool_v5` | `8b15840cc3feac88fb000d4ffe25a108aaba37d4786161719d4d25ea` |
| `collateral_v5`   | `45b1b0147e0e9d3b0c87f53cfd482ad17170ed0654056207b9503c0c` |

### On-chain transactions (Cardanoscan, Preprod) — all `valid_contract: true`

| Step | Transaction |
|------|-------------|
| Park verification keys | [edbfae0e6704…](https://preprod.cardanoscan.io/transaction/edbfae0e6704086b0f9feddf30c83544c10406faf729792ba57bbdc4b2be1132) |
| Init pool + mint pool NFT | [e2ecaa36399f…](https://preprod.cardanoscan.io/transaction/e2ecaa36399f9732f6c56b76489ae58d7b5beaa6aa69a0150ce6ef26b1b5390e) |
| Deposit collateral (append proof into the commitment set) | [e63eeaab7526…](https://preprod.cardanoscan.io/transaction/e63eeaab75266f138bf283a705ce741da3c2e805104e2fe18889668be4b7fbc1) |
| Borrow (ZK membership proof verified on-chain, recipient-bound) | [8be8d71a2950…](https://preprod.cardanoscan.io/transaction/8be8d71a29509f9446aff7d668181470a92e5741af9a8d966cdeee232a468bf1) |
| Repay (repay proof binds R; appends R to repaid set) | [fad24d65ede8…](https://preprod.cardanoscan.io/transaction/fad24d65ede8b625ebe6a7f22684fcdb33803f50b5445c1d72ee857ca869cf60) |
| Unlock collateral (settlement proof) | [64f9e36847b7…](https://preprod.cardanoscan.io/transaction/64f9e36847b7774a69714f944f448c0496795eaa2621c80c83e02324b48584b9) |

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
3. **Repay** — the borrower repays exactly principal + interest with a repay proof that
   derives the loan nullifier and a distinct repayment nullifier `R` from the same
   secret, settles the loan, and appends that `R` into an append-only repaid set (a ZK
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
cd contracts && aiken build && aiken check      # 54/54 tests pass

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

node cli/v5/1-park-vkey.mjs     # park the four verification keys
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
