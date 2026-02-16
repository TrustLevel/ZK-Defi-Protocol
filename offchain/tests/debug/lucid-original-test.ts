#!/usr/bin/env -S deno run --allow-all --env
/**
 * CRITICAL TEST: Original Lucid vs Lucid Evolution
 *
 * Tests if Original Lucid can spend from script address with inline datum.
 * This test uses EXISTING UTXO (already locked with inline datum).
 *
 * If this works → Original Lucid solves our problem! ✅
 * If this fails → Need alternative library ❌
 */

import { Lucid, Blockfrost, Data, Script, Constr } from "lucid-cardano";

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

console.log("═══════════════════════════════════════════════════════");
console.log("🚀 CRITICAL TEST: Original Lucid");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Initialize Lucid (ORIGINAL API)
    console.log("1️⃣  Connecting with Original Lucid...");

    const lucid = await Lucid.new(  // ← Note: Lucid.new() instead of Lucid()
        new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
        "Preprod"
    );

    lucid.selectWalletFromSeed(ADMIN_SEED);  // ← Note: selectWalletFromSeed instead of selectWallet.fromSeed

    const adminAddress = await lucid.wallet.address();  // ← Note: lucid.wallet instead of lucid.wallet()
    console.log(`   ✅ Connected with Original Lucid v0.10.7`);
    console.log(`   ✅ Admin: ${adminAddress}\n`);

    // Load validator
    console.log("2️⃣  Loading test_minimal validator...");
    const plutusJson = JSON.parse(await Deno.readTextFile("../contracts/plutus.json"));
    const validator = plutusJson.validators.find((v: any) => v.title === "test_minimal.test_minimal.spend");

    if (!validator) {
        throw new Error("Minimal validator not found in plutus.json");
    }

    const testScript: Script = {
        type: "PlutusV3",  // ← FIXED! Aiken v1.1.15 compiles to V3!
        script: validator.compiledCode,
    };

    const testAddress = lucid.utils.validatorToAddress(testScript);  // ← Original Lucid API
    console.log(`   ✅ Validator: ${testAddress}\n`);

    // Query EXISTING UTXOs (we already have several with inline datums)
    console.log("3️⃣  Querying EXISTING UTXOs...");
    const utxos = await lucid.utxosAt(testAddress);

    if (utxos.length === 0) {
        throw new Error("No UTXO found at validator address");
    }

    // Use first UTXO with inline datum
    const utxo = utxos.find(u => u.datum !== undefined && u.datumHash === undefined);

    if (!utxo) {
        throw new Error("No UTXO with inline datum found");
    }

    console.log(`   ✅ Found UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 Value: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   🔍 Datum: ${utxo.datum}`);
    console.log(`   🔍 Datum Hash: ${utxo.datumHash || "none (inline)"}`);
    console.log(`   ✅ Has inline datum: YES!\n`);

    // THE CRITICAL TEST: Spend from script address
    console.log("4️⃣  🎯 CRITICAL TEST: Spending UTXO...");

    // Redeemer: Unlock { secret: 123 }
    // Try Original Lucid's Data API (simpler, no schema)
    const redeemer = Data.to(
        new Constr(0, [123n])  // Constructor 0, field: 123
    );

    console.log(`   🔍 Redeemer prepared: ${redeemer}`);
    console.log(`   🔍 Building transaction...\n`);

    // Build transaction with Original Lucid API
    const tx = await lucid
        .newTx()
        .collectFrom([utxo], redeemer)  // ← This is the critical line!
        .attachSpendingValidator(testScript)  // ← Note: attachSpendingValidator (no dot)
        .complete();

    console.log("   ✅ Transaction built successfully! 🎉");
    console.log("   📝 Signing transaction...\n");

    const signedTx = await tx.sign().complete();
    const txHash = await signedTx.submit();

    console.log(`   ✅ Spend TX: ${txHash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    await lucid.awaitTx(txHash);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SUCCESS! ORIGINAL LUCID WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("🎯 Result: Original Lucid correctly passes datums to Aiken validators!");
    console.log(`   TX: https://preprod.cardanoscan.io/transaction/${txHash}\n`);
    console.log("💡 Next steps:");
    console.log("   1. Migrate all services to Original Lucid");
    console.log("   2. Update borrow/repay/withdraw flows");
    console.log("   3. Test full end-to-end flow");

} catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.stack) {
        console.error("\n📋 Stack trace:");
        console.error(error.stack);
    }

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("❌ Original Lucid also has issues");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("💡 Next steps:");
    console.log("   1. Report bug with reproducible example");
    console.log("   2. Ask Aiken Discord community");
    console.log("   3. Try alternative library (mesh, plu-ts)");

    Deno.exit(1);
}
