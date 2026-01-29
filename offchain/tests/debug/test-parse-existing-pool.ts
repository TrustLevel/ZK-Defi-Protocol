#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test: Parse existing pool datum with different schemas
 */

import { Lucid, Blockfrost, Data } from "@lucid-evolution/lucid";

const POOL_ADDRESS = Deno.env.get("LENDING_POOL_V3_ADDRESS");
const BEACON_POLICY = Deno.env.get("BEACON_POLICY_ID");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 Parse Existing Pool Datum");
console.log("═══════════════════════════════════════════════════════\n");

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

const existingCbor = poolUtxo.datum;
console.log("Existing Pool CBOR:", existingCbor);
console.log();

// Schema 1: Data.Object()
console.log("1️⃣  Testing with Data.Object():");
const ObjectSchema = Data.Object({
    total_deposited: Data.Integer(),
    total_borrowed: Data.Integer(),
    interest_rate: Data.Integer(),
    last_updated: Data.Integer(),
});

try {
    const parsed = Data.from(existingCbor, ObjectSchema);
    console.log("   ✅ SUCCESS! Parsed with Data.Object()");
    console.log("   Values:", JSON.stringify(parsed, (k, v) => typeof v === 'bigint' ? v.toString() : v));
} catch (e: any) {
    console.log("   ❌ FAILED:", e.message);
}
console.log();

// Schema 2: Data.Tuple()
console.log("2️⃣  Testing with Data.Tuple():");
const TupleSchema = Data.Tuple([
    Data.Integer(),
    Data.Integer(),
    Data.Integer(),
    Data.Integer(),
]);

try {
    const parsed = Data.from(existingCbor, TupleSchema);
    console.log("   ✅ SUCCESS! Parsed with Data.Tuple()");
    console.log("   Values:", parsed);
} catch (e: any) {
    console.log("   ❌ FAILED:", e.message);
}
console.log();

// Schema 3: Let's try parsing as raw ConstrData
console.log("3️⃣  Testing as Constructor (manual):");
try {
    // Try to parse without schema to see raw structure
    const rawData = Data.from(existingCbor);
    console.log("   ✅ Parsed as raw Data:", rawData);
} catch (e: any) {
    console.log("   ❌ FAILED:", e.message);
}
