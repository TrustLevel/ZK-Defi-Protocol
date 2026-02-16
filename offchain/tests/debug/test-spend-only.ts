#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test ONLY the spending part with Lucid 0.4.29
 * Uses existing UTXO at validator
 */

import { Lucid, Blockfrost, Data, Script, validatorToAddress } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

if (!ADMIN_SEED || !BLOCKFROST_URL) {
    console.error("❌ Missing env variables");
    Deno.exit(1);
}

// SimpleDatum schema
const SimpleDatumSchema = Data.Object({
    value_a: Data.Integer(),
    value_b: Data.Integer(),
});

// SimpleRedeemer schema
const SimpleRedeemerSchema = Data.Enum([
    Data.Object({
        Unlock: Data.Tuple([Data.Integer()]),
    }),
]);

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 Test Spending with Lucid 0.4.29");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Initialize Lucid
    console.log("1️⃣  Connecting to network...");
    const lucid = await Lucid(
        new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_SEED);
    const adminAddress = await lucid.wallet().address();
    console.log(`   ✅ Admin: ${adminAddress}\n`);

    // Load validator
    console.log("2️⃣  Loading minimal validator...");
    const plutusJson = JSON.parse(await Deno.readTextFile("../contracts/plutus.json"));
    const validator = plutusJson.validators.find((v: any) => v.title === "test_minimal.test_minimal.spend");

    if (!validator) {
        throw new Error("Minimal validator not found in plutus.json");
    }

    const testScript: Script = {
        type: "PlutusV3",  // ← FIXED! Aiken v1.1.15 only supports V3
        script: validator.compiledCode,
    };

    const testAddress = validatorToAddress("Preprod", testScript);
    console.log(`   ✅ Validator address: ${testAddress}\n`);

    // Query UTXOs
    console.log("3️⃣  Querying locked UTXOs...");
    const utxos = await lucid.utxosAt(testAddress);

    if (utxos.length === 0) {
        throw new Error("No UTXO found at validator address");
    }

    // Use the NEWEST UTXO (created with Lucid 0.4.29)
    const utxo = utxos[utxos.length - 1];
    console.log(`   ✅ Found UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   🔍 Datum: ${utxo.datum}`);
    console.log(`   🔍 Datum Hash: ${utxo.datumHash}`);
    console.log(`   🔍 UTXO object keys: ${Object.keys(utxo).join(", ")}\n`);

    // Try to spend it
    console.log("4️⃣  Spending UTXO back to admin...");

    // Manual CBOR for Unlock { secret: 123 }
    const redeemer = "d8799f187bff";
    console.log(`   🔍 Redeemer CBOR: ${redeemer}`);
    console.log(`   🔍 Using .attach.SpendingValidator()...\n`);

    const spendTx = await lucid
        .newTx()
        .collectFrom([utxo], redeemer)
        .attach.SpendingValidator(testScript)
        .complete();

    console.log("   ✅ Transaction built successfully!");
    console.log("   📝 Signing transaction...\n");

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendTxHash = await spendSigned.submit();

    console.log(`   ✅ Spend TX: ${spendTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...`);
    await lucid.awaitTx(spendTxHash);
    console.log(`   ✅ Confirmed!\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ TEST PASSED WITH LUCID 0.4.29!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("🎯 Result: Spending inline datums works with Lucid 0.4.29!");
    console.log(`   Spend TX: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

} catch (error) {
    console.error("\n❌ TEST FAILED:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack trace:", error.stack);
    }
    Deno.exit(1);
}
