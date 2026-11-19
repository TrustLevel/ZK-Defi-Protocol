// Lender withdraw circuit: a real Groth16 proof over the compiled circuit and its
// key. Valid withdraws verify; a wrong secret, a leaf outside the tree or a
// changed public signal (root, nullifier, scope, recipient) do not.
// Run from circuits/:  node --test tests/lender-withdraw.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as snarkjs from "snarkjs";
import {
  computeLenderCommitment, computeLenderNullifier, lenderWithdrawInput, merkleRoot,
  LENDER_EXTERNAL_NULLIFIER,
} from "../../packages/protocol/src/crypto.mjs";

const C = new URL("../", import.meta.url).pathname;
const WASM = C + "lender_withdraw_js/lender_withdraw.wasm";
const ZKEY = C + "keys/lender_withdraw_final.zkey";
const vkey = JSON.parse(readFileSync(C + "keys/verification_key_lender_withdraw.json", "utf8"));

const B_PKH = "6257ca336c52ba8fdf1c6a55ffb644c7f4ecd5a10552a23969142ace";
const secret = 123456789123456789123456789n;
const others = [111n, 222n, 333n].map((s) => computeLenderCommitment(s));
const mine = computeLenderCommitment(secret);
const notes = [others[0], mine, others[1], others[2]];

const prove = (input) => snarkjs.groth16.fullProve(input, WASM, ZKEY);

after(async () => { await globalThis.curve_bls12381?.terminate(); });

test("lender commitment and nullifier are distinct and differ from the collateral derivations", () => {
  assert.notEqual(mine, computeLenderNullifier(secret));
  assert.equal(LENDER_EXTERNAL_NULLIFIER, 9999n);
});

test("a valid withdraw verifies and exposes [lender_root, nullifier, scope, recipient]", async () => {
  const { root, nullifier, input } = lenderWithdrawInput({ notes, index: 1, secret, recipientPkh: B_PKH });
  assert.equal(root, merkleRoot(notes));
  assert.equal(nullifier, computeLenderNullifier(secret));
  const { proof, publicSignals } = await prove(input);
  assert.deepEqual(publicSignals, [
    root.toString(), nullifier.toString(), LENDER_EXTERNAL_NULLIFIER.toString(), BigInt("0x" + B_PKH).toString(),
  ]);
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
});

test("a changed public signal fails verification", async () => {
  const { input } = lenderWithdrawInput({ notes, index: 1, secret, recipientPkh: B_PKH });
  const { proof, publicSignals } = await prove(input);
  for (let i = 0; i < publicSignals.length; i++) {
    const tampered = [...publicSignals];
    tampered[i] = (BigInt(tampered[i]) + 1n).toString();
    assert.equal(await snarkjs.groth16.verify(vkey, tampered, proof), false, `signal ${i}`);
  }
});

test("a wrong secret cannot produce a witness", async () => {
  const { input } = lenderWithdrawInput({ notes, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove({ ...input, secret: (secret + 1n).toString() }));
});

test("a note outside the tree cannot produce a witness", async () => {
  const outsider = 999n;
  const { input } = lenderWithdrawInput({ notes, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove({
    ...input, secret: outsider.toString(),
    withdraw_nullifier: computeLenderNullifier(outsider).toString(),
  }));
});

test("a nullifier from another scope cannot produce a witness", async () => {
  const { input } = lenderWithdrawInput({ notes, index: 1, secret, recipientPkh: B_PKH });
  await assert.rejects(prove({ ...input, lender_external_nullifier: "7777" }));
});
