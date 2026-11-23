/**
 * Fetch a Preprod cycle from Blockfrost as a test fixture: for each labelled
 * transaction its validity, fee, redeemers (CBOR, data hash, execution units)
 * and outputs (value, inline datum CBOR and hash). The fixture feeds the golden
 * tests (test/plutus.test.mjs) and the cost table of docs/MILESTONE3.md.
 *
 *   node --env-file=../../.env scripts/fetch-cycle.mjs <out.json> "<source>" label=txhash ...
 */
import fs from "fs";

const KEY = process.env.PREPROD_BLOCKFROST_API_KEY;
if (!KEY) throw new Error("PREPROD_BLOCKFROST_API_KEY missing");
const bf = async (p) => {
  const r = await fetch("https://cardano-preprod.blockfrost.io/api/v0" + p, { headers: { project_id: KEY } });
  if (!r.ok) throw new Error(`Blockfrost ${r.status} ${p}`);
  return r.json();
};
const datumCbor = async (hash) => (await bf(`/scripts/datum/${hash}/cbor`)).cbor;

const [out, source, ...pairs] = process.argv.slice(2);
const fixture = { _source: source, txs: [] };
for (const pair of pairs) {
  const [label, hash] = pair.split("=");
  const tx = await bf(`/txs/${hash}`);
  const utxos = await bf(`/txs/${hash}/utxos`);
  const redeemers = [];
  for (const r of await bf(`/txs/${hash}/redeemers`)) {
    redeemers.push({
      purpose: r.purpose, index: r.tx_index, hash: r.redeemer_data_hash, cbor: await datumCbor(r.redeemer_data_hash),
      mem: r.unit_mem, cpu: r.unit_steps,
    });
  }
  const outputs = [];
  for (const o of utxos.outputs) {
    outputs.push({
      address: o.address, amount: o.amount, datumHash: o.data_hash,
      cbor: o.data_hash ? await datumCbor(o.data_hash) : null,
    });
  }
  const inputs = utxos.inputs.map((i) => ({ address: i.address, amount: i.amount, txHash: i.tx_hash, outputIndex: i.output_index, reference: i.reference }));
  fixture.txs.push(label);
  fixture[label] = { hash, validContract: tx.valid_contract, fee: tx.fees, redeemers, inputs, outputs };
  console.log(label, hash.slice(0, 12), tx.valid_contract ? "valid" : "INVALID");
}
fs.writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.log("written", out);
