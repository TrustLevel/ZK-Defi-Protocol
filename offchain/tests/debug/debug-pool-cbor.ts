#!/usr/bin/env -S deno run --allow-all --env
/**
 * Debug: Read and analyze existing pool datum CBOR
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
const poolUtxo = poolUtxos.find(utxo => utxo.assets[poolBeaconUnit] === 1n);

if (!poolUtxo) {
    console.error("Pool UTXO not found!");
    Deno.exit(1);
}

console.log("📋 Existing Pool UTXO (created with Data.Object):");
console.log("\nCBOR (hex):", poolUtxo.datum);
console.log("CBOR length:", poolUtxo.datum.length, "characters");
console.log("CBOR bytes:", poolUtxo.datum.length / 2, "bytes");

// Parse the CBOR manually to understand structure
const cbor = poolUtxo.datum;
console.log("\n🔍 CBOR Structure Analysis:");
console.log("First bytes:", cbor.substring(0, 10));
console.log("- d87a = Constructor tag");
console.log("- 9f = Indefinite array start");
console.log("\nFull CBOR breakdown:");
console.log(cbor);
