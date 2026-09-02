# ZK Private-Lending Protocol

A zero-knowledge lending/borrowing protocol on Cardano. Each loan, repayment and
collateral unlock is authorized by a Groth16 zk-SNARK proof verified **on-chain** by
Aiken validators — the borrower proves, in zero knowledge, that they know the secret
behind a sufficiently-collateralized deposit, **without exposing that secret** and
without a signature.

## Milestone 3 status

Milestone 3 is **complete and live on Cardano Preprod**:

- On-chain Groth16 (BLS12-381) verification working inside the Aiken validators.
- The full lifecycle runs end-to-end on Preprod:
  **park verification keys → init pool → deposit → set group root → borrow → repay → unlock**.

Evidence and details:

- [docs/MILESTONE3.md](docs/MILESTONE3.md)
- [docs/MILESTONE3-EVIDENCE.md](docs/MILESTONE3-EVIDENCE.md)
- [docs/MILESTONE3-TEST-RESULTS.md](docs/MILESTONE3-TEST-RESULTS.md)
- [docs/Tester-Feedback/](docs/Tester-Feedback/)

### Deployed validators (Preprod)

| Validator | Script hash |
|-----------|-------------|
| `lending_pool_v5` | `75317267a9fa7d8fcb09c62d371bcf8160c7991eba6637c221f22ff2` |
| `collateral_v5`   | `f2813e76cfb431d80ad5a50682e16d64524c6c3372b6bee4800f881d` |

### On-chain transactions (Cardanoscan, Preprod) — all `valid_contract: true`

| Step | Transaction |
|------|-------------|
| Park verification keys | [880446043ab5…](https://preprod.cardanoscan.io/transaction/880446043ab5345038b03f31705082d8dbeb8b5929a31bfe92bbeae9caddc211) |
| Init pool | [9aa40d4f1364…](https://preprod.cardanoscan.io/transaction/9aa40d4f1364fe47bf71df256bc5f0b062cb32284491635fc24ef4c1fd09332c) |
| Deposit collateral | [fd6ace7bd7dc…](https://preprod.cardanoscan.io/transaction/fd6ace7bd7dcf3e436611fabcfa5dcd087f29f70aa6327624e1ecff3917900b5) |
| Set group root (admin) | [9737b260bd2f…](https://preprod.cardanoscan.io/transaction/9737b260bd2fcf0a4bfd583a9e7e5096f0c9e5c077a459b55525aa8b3252de02) |
| Borrow (ZK membership proof verified on-chain) | [8bc3d205f67e…](https://preprod.cardanoscan.io/transaction/8bc3d205f67eaa6d965e2f59e24210abba4251bbba2ae31e96f13507b5fc45b9) |
| Repay (self-appends R to repaid set) | [f8756c92addb…](https://preprod.cardanoscan.io/transaction/f8756c92addb71fae26c6bdf160be3028266825199b5acf53d202bd89d316a38) |
| Unlock collateral (settlement proof) | [43f4339ea8aa…](https://preprod.cardanoscan.io/transaction/43f4339ea8aac1d34bb14581e02aaabcc3f2e23ce15dd2f1c30118a805f02521) |

## How it works

1. **Deposit** — the borrower locks collateral and records a Poseidon
   commitment `commitment = Poseidon255(collateral_amount, secret)`. The commitment
   joins an on-chain anonymity set (a Merkle root).
2. **Borrow** — the borrower generates a Groth16 proof that their commitment is a
   **member** of the set and is sufficiently collateralized
   (`collateral_amount·100 ≥ loan_amount·collateral_ratio`) — without revealing which
   deposit it is. The lending-pool validator verifies the proof on-chain and releases
   the loan. Public signals: `[group_root, loan_nullifier, loan_amount, collateral_ratio,
   external_nullifier]`.
3. **Repay** — the borrower repays principal + interest, settles the loan nullifier, and
   self-appends a distinct repayment nullifier `R` into an append-only repaid set (a ZK
   append proof — permissionless, no admin).
4. **Unlock** — the borrower proves, in zero knowledge, membership of the private `R` in
   the repaid set (settlement proof). Its public signals `[commitment, repaid_root,
   repay_external_nullifier]` share nothing with the borrow, so borrow ↔ unlock cannot be
   linked. The secret is never revealed on any path.

## Tech stack

- **On-chain:** [Aiken](https://aiken-lang.org/), with Groth16 verification via
  [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381) (BLS12-381).
- **Circuits:** [circom](https://docs.circom.io/) + Groth16 (snarkjs), Poseidon
  hash over the BLS12-381 scalar field.
- **Off-chain:** [Mesh](https://meshjs.dev/) transaction building (Node.js).

## Repository layout

```
circuits/            circom circuit + proving/verification keys + gate tests
contracts/           Aiken v5 validators, on-chain ZK verification + tests
offchain/cli/v5/     Mesh scripts driving the full Preprod lifecycle
docs/                Milestone 3 evidence and tester-feedback template
```

## Build & test

Prerequisites: [Aiken](https://aiken-lang.org/installation-instructions),
Node.js 18+, and (to recompile circuits) circom + snarkjs.

```bash
# On-chain: compile validators and run the ZK on-chain tests
cd contracts && aiken build && aiken check      # 2/2 tests pass

# Circuits: end-to-end Groth16 proof gate
node circuits/tests/gate-bls12381.cjs           # 9/9 checks pass
```

> The proving key (`circuits/keys/collateral_proof_final.zkey`, ~788 KB) **is
> committed** for turnkey testing (via a `!` negation in `.gitignore`); the large
> Powers-of-Tau file is gitignored — see `circuits/keys/README.md` to regenerate
> it. The committed `verification_key.json` is what the on-chain validators check
> against and must correspond to the committed `.zkey`.

## Run the protocol (Preprod)

```bash
cd offchain
cp ../.env.example ../.env      # then fill in your Blockfrost key + wallet seed
npm install

node cli/v5/1-park-vkey.mjs     # park the verification key
node cli/v5/2-init-pool.mjs     # initialize the lending pool
node cli/v5/3-deposit.mjs       # deposit collateral
node cli/v5/4-borrow.mjs        # borrow (ZK proof verified on-chain)
node cli/v5/5-repay.mjs         # repay the loan
node cli/v5/6-unlock.mjs        # unlock the collateral
```

Each step reads `PREPROD_BLOCKFROST_API_KEY` and `ADMIN_WALLET_SEED` from `.env`
and writes a receipt (with the tx hash) under `offchain/cli/v5/receipts/`.
