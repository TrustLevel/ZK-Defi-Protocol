# Milestone 3 — Private Lending with On-Chain zk-SNARK Verification

**Catalyst proposal:** 1300196 (internal 1012)
**Deliverable:** zk-SNARK proofs *verifiable on-chain* for private verification of
collateral and loan transactions — without revealing the underlying secret.
**Status:** Delivered and demonstrated live on Cardano **Preprod**.

---

## 1. Protocol overview

The ZK-DeFi-Protocol lets a user borrow against locked collateral **anonymously**:
the on-chain contracts authorize each loan/repayment/unlock with a real Groth16
zk-SNARK proof instead of a signature. The proof attests, in zero knowledge, that
the spender knows the secret behind a collateral commitment and that the collateral
is sufficient for the requested amount — **without revealing the secret or the exact
collateral amount**.

Two Plutus V3 validators implement the protocol (`contracts/validators/v5/`):

| Validator | Address hash (Preprod) | Role |
|---|---|---|
| `lending_pool_v5` | `0686aaaf136fde2af6aa1f78af30bc67d0aa410461c4bfb5877eb199` | Holds pool liquidity; authorizes `BorrowAnonymous` / `RepayAnonymous` via on-chain proof |
| `collateral_v5` | `f88347ff9ee0ffbdbb575d94c76803ca319e1471fe2c2697ce852aef` | Holds user collateral with a commitment; authorizes `UnlockDeposit` via on-chain proof |

The verification key is parked once as an inline datum on an **unspendable
(always-false) UTxO** and consumed only as a **read-only reference input** by every
proof-verifying transaction.

### The full private lending cycle (all confirmed live on Preprod)

1. **Park VKey** — publish the Groth16 verification key as an inline datum on an
   always-false UTxO. Referenced (never spent) by every later proof tx.
2. **Init pool** — create the pool UTxO with `PoolDatumV5` (liquidity,
   `collateral_ratio`, and the `vkey_ref` OutputReference pointing at the parked VKey).
3. **Deposit** — lock collateral at `collateral_v5` with
   `DepositDatumV5 { owner, collateral_amount, commitment, timestamp }`, where
   `commitment = Poseidon255(collateral_amount, secret)`. The secret never leaves the
   depositor.
4. **Borrow** — spend the pool UTxO with `BorrowAnonymous { collateral_ref, proof,
   loan_amount }`. The validator reads the commitment from the referenced collateral
   UTxO and the VKey from the reference input, then runs
   `groth_verify(vkey, proof, [commitment, loan_amount, collateral_ratio])` **on-chain**.
   No signature. The loan is paid out; the pool datum's `total_borrowed` increases.
5. **Repay** — spend the (post-borrow) pool UTxO with `RepayAnonymous { deposit_ref,
   proof, repay_amount }`; the same on-chain proof re-attests ownership and binds the
   repayment amount. Pool value increases; `total_borrowed` decreases.
6. **Unlock** — spend the deposit UTxO at `collateral_v5` with
   `UnlockDeposit { proof, vkey_ref }`. The proof attests knowledge of the secret
   behind the commitment (public signals `[commitment, collateral_amount, 100]`,
   `unlock_ratio = 100` so the sufficiency constraint holds with equality). Collateral
   is freed **with no signature** — a pure zero-knowledge unlock.

Off-chain drivers (Mesh, Node ESM): `offchain/cli/v5/{1-park-vkey,2-init-pool,
3-deposit,4-borrow,5-repay,6-unlock}.mjs`, shared helpers in
`offchain/cli/v5/common.mjs`.

---

## 2. zk-proof generation mechanism

### Circuit — `circuits/collateral_proof.circom`

`ProveOwnership` proves possession of a sufficiently-collateralized commitment
without revealing the secret or the exact collateral amount.

**Public inputs (signals):** `[commitment, loan_amount, collateral_ratio]`
**Private inputs (witness):** `secret`, `collateral_amount`

**Constraints:**
1. `commitment === Poseidon255(collateral_amount, secret)` — knowledge of the
   pre-image of the on-chain commitment.
