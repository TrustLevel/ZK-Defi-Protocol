#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * Debug: List all pool UTXOs on-chain
 */

import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const POOL_ADDRESS = Deno.env.get("LENDING_POOL_V3_ADDRESS");
const BEACON_POLICY = Deno.env.get("BEACON_POLICY_ID");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_ENDPOINT!, BLOCKFROST_KEY),
    "Preprod"
);

const poolBeaconUnit = BEACON_POLICY + "4c454e44494e47504f4f4c";
const poolUtxos = await lucid.utxosAt(POOL_ADDRESS!);

console.log("📋 All Pool UTXOs at address:");
console.log(`   Address: ${POOL_ADDRESS}`);
console.log(`   Total UTXOs: ${poolUtxos.length}\n`);

poolUtxos.forEach((utxo, index) => {
    const hasBeacon = utxo.assets[poolBeaconUnit] === 1n;
    console.log(`UTXO ${index + 1}:`);
    console.log(`   TX: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   ADA: ${Number(utxo.assets.lovelace) / 1_000_000}`);
    console.log(`   Beacon: ${hasBeacon ? "✅ YES" : "❌ NO"}`);
    if (utxo.datum) {
        console.log(`   Datum (first 60 chars): ${utxo.datum.substring(0, 60)}...`);
    } else {
        console.log(`   Datum: NONE`);
    }
    console.log();
});

const beaconUtxos = poolUtxos.filter(u => u.assets[poolBeaconUnit] === 1n);
console.log(`\nPool UTXOs with LENDINGPOOL beacon: ${beaconUtxos.length}`);

if (beaconUtxos.length > 1) {
    console.log("\n⚠️  WARNING: Multiple pool UTXOs found!");
    console.log("   This can cause issues. The backend should use the newest one.");
}
