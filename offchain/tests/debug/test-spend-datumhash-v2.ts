#!/usr/bin/env -S deno run --allow-all --env
/**
 * Test SPENDING mit DatumHash UTXO - V2
 * Query datum von Blockfrost und füge es explizit hinzu
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
console.log("🧪 Test SPENDING mit DatumHash - V2");
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

    console.log("2️⃣  Query UTXOs und hole Datum via Blockfrost...");

    // Query UTXOs via Blockfrost provider direkt
    const provider = lucid.config().provider;
    const utxos = await provider.getUtxos(testAddress);

    console.log(`   Found ${utxos.length} UTXOs`);

    // Find UTXO with datumHash
    const utxoWithHash = utxos.find(u => u.datumHash !== undefined);

    if (!utxoWithHash) {
        throw new Error("No UTXO with datumHash found!");
    }

    console.log(`   ✅ Found: ${utxoWithHash.txHash}#${utxoWithHash.outputIndex}`);
    console.log(`   🔍 Datum Hash: ${utxoWithHash.datumHash}`);

    // Query the datum using the hash
    console.log(`   🔍 Querying datum from Blockfrost...`);

    const datumFromChain = await provider.getDatum(utxoWithHash.datumHash!);

    console.log(`   ✅ Got datum: ${datumFromChain}`);

    // Now create UTXO with datum for collectFrom
    const utxoWithDatum = {
        ...utxoWithHash,
        datum: datumFromChain,
    };

    console.log("\n3️⃣  Building spend transaction...");

    const redeemer = "d8799f187bff";
    console.log(`   🔍 Redeemer: ${redeemer}`);

    const spendTx = await lucid
        .newTx()
        .collectFrom([utxoWithDatum], redeemer)
        .attach.SpendingValidator(testScript)
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
