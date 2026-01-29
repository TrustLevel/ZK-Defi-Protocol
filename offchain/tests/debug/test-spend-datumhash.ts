#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test SPENDING mit DatumHash UTXO
 */

import { Lucid, Blockfrost, Data, Script, validatorToAddress } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

if (!ADMIN_SEED || !BLOCKFROST_URL) {
    console.error("❌ Missing env variables");
    Deno.exit(1);
}

const SimpleDatumSchema = Data.Object({
    value_a: Data.Integer(),
    value_b: Data.Integer(),
});

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 Test SPENDING mit DatumHash");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_SEED);
    const adminAddress = await lucid.wallet().address();
    console.log(`   ✅ Admin: ${adminAddress}\n`);

    console.log("1️⃣  Loading validator...");
    const plutusJson = JSON.parse(await Deno.readTextFile("../contracts/plutus.json"));
    const validator = plutusJson.validators.find((v: any) => v.title === "test_minimal.test_minimal.spend");

    const testScript: Script = {
        type: "PlutusV2",
        script: validator.compiledCode,
    };

    const testAddress = validatorToAddress("Preprod", testScript);
    console.log(`   ✅ Validator: ${testAddress}\n`);

    console.log("2️⃣  Finding DatumHash UTXO...");
    const utxos = await lucid.utxosAt(testAddress);

    // Find UTXO with datumHash (not inline datum)
    const utxo = utxos.find(u => u.datumHash !== undefined);

    if (!utxo) {
        throw new Error("No UTXO with datumHash found!");
    }

    console.log(`   ✅ Found: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   🔍 Datum: ${utxo.datum}`);
    console.log(`   🔍 Datum Hash: ${utxo.datumHash}`);
    console.log(`   ✅ Has DatumHash: YES!\n`);

    console.log("3️⃣  Providing datum explicitly...");

    // Das Datum muss explizit bereitgestellt werden
    const datumValue = {
        value_a: 42n,
        value_b: 100n,
    };
    const datum = Data.to(datumValue as any, SimpleDatumSchema);
    console.log(`   🔍 Datum CBOR: ${datum}\n`);

    console.log("4️⃣  Building spend transaction...");

    const redeemer = "d8799f187bff";  // Unlock { secret: 123 }
    console.log(`   🔍 Redeemer: ${redeemer}`);

    // Versuche eine andere API - add datum explizit zum TX witness set
    const spendTx = await lucid
        .newTx()
        .collectFrom([utxo], Data.void())  // ← Erst ohne redeemer
        .withdraw("stake_test1uqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5cqfjl", 0n, Data.void())  // Dummy
        .compose(
            lucid.newTx()
                .collectFrom([{...utxo, datum: datum}], redeemer)
                .attach.SpendingValidator(testScript)
        )
        .complete();

    console.log("   ✅ Transaction built!");
    console.log("   📝 Signing...\n");

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendTxHash = await spendSigned.submit();

    console.log(`   ✅ Spend TX: ${spendTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...`);

    await lucid.awaitTx(spendTxHash);
    console.log(`   ✅ Confirmed!\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ SUCCESS! DatumHash FUNKTIONIERT!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("🎯 Ergebnis: DatumHash löst das Problem!");
    console.log(`   TX: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

} catch (error) {
    console.error("\n❌ FAILED:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack:", error.stack);
    }
    Deno.exit(1);
}
