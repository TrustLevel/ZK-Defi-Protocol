// End-to-end sanity check for the v6 collateral_semaphore circuit:
// build a Poseidon255 Merkle tree, generate a membership+nullifier proof, verify it.
import { poseidon2 } from "poseidon-bls12381";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const C = (p) => resolve(__dirname, "../../../circuits", p);

const DEPTH = 10;
const secret = 123456789012345n;
const amount = 20_000_000n; // private collateral
const ratio = 125n;
const loan = 10_000_000n;
const extNull = 42n; // loan context

// leaf commitment
const leaf = poseidon2([amount, secret]);

// build a tree with our leaf at index 0 (rest zero), collect the membership path
let level = new Array(1 << DEPTH).fill(0n);
level[0] = leaf;
const siblings = [];
const pathIndices = [];
let idx = 0;
for (let d = 0; d < DEPTH; d++) {
  siblings.push(level[idx ^ 1]);
  pathIndices.push(idx & 1);
  const next = new Array(level.length >> 1);
  for (let i = 0; i < next.length; i++)
    next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
  level = next;
  idx >>= 1;
}
const root = level[0];
const nullifier = poseidon2([secret, extNull]);

const input = {
  group_merkle_root: root.toString(),
  loan_nullifier: nullifier.toString(),
  loan_amount: loan.toString(),
  collateral_ratio: ratio.toString(),
  external_nullifier: extNull.toString(),
  secret: secret.toString(),
  collateral_amount: amount.toString(),
  pathIndices: pathIndices.map(String),
  siblings: siblings.map((s) => s.toString()),
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  C("collateral_semaphore_js/collateral_semaphore.wasm"),
  C("keys/collateral_semaphore_final.zkey"),
);

const vkey = JSON.parse(readFileSync(C("keys/verification_key_semaphore.json")));
const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);

console.log("publicSignals:", publicSignals);
console.log("verify:", ok);

// Negative: tamper loan_amount in the public signals -> must fail.
const tampered = [...publicSignals];
tampered[2] = (BigInt(tampered[2]) + 1n).toString();
const bad = await snarkjs.groth16.verify(vkey, tampered, proof);
console.log("verify(tampered loan_amount):", bad, "(expected false)");

process.exit(ok && !bad ? 0 : 1);
