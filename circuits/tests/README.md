# Circuit Tests

Tests and fixture generators for the five Groth16 circuits (BLS12-381).

## Tests

| File | What it checks |
|---|---|
| `collateral-circuits.test.mjs` | Borrow, repay and settlement: real proofs verify and expose exactly the documented public signals; a changed signal fails; a wrong secret, a leaf outside the set and a nullifier from another scope cannot produce a witness; a borrow proof does not verify as a repay proof; an unlock without repayment cannot produce a witness. |
| `lender-withdraw.test.mjs` | Lender withdraw: the same checks for the note set and the withdraw nullifier. |

```bash
cd circuits && npm install && npm test
```

## Fixture generators

| File | Writes |
|---|---|
| `gen-semaphore-fixture.cjs` | `contracts/lib/semaphore_onchain_test.ak`: real borrow, repay, settlement and append proofs with their verification keys, verified on-chain by `aiken check` |
| `gen-lender-fixture.cjs` | `contracts/lib/lender_onchain_test.ak`: real lender append and withdraw proofs |

```bash
cd circuits && npm run gen-fixtures && cd ../contracts && aiken check
```

Both read the compiled witness generators (`*_js/*.wasm`) and the proving keys in
`circuits/keys/`.
