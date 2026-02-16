#!/usr/bin/env -S deno run --allow-all --env
/**
 * Minimal Validator Test
 *
 * Tests if Option<Datum> works with inline datums
 *
 * Steps:
 * 1. Load minimal validator
 * 2. Send 10 ADA to validator with inline datum
 * 3. Wait for confirmation
 * 4. Try to spend it back
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
console.log("🧪 Minimal Validator Test");
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
        type: "PlutusV3",
        script: validator.compiledCode,
    };

    const testAddress = validatorToAddress("Preprod", testScript);
    console.log(`   ✅ Validator address: ${testAddress}\n`);

    // Step 1: Lock UTXO at validator
    console.log("3️⃣  Locking 10 ADA at validator with inline datum...");
    console.log("   (Using working API from deposit-collateral-v3.ts)");

    const datum = Data.to({
        value_a: 42n,
        value_b: 100n,
    } as any, SimpleDatumSchema);

    console.log(`   📊 Datum: value_a=42, value_b=100`);
    console.log(`   🔍 Datum CBOR: ${datum}`);

    // Use the EXACT API that works in deposit-collateral-v3.ts
    const lockTx = await lucid
        .newTx()
        .pay.ToContract(
            testAddress,
            { kind: "inline", value: datum },
            { lovelace: 10_000_000n }
        )
        .complete();

    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockTxHash = await lockSigned.submit();

    console.log(`   ✅ Lock TX: ${lockTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...`);
    await lucid.awaitTx(lockTxHash);
    console.log(`   ✅ Confirmed!\n`);

    // Step 2: Query the UTXO
    console.log("4️⃣  Querying locked UTXO...");
    const utxos = await lucid.utxosAt(testAddress);

    if (utxos.length === 0) {
        throw new Error("No UTXO found at validator address");
    }

    const utxo = utxos[0];
    console.log(`   ✅ Found UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   🔍 Datum: ${utxo.datum}`);
    console.log(`   🔍 Datum Hash: ${utxo.datumHash}`);
    console.log(`   🔍 Script Ref: ${utxo.scriptRef ? "present" : "none"}`);
    console.log(`   🔍 Full UTXO keys: ${Object.keys(utxo).join(", ")}\n`);

    // Step 3: Try to spend it
    console.log("5️⃣  Spending UTXO back to admin...");

    // Manual CBOR for Unlock { secret: 123 }
    // Constructor 0 (Unlock) with 1 field (123)
    // d8799f + 187b (123 in hex) + ff
    const redeemer = "d8799f187bff";
    console.log(`   🔍 Redeemer CBOR: ${redeemer}`);

    // TEST: Use .attach.SpendingValidator() as shown in Lucid docs
    // instead of .attach.Script()
    console.log(`   🔍 Testing with .attach.SpendingValidator()...`);

    const spendTx = await lucid
        .newTx()
        .collectFrom([utxo], redeemer)
        .attach.SpendingValidator(testScript)  // ← Changed from .attach.Script()
        .complete();

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendTxHash = await spendSigned.submit();

    console.log(`   ✅ Spend TX: ${spendTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...`);
    await lucid.awaitTx(spendTxHash);
    console.log(`   ✅ Confirmed!\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ TEST PASSED!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("🎯 Result: Option<Datum> works with inline datums!");
    console.log(`   Lock TX: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
    console.log(`   Spend TX: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

} catch (error) {
    console.error("\n❌ TEST FAILED:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack trace:", error.stack);
    }
    Deno.exit(1);
}
