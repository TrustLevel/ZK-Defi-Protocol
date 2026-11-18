// Groth16 proving off the main thread. Inputs (including the secret) stay in
// this browser: the worker only reads circuit files from /circuits/.
// Stages are reported so the UI can show witness → proving → verifying.
import * as snarkjs from "snarkjs";
import * as ff from "ffjavascript";
import { compressProof } from "@zk-defi/protocol/crypto";

let curve;
const vkeys = {};

self.onmessage = async ({ data: { id, kind, input } }) => {
  const stage = (name) => self.postMessage({ id, stage: name });
  try {
    const t0 = performance.now();
    stage("witness");
    const wtns = { type: "mem" };
    await snarkjs.wtns.calculate(input, `/circuits/${kind}.wasm`, wtns);
    const t1 = performance.now();
    stage("proving");
    const { proof, publicSignals } = await snarkjs.groth16.prove(`/circuits/${kind}.zkey`, wtns);
    const t2 = performance.now();
    stage("verifying");
    vkeys[kind] ??= await (await fetch(`/circuits/${kind}.vkey.json`)).json();
    if (!(await snarkjs.groth16.verify(vkeys[kind], publicSignals, proof))) throw new Error(`${kind} proof failed local verification`);
    curve ??= await ff.getCurveFromName("bls12381", true);
    const compressed = compressProof(curve, proof);
    const t3 = performance.now();
    self.postMessage({
      id, done: true, proof, publicSignals, compressed,
      timings: { witnessMs: t1 - t0, proveMs: t2 - t1, verifyMs: t3 - t2 },
    });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};
