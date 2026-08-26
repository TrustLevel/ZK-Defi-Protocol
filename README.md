# ZK Private-Lending Protocol

A privacy-preserving lending/borrowing protocol on Cardano. Borrowers prove —
in zero knowledge — that they have deposited sufficient collateral for a loan,
**without revealing the collateral amount, their secret, or which deposit they
are spending**. The proof is a Groth16 SNARK verified **on-chain** by Aiken
validators.

## Milestone 3 status

Milestone 3 is **complete and live on Cardano Preprod**:

- On-chain Groth16 (BLS12-381) verification working inside the Aiken validators.
- The full lifecycle runs end-to-end on Preprod:
  **park verification key → init pool → deposit → borrow → repay → unlock**.

Evidence and details:

- [docs/MILESTONE3.md](docs/MILESTONE3.md)
- [docs/MILESTONE3-EVIDENCE.md](docs/MILESTONE3-EVIDENCE.md)
- [docs/MILESTONE3-TEST-RESULTS.md](docs/MILESTONE3-TEST-RESULTS.md)
- [docs/Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-TEMPLATE.md](docs/Tester-Feedback/MILESTONE3-TESTER-FEEDBACK-TEMPLATE.md)

### Deployed v5 validators (Preprod)

| Validator | Script hash |
|-----------|-------------|
| `lending_pool_v5` | `0686aaaf136fde2af6aa1f78af30bc67d0aa410461c4bfb5877eb199` |
| `collateral_v5`   | `f88347ff9ee0ffbdbb575d94c76803ca319e1471fe2c2697ce852aef` |

### On-chain transactions (Cardanoscan, Preprod)

| Step | Transaction |
|------|-------------|
| Park verification key | [b3da9481…](https://preprod.cardanoscan.io/transaction/b3da94815002b9339390d76491b961da161595c18ff31ce0f1ea2ecbf9001c8e) |
| Init pool | [1be3c892…](https://preprod.cardanoscan.io/transaction/1be3c892140bac8b6ed0db3d5e90ff71a21aed86edf2dfe1de53837a4a52c0f9) |
| Deposit collateral | [34f216e7…](https://preprod.cardanoscan.io/transaction/34f216e73ac4a209a9d392c34ca8e7df6e2ec2a5859d217fe747843ab8747a8a) |
| Borrow (ZK proof verified on-chain) | [19d9016a…](https://preprod.cardanoscan.io/transaction/19d9016ad95c3c410e8d66ce469a3f5e4cf2b329380555993fa1028110bb2b37) |
| Repay | [8b934c05…](https://preprod.cardanoscan.io/transaction/8b934c059ab1d352f47277181bb871875907dd34c5506b1e75ac7a8e44a76cf6) |
| Unlock collateral | [24281542…](https://preprod.cardanoscan.io/transaction/24281542de3ab7e71e5a683917bd053d5a698ae2dfbf8daac0cf2346771ed609) |

## How it works

1. **Deposit** — the borrower locks collateral and records a Poseidon
   commitment `commitment = Poseidon(collateral_amount, secret)`.
2. **Borrow** — the borrower generates a Groth16 proof that, for a hidden
   `secret` and `collateral_amount`, the commitment is valid **and**
   `collateral_amount * 100 >= loan_amount * collateral_ratio`. The lending-pool
   validator verifies the proof on-chain and releases the loan.
3. **Repay / Unlock** — the borrower repays the loan and unlocks the collateral.

The verifier learns only the public signals `[commitment, loan_amount,
collateral_ratio]` — never the secret or the collateral amount.

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

> The proving key (`circuits/keys/collateral_proof_final.zkey`) and Powers-of-Tau
> file are gitignored due to size; see `circuits/keys/README.md` to regenerate
> them. The committed `verification_key.json` is what the on-chain validators
> check against.

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
