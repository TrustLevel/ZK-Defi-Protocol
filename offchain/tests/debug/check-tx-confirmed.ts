#!/usr/bin/env -S deno run --allow-all --env
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL!, BLOCKFROST_KEY),
    "Preprod"
);

const txHash = "cc96dfb2cef9b37b3575c4fcde06f74cd2ca92dc00fec87a21954f638d15f465";
const testAddress = "addr_test1wqrsmm49qagqqv9ut4jk42f974mkcsxfsl9acu4mej5cmsc5kxhqg";

console.log(`Checking TX: ${txHash}\n`);

try {
    // Try to await it (will throw if not confirmed yet)
    await lucid.awaitTx(txHash, 5000);
    console.log("✅ TX is confirmed!\n");

    // Query UTXOs to see the new one
    const utxos = await lucid.utxosAt(testAddress);
    const ourUtxo = utxos.find(u => u.txHash === txHash);

    if (ourUtxo) {
        console.log(`Found UTXO: ${ourUtxo.txHash}#${ourUtxo.outputIndex}`);
        console.log(`Value: ${Number(ourUtxo.assets.lovelace) / 1_000_000} ADA`);
        console.log(`Datum: ${ourUtxo.datum}`);
        console.log(`Datum Hash: ${ourUtxo.datumHash}`);
        console.log(`Has DatumHash: ${ourUtxo.datumHash ? "YES ✅" : "NO ❌"}`);
    }
} catch (error) {
    console.log("❌ TX not confirmed yet or error:", error);
}
