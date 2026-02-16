#!/usr/bin/env -S deno run --allow-all --env
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL!, BLOCKFROST_KEY),
    "Preprod"
);

const v3Address = "addr_test1wrnec83lj6qqxxsuk2x7ye9uhsn09xcfp6lmjqrrkdl2cdg29e6wr";
const utxos = await lucid.utxosAt(v3Address);

console.log(`Found ${utxos.length} UTXOs at V3 validator\n`);

for (const utxo of utxos) {
    console.log(`UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`  ADA: ${Number(utxo.assets.lovelace) / 1_000_000}`);
    console.log(`  Datum: ${utxo.datum || "missing"}`);
    console.log("");
}
