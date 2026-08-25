# ZK Circuit — Collateral Proof (BLS12-381)

Groth16 circuit for private borrowing. The proof is verified **on-chain** by the
Aiken v5 validators (see [`../contracts/`](../contracts/)), so it targets the
**BLS12-381** scalar field.

## What it proves

For a hidden `secret` and `collateral_amount`, the borrower proves:

1. `commitment == Poseidon255(collateral_amount, secret)`
2. `collateral_amount * 100 >= loan_amount * collateral_ratio`
3. the inputs are range-bounded (no field overflow)

- **Public inputs** (learned by the verifier): `commitment`, `loan_amount`, `collateral_ratio`
- **Private inputs** (witness): `secret`, `collateral_amount`

The verifier never learns the secret or the collateral amount. Poseidon over
BLS12-381 comes from `lib/poseidon255.circom` (from `poseidon-bls12381-circom`);
the comparators/range-checks come from circomlib.

**Size / performance:** ~1,100 constraints; proof generation ~0.4–0.7 s; on-chain
verification is well within Plutus V3 limits (exact ExUnits in
[`../docs/MILESTONE3-TEST-RESULTS.md`](../docs/MILESTONE3-TEST-RESULTS.md)).

## Prerequisites

- circom ≥ 2.2 (must support `--prime bls12381`)
- Node.js 18+, then `cd circuits && npm install`

## Compile

```bash
circom collateral_proof.circom --r1cs --wasm --sym --prime bls12381 -l . -l node_modules
```

This produces `collateral_proof.r1cs` and `collateral_proof_js/collateral_proof.wasm`
(both gitignored).

## Keys

`keys/verification_key.json` is committed; the proving key and Powers-of-Tau file
are gitignored. See [`keys/README.md`](keys/README.md) to regenerate them (and an
important note: a fresh setup produces a new key pair that will not match the
committed verification key / deployment).

## Test

```bash
npm test        # -> node tests/gate-bls12381.cjs  ->  9/9 checks pass
```

The gate proves a valid case, checks the three public signals + the BLS12-381
curve + determinism, and confirms that a tampered public signal fails and an
under-collateralized input is rejected. `tests/gen-onchain-fixture.cjs`
regenerates the Aiken on-chain proof fixture (`../contracts/lib/zk_onchain_test.ak`).

> The gate reads the compiled `collateral_proof_js/collateral_proof.wasm` and
> `keys/collateral_proof_final.zkey`, both gitignored — compile the circuit and
> regenerate the keys first (or obtain the committed artifacts from the maintainers).

## Layout

```
collateral_proof.circom        circuit source
lib/poseidon255*.circom        BLS12-381 Poseidon (committed)
keys/verification_key.json     committed vkey (proving key + ptau gitignored)
tests/                         gate test + on-chain fixture generator
```

## Security

Groth16 requires a trusted setup; the committed keys use a dev-only
single-contributor ceremony (see [`keys/README.md`](keys/README.md)) and are not
suitable for mainnet. A professional circuit audit is recommended before mainnet.

## References

- circom — https://docs.circom.io/
- snarkjs — https://github.com/iden3/snarkjs
- poseidon-bls12381-circom — https://github.com/modulo-p/poseidon-bls12381-circom
- Groth16 — https://eprint.iacr.org/2016/260
