# ZK Private-Lending Protocol

A zero-knowledge lending and borrowing protocol on Cardano. Lenders add liquidity and
withdraw it with the interest it earned; borrowers deposit collateral, borrow against
it, repay and reclaim the collateral. Every action is authorized by a Groth16
zk-SNARK proof verified **on-chain** by Aiken validators. There is no admin and no
signature on any path: the proof is the authorization.

## Milestone 3

Milestone 3 (zk-SNARK Integration for Private Transactions) is **live on Cardano
Preprod**:

- Five BLS12-381 Groth16 circuits (append, borrow, repay, settlement, lender
  withdraw), each verified on-chain inside the validators.
- Anonymous lending and private borrowing: deposit ↔ borrow, borrow ↔ unlock and
  liquidity deposit ↔ withdrawal cannot be linked.
- A pool lends ADA or a native token and accepts several collateral assets in one
  commitment set. Every amount is a fixed denomination of the pool, and nothing in a
  loan names the deposit or the asset behind it.
- A relayer can submit borrow, unlock and withdrawal without being able to redirect
  funds.
- Two pools (one lending ADA, one lending a native token) ran the full cycle on Preprod.

Documentation and evidence:

- [docs/MILESTONE3.md](docs/MILESTONE3.md): protocol, privacy model, proof generation,
  on-chain verification, deployment (§4), security model, note to reviewer (§7)
- [docs/MILESTONE3-EVIDENCE.md](docs/MILESTONE3-EVIDENCE.md): evidence index
- [docs/MILESTONE3-TEST-RESULTS.md](docs/MILESTONE3-TEST-RESULTS.md): pass/fail rates,
  edge cases, every Preprod transaction, performance
- [docs/Tester-Feedback/](docs/Tester-Feedback/): independent tester reports

## How it works

1. **Lend.** A lender buys one pool share at the current share price and appends a
   note leaf `Poseidon255(LENDER_LEAF_TAG, secret)` to the lender set with a ZK append
   proof.
2. **Deposit.** A depositor locks exactly the fixed denomination of an accepted
   collateral asset and appends the commitment `Poseidon255(COLLATERAL_LEAF_TAG,
   secret)` to the collateral set (a Merkle root) with a ZK append proof.
3. **Borrow.** The borrower proves that they own **some** member of the collateral set,
   without revealing which one or its asset. The pool pays the fixed loan to the key
   the proof is bound to; the loan nullifier allows one loan per deposit. Public
   signals: `[group_root, loan_nullifier, external_nullifier, recipient]`.
4. **Repay.** The borrower pays principal + interest with a repay proof that derives
   the loan nullifier and a distinct repayment nullifier `R` from the same secret,
   settles the loan and appends `R` to the repaid set.
5. **Unlock.** A settlement proof shows, in zero knowledge, that the private `R` is in
   the repaid set. It shares no public value with the borrow. The collateral goes to
   the address fixed at deposit.
6. **Withdraw.** A lender proves membership of their note in the lender set and reveals
   a one-time withdraw nullifier; the pool pays the current share price, principal
   plus earned interest, to the key the proof is bound to.

## Tech stack

- **On-chain:** [Aiken](https://aiken-lang.org/), with Groth16 verification via
  [`modulo-p/ak-381`](https://github.com/modulo-p/ak-381) (BLS12-381).
- **Circuits:** [circom](https://docs.circom.io/) + Groth16 (snarkjs), Poseidon
  hash over the BLS12-381 scalar field.
- **Off-chain:** [Mesh](https://meshjs.dev/) transaction building; the shared protocol
  module `packages/protocol` (Node.js and browser), a command line client and a
  reference relayer (`server/`).

## Repository layout

```
circuits/            circom circuits + proving/verification keys + fixture/gate tests
contracts/           Aiken validators (pool NFT, pool, collateral), on-chain ZK verification + tests
packages/protocol/   protocol module: commitments, Merkle trees, proof inputs, Plutus data,
                     transaction builders; Preprod deployments; golden tests
offchain/cli/m4/     command line client: every step, deploy, test tokens
server/              reference relayer and chain reader (used by the web app)
web/                 web app (Milestone 4)
docs/                Milestone 3 documentation, evidence, tester reports
```

## Build & test

Prerequisites: [Aiken](https://aiken-lang.org/installation-instructions),
Node.js 18+, and (to recompile circuits) circom + snarkjs.

```bash
# On-chain: compile validators and run the on-chain proof and validator tests
cd contracts && aiken build && aiken check      # 109/109 tests pass

# Circuits: real proofs, tampered signals, wrong witnesses
cd circuits && npm install && node --test tests/collateral-circuits.test.mjs tests/lender-withdraw.test.mjs

# Protocol module, incl. golden tests against the Preprod cycles
cd packages/protocol && npm install && npm test
```

> The proving keys (`circuits/keys/*_final.zkey`) **are committed** for turnkey
> testing, together with the `verification_key_*.json` files the deployed vkey UTxOs
> hold. A fresh trusted setup produces new keys whose proofs do not verify against
> the deployed ones — see `circuits/keys/README.md`.

## Run the protocol (Preprod)

```bash
cp .env.example .env            # then fill in your Blockfrost key + wallet seed
cd packages/protocol && npm install && cd ../../offchain && npm install && cd cli/m4

export DEPLOYMENT=../../../packages/protocol/deployments/preprod-m3-ada.json   # the deployed ADA pool
node run.mjs status
node run.mjs lend     --note l1                     # buy one pool share
node run.mjs deposit  --note c1 --asset 0           # lock 20 ADA (asset 1: 500 TOK)
node run.mjs borrow   --note c1 --to <address B>    # 10 ADA to B (submit as relayer)
node run.mjs repay    --note c1                     # 10.5 ADA, signed by B
node run.mjs unlock   --note c1                     # collateral back to the deposit's unlock_to
node run.mjs withdraw --note l1 --to <address P>    # one share to a fresh address P
```

The signer is the wallet named by `WALLET_SEED` (a variable in `.env`, default
`ADMIN_WALLET_SEED`) at account `WALLET_ACCOUNT`; borrow, unlock and withdraw can be
signed by any wallet, as a relayer. Notes (the secrets of deposits and shares) are
kept in `offchain/cli/m4/notes/`. `node run.mjs deploy --loan <ada|unit> --collateral
ada:20,<unit>:500` deploys a new pool; `mint-token` creates test tokens. See the
header of `run.mjs`.
