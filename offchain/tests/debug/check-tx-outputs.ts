#!/usr/bin/env -S deno run --allow-all --env
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL!, BLOCKFROST_KEY),
    "Preprod"
);

const txHash = "908730ac17cefe605b457f2b78878b6d17b69e67b5d9e5eba32b95a444fc4b4e";

console.log(`Querying TX: ${txHash}\n`);

try {
    // Query UTXOs by outref directly
    const utxos = await lucid.utxosByOutRef([
        { txHash, outputIndex: 0 }
    ]);

    console.log(`Found ${utxos.length} UTXO(s)\n`);

    for (const utxo of utxos) {
        console.log(`UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
        console.log(`  Address: ${utxo.address}`);
        console.log(`  ADA: ${Number(utxo.assets.lovelace) / 1_000_000}`);
        console.log(`  Datum: ${utxo.datum || "missing"}`);
        console.log(`  Datum Hash: ${utxo.datumHash || "none"}`);
    }
} catch (error) {
    console.error("Error:", error);
}
