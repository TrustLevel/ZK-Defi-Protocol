#!/usr/bin/env -S deno run --allow-all --env
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL!, BLOCKFROST_KEY),
    "Preprod"
);

const testAddress = "addr_test1wqrsmm49qagqqv9ut4jk42f974mkcsxfsl9acu4mej5cmsc5kxhqg";
const utxos = await lucid.utxosAt(testAddress);

console.log(`Found ${utxos.length} UTXOs at test validator\n`);

for (const utxo of utxos) {
    console.log(`UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`  Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`  Datum: ${utxo.datum}`);
    console.log(`  Datum Hash: ${utxo.datumHash}`);
    console.log("");
}
