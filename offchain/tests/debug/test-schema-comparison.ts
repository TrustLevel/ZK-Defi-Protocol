#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test: Compare Data.Object() vs Data.Tuple() CBOR output
 */

import { Data } from "@lucid-evolution/lucid";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 Schema Comparison Test");
console.log("═══════════════════════════════════════════════════════\n");

// Test data
const testValues = {
    total_deposited: 0n,
    total_borrowed: 0n,
    interest_rate: 500n,
    last_updated: 1738053475200n,
};

console.log("Test Values:");
console.log(JSON.stringify(testValues, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
console.log();

// Schema 1: Data.Object() (old approach)
console.log("1️⃣  Data.Object() Schema (OLD):");
const ObjectSchema = Data.Object({
    total_deposited: Data.Integer(),
    total_borrowed: Data.Integer(),
    interest_rate: Data.Integer(),
    last_updated: Data.Integer(),
});

const cborObject = Data.to(testValues as any, ObjectSchema);
console.log("   CBOR:", cborObject);
console.log("   Length:", cborObject.length, "characters");
console.log();

// Schema 2: Data.Tuple() (new approach)
console.log("2️⃣  Data.Tuple() Schema (NEW):");
const TupleSchema = Data.Tuple([
    Data.Integer(), // total_deposited
    Data.Integer(), // total_borrowed
    Data.Integer(), // interest_rate
    Data.Integer(), // last_updated
]);

const cborTuple = Data.to([
    testValues.total_deposited,
    testValues.total_borrowed,
    testValues.interest_rate,
    testValues.last_updated,
], TupleSchema);
console.log("   CBOR:", cborTuple);
console.log("   Length:", cborTuple.length, "characters");
console.log();

// Compare
console.log("═══════════════════════════════════════════════════════");
if (cborObject === cborTuple) {
    console.log("✅ IDENTICAL! Both schemas produce the same CBOR");
    console.log("   → Data.Object() and Data.Tuple() are equivalent");
} else {
    console.log("❌ DIFFERENT! The schemas produce different CBOR");
    console.log("\nDifference:");
    console.log("   Object:", cborObject);
    console.log("   Tuple:", cborTuple);

    // Find where they differ
    for (let i = 0; i < Math.min(cborObject.length, cborTuple.length); i += 2) {
        const byteObj = cborObject.substring(i, i + 2);
        const byteTuple = cborTuple.substring(i, i + 2);
        if (byteObj !== byteTuple) {
            console.log(`\n   First difference at position ${i / 2}:`);
            console.log(`   Object:  ${byteObj}`);
            console.log(`   Tuple:   ${byteTuple}`);
            break;
        }
    }
}
console.log("═══════════════════════════════════════════════════════\n");

// Test parsing back
console.log("3️⃣  Testing Deserialization:");
try {
    const parsedFromObject = Data.from(cborObject, ObjectSchema);
    console.log("   ✅ Data.Object() can parse Object CBOR");
} catch (e) {
    console.log("   ❌ Data.Object() CANNOT parse Object CBOR:", e);
}

try {
    const parsedFromTuple = Data.from(cborTuple, TupleSchema);
    console.log("   ✅ Data.Tuple() can parse Tuple CBOR");
} catch (e) {
    console.log("   ❌ Data.Tuple() CANNOT parse Tuple CBOR:", e);
}

// Cross-parsing test
console.log("\n4️⃣  Cross-Parsing Test:");
try {
    const parsed = Data.from(cborObject, TupleSchema);
    console.log("   ✅ Data.Tuple() CAN parse Data.Object() CBOR!");
    console.log("   → Schema change is SAFE (backward compatible)");
} catch (e) {
    console.log("   ❌ Data.Tuple() CANNOT parse Data.Object() CBOR");
    console.log("   → Need fresh pool initialization");
}

try {
    const parsed = Data.from(cborTuple, ObjectSchema);
    console.log("   ✅ Data.Object() CAN parse Data.Tuple() CBOR!");
} catch (e) {
    console.log("   ❌ Data.Object() CANNOT parse Data.Tuple() CBOR");
}
console.log();
