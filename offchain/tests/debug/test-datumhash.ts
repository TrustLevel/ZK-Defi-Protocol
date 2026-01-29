#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test mit DatumHash statt InlineDatum
 *
 * Wenn das funktioniert, wissen wir dass das Problem InlineDatum-spezifisch ist
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
console.log("🧪 Test mit DATUM HASH (statt InlineDatum)");
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
        type: "PlutusV2",
        script: validator.compiledCode,
    };

    const testAddress = validatorToAddress("Preprod", testScript);
    console.log(`   ✅ Validator address: ${testAddress}\n`);

    // Step 1: Lock UTXO at validator WITH DATUM HASH
    console.log("3️⃣  Locking 10 ADA at validator with DATUM HASH...");

    const datumValue = {
        value_a: 42n,
        value_b: 100n,
    };

    const datum = Data.to(datumValue as any, SimpleDatumSchema);
    console.log(`   📊 Datum: value_a=42, value_b=100`);
    console.log(`   🔍 Datum CBOR: ${datum}`);

    // Build TX with datum provided in witness set
    const lockTx = await lucid
        .newTx()
        .pay.ToAddressWithData(
            testAddress,
            { kind: "asHash", value: datum },  // ← DatumHash! Datum geht in witness set
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

    // Find the UTXO we just created (by txHash)
    const utxo = utxos.find(u => u.txHash === lockTxHash);
    if (!utxo) {
        throw new Error("Could not find our UTXO");
    }

    console.log(`   ✅ Found UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   🔍 Datum: ${utxo.datum}`);
    console.log(`   🔍 Datum Hash: ${utxo.datumHash}`);
    console.log(`   🔍 Has datum hash? ${utxo.datumHash ? "YES" : "NO"}\n`);

    // Step 3: Try to spend it
    console.log("5️⃣  Spending UTXO back to admin...");

    // Manual CBOR for Unlock { secret: 123 }
    const redeemer = "d8799f187bff";
    console.log(`   🔍 Redeemer CBOR: ${redeemer}`);

    // When spending with DatumHash, Lucid should automatically include datum in witness set
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
    console.log("✅ TEST PASSED WITH DATUM HASH!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("🎯 Result: DatumHash funktioniert mit Option<Datum>!");
    console.log(`   Lock TX: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
    console.log(`   Spend TX: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

} catch (error) {
    console.error("\n❌ TEST FAILED:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack trace:", error.stack);
    }
    Deno.exit(1);
}
