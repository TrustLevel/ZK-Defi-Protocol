#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * ULTRA SIMPLE TEST
 * Step 1: Lock 100 ADA at simple validator
 * Step 2: Unlock and send 10 ADA to User1
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER1_DESTINATION = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 ULTRA SIMPLE VALIDATOR TEST");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Initialize
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    const adminAddress = await lucid.wallet().address();

    console.log(`Admin: ${adminAddress.substring(0, 40)}...\n`);

    // Load validator
    console.log("📜 Loading ultra-simple validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_ultra_simple.test_ultra_simple.spend"
    );

    if (!validator) {
        throw new Error("Ultra simple validator not found");
    }

    // Get admin key hash
    const adminDetails = getAddressDetails(adminAddress);
    const adminKeyHash = adminDetails.paymentCredential!.hash;

    // Apply params (just admin key hash)
    const SimpleParamsSchema = Data.Object({
        admin_key_hash: Data.Bytes(),
    });

    const params = Data.to({
        admin_key_hash: adminKeyHash,
    }, SimpleParamsSchema);

    const parameterizedScript = applyParamsToScript(validator.compiledCode, [params]);

    const simpleValidator = {
        type: "PlutusV3" as const,
        script: parameterizedScript,
    };

    const validatorAddress = validatorToAddress("Preprod", simpleValidator);
    console.log(`   ✅ Validator: ${validatorAddress}\n`);

    // STEP 1: Lock 100 ADA at validator
    console.log("💰 STEP 1: Lock 100 ADA at validator...");

    const lockTx = await lucid
        .newTx()
        .pay.ToContract(
            validatorAddress,
            { kind: "inline", value: Data.to(42n) }, // Datum = just number 42
            { lovelace: 100_000_000n }
        )
        .complete();

    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockTxHash = await lockSigned.submit();

    console.log(`   ✅ Locked! TX: ${lockTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    await lucid.awaitTx(lockTxHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 2: Spend from validator
    console.log("🔓 STEP 2: Spend 10 ADA from validator...");

    // Find UTXO
    const utxos = await lucid.utxosAt(validatorAddress);
    if (utxos.length === 0) {
        throw new Error("No UTXOs found at validator");
    }

    const lockedUtxo = utxos[0];
    console.log(`   Found UTXO: ${Number(lockedUtxo.assets.lovelace) / 1_000_000} ADA`);

    // Simple redeemer = just number 1
    const redeemer = Data.to(1n);
    console.log(`   Redeemer: ${redeemer}`);

    // Build unlock TX
    const unlockTx = await lucid
        .newTx()
        .attach.Script(simpleValidator)
        .collectFrom([lockedUtxo], redeemer)
        .addSigner(adminAddress)  // Admin signature
        .pay.ToAddress(USER1_DESTINATION, { lovelace: 10_000_000n })  // 10 ADA to User1
        .pay.ToContract(  // Rest back to validator
            validatorAddress,
            { kind: "inline", value: Data.to(42n) },
            { lovelace: 90_000_000n }
        )
        .complete();

    console.log(`   ✅ Transaction built!`);

    const unlockSigned = await unlockTx.sign.withWallet().complete();
    const unlockTxHash = await unlockSigned.submit();

    console.log(`   ✅ Submitted! TX: ${unlockTxHash}\n`);

    await lucid.awaitTx(unlockTxHash);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SUCCESS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Lock TX:   https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
    console.log(`Unlock TX: https://preprod.cardanoscan.io/transaction/${unlockTxHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
