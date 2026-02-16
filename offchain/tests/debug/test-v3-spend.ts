#!/usr/bin/env -S deno run --allow-all --env
/**
 * CRITICAL TEST: Spend from PlutusV3 validator
 */

import { Lucid, Blockfrost, Data, Script, validatorToAddress } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

console.log("═══════════════════════════════════════════════════════");
console.log("🎯 CRITICAL: Spending from PlutusV3 Validator");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(BLOCKFROST_URL!, BLOCKFROST_KEY),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_SEED!);

    // Load validator
    const plutusJson = JSON.parse(await Deno.readTextFile("../contracts/plutus.json"));
    const validator = plutusJson.validators.find((v: any) => v.title === "test_minimal.test_minimal.spend");

    const testScript: Script = {
        type: "PlutusV3",
        script: validator.compiledCode,
    };

    console.log("1️⃣  Loading UTXO...");

    // Query the confirmed UTXO directly
    const utxos = await lucid.utxosByOutRef([
        {
            txHash: "908730ac17cefe605b457f2b78878b6d17b69e67b5d9e5eba32b95a444fc4b4e",
            outputIndex: 0
        }
    ]);

    const utxo = utxos[0];
    console.log(`   ✅ UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`   📊 ADA: ${Number(utxo.assets.lovelace) / 1_000_000}`);
    console.log(`   🔍 Datum: ${utxo.datum}\n`);

    console.log("2️⃣  🎯 SPENDING UTXO...");

    const redeemer = "d8799f187bff";
    console.log(`   🔍 Redeemer: ${redeemer}\n`);

    const spendTx = await lucid
        .newTx()
        .collectFrom([utxo], redeemer)
        .attach.SpendingValidator(testScript)
        .complete();

    console.log("   ✅ Transaction built! 🎉\n");

    const signedTx = await spendTx.sign.withWallet().complete();
    const txHash = await signedTx.submit();

    console.log(`   ✅ Spend TX: ${txHash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    await lucid.awaitTx(txHash);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SUCCESS! PlutusV3 WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`🎯 TX: https://preprod.cardanoscan.io/transaction/${txHash}\n`);
    console.log("💡 ROOT CAUSE WAS: PlutusV2 vs PlutusV3 mismatch!");
    console.log("   - Aiken v1.1.15 only compiles to PlutusV3");
    console.log("   - We were telling Lucid it's PlutusV2");
    console.log("   - Changed to PlutusV3 → PROBLEM SOLVED!\n");

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack:", error.stack);
    }
    Deno.exit(1);
}