2. `collateral_amount * 100 >= loan_amount * collateral_ratio` — sufficiency
   (via `GreaterEqThan(64)`). Scaling by 100 keeps ratios integral.
3. Range checks (`Num2Bits`): `collateral_amount` and `loan_amount` fit 64 bits,
   `collateral_ratio` fits 16 bits, `secret` fits 254 bits — preventing field-overflow
   attacks.

### Curve, hash, and trusted setup — **BLS12-381**

Cardano's on-chain Groth16 builtins are **BLS12-381 only**, so the circuit was
migrated from BN254 to BLS12-381 and the commitment hash uses **Poseidon255**
(`poseidon-bls12381`), keeping the on-chain and off-chain commitment identical.

- Compile: `circom --prime bls12381 -l .`
- Trusted setup: fresh BLS12-381 powers-of-tau → `groth16 setup` → contribution →
  `circuits/keys/collateral_proof_final.zkey` + `circuits/keys/verification_key.json`
  (`protocol: groth16`, `curve: bls12381`, `nPublic: 3`, 4 IC points).
- Proof generation (off-chain, snarkjs): `snarkjs.groth16.fullProve(input, wasm, zkey)`
  → `groth16.verify` sanity check → **point compression** (G1 48 bytes, G2 96 bytes,
  compressed-flag/sign-bit encoding matching ak-381) into the on-chain `Proof` type.
  See `offchain/cli/v5/common.mjs` (`generateProof`, `compressedG1/G2`).

The **same secret** produced at deposit time is reused (from the deposit receipt) to
generate borrow, repay, and unlock proofs — so all four proofs verify against the one
on-chain commitment.

---

## 3. On-chain verification design

- **Generic Groth16 verifier (reused, not rebuilt):** `modulo-p/ak-381` v0.1.1 provides
  `groth_verify(vk, proof, public: List<Int>)` for BLS12-381. Wrapped by
  `contracts/lib/zk.ak` `verify_collateral_proof`, which calls
  `groth_verify(vkey, proof, [commitment, loan_amount, collateral_ratio])`.
- **VKey as reference input:** `get_vkey(tx, vkey_ref)` resolves the verification key
  from the inline datum of the reference input pinned by the pool datum's `vkey_ref`
  (or the unlock redeemer's `vkey_ref`). The VKey UTxO lives at an always-false address
  and is never spent — a trusted, immutable key source set once at pool init.
- **Public-signal binding to on-chain state (anti-replay / anti-forgery):** the
  validator does **not** trust redeemer-supplied public signals blindly:
  - `commitment` is read from the referenced collateral UTxO's datum, not the redeemer.
  - `loan_amount` / `repay_amount` from the redeemer are cross-checked against the pool
    value delta and `total_borrowed` update (`pool_decreased_correctly`,
    `pool_increased_correctly`, `datum_updated`).
  - `collateral_ratio` comes from the pool datum (protocol config).
- **No admin signature / `extra_signatories`:** the zk-SNARK proof *is* the
  authorization. This is the key architectural difference from the dead-end V3
  (admin-sig, which broke the off-chain builder) and V4 (no-sig, no security).
- **Reused proof-generation library:** the BLS12-381 circuit + trusted-setup keys
  (`circuits/`) together with `ak-381`'s verifier constitute the zk-SNARK library
  stack; `poseidon-bls12381` supplies the matched off-chain/in-circuit hash.

---

## 4. Deployed addresses / hashes (Preprod)

| Component | Value |
|---|---|
| `lending_pool_v5` script hash | `0686aaaf136fde2af6aa1f78af30bc67d0aa410461c4bfb5877eb199` |
| `collateral_v5` script hash | `f88347ff9ee0ffbdbb575d94c76803ca319e1471fe2c2697ce852aef` |
| Compiler | Aiken v1.1.15, Plutus V3 |
| Verifier lib | `modulo-p/ak-381` v0.1.1 |
| Circuit / setup | BLS12-381, Groth16, Poseidon255, 3 public signals |

Live transaction hashes are listed in `docs/MILESTONE3-TEST-RESULTS.md` and
`docs/MILESTONE3-EVIDENCE.md`.


