# Circuit Tests

Test scripts for the `collateral_proof` ZK circuit (Groth16 over BLS12-381).

## Files

### `gate-bls12381.cjs` — end-to-end proof gate

Proves a valid collateral case, verifies it with snarkjs, and asserts the
on-chain-relevant facts:

- Groth16 verification succeeds for a valid witness.
- Exactly 3 public signals: `[commitment, loan_amount, collateral_ratio]`.
- The verification key uses the `bls12381` curve.
- The Poseidon (BLS12-381) commitment is deterministic.
- A tampered public signal makes verification fail.
- An under-collateralized input is rejected at proof generation.

Run it:

```bash
node tests/gate-bls12381.cjs
```

Expected output:

```
GATE RESULT: 9 passed, 0 failed
```

### `gen-onchain-fixture.cjs` — on-chain fixture generator

Generates a serialized proof + public signals fixture in the format consumed by
the Aiken on-chain tests (`contracts/lib/zk_onchain_test.ak`).

```bash
node tests/gen-onchain-fixture.cjs
```

## Prerequisites

The gate reads the compiled circuit and proving key:

- `circuits/collateral_proof_js/collateral_proof.wasm` (compile the circuit)
- `circuits/keys/collateral_proof_final.zkey` (gitignored — generate locally)
- `circuits/keys/verification_key.json` (committed)

See `../keys/README.md` for key generation.

## Gitignored artifacts

Generated proofs, witnesses, and public-signal files are gitignored. Only the
committed sources (`gate-bls12381.cjs`, `gen-onchain-fixture.cjs`, this README)
are tracked.
