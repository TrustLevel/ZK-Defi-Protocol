#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST MINIMAL POOL VALIDATOR
 *
 * Step 1: Lock 100 ADA with V3LendingPoolDatum
 * Step 2: Spend and send 10 ADA to User1
 * Step 3: Return 90 ADA to pool
 *
 * Uses test_pool_minimal validator (same structure as lending_pool_v3 but minimal logic)
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const BEACON_POLICY_ID = Deno.env.get("BEACON_POLICY_ID")!;
const USER1_DESTINATION = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 TEST MINIMAL POOL VALIDATOR");
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

    // Load minimal pool validator
    console.log("📜 Loading minimal pool validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_pool_minimal.test_pool_minimal.spend"
    );

    if (!validator) {
        throw new Error("Minimal pool validator not found");
    }

    // Get admin key hash
    const adminDetails = getAddressDetails(adminAddress);
    const adminKeyHash = adminDetails.paymentCredential!.hash;

    // Apply params (same as real pool)
    const DepositContractParamsSchema = Data.Object({
        beacon_policy: Data.Bytes(),
        admin_key_hash: Data.Bytes(),
    });

    const params = Data.to({
        beacon_policy: BEACON_POLICY_ID,
        admin_key_hash: adminKeyHash,
    }, DepositContractParamsSchema);

    const parameterizedScript = applyParamsToScript(validator.compiledCode, [params]);

    const poolValidator = {
        type: "PlutusV3" as const,
        script: parameterizedScript,
    };

    const poolAddress = validatorToAddress("Preprod", poolValidator);
    console.log(`   ✅ Pool address: ${poolAddress}\n`);

    // Define datum schema (same as real pool)
    const V3LendingPoolDatumSchema = Data.Object({
        total_deposited: Data.Integer(),
        total_borrowed: Data.Integer(),
        interest_rate: Data.Integer(),
        last_updated: Data.Integer(),
    });

    // STEP 1: Lock 100 ADA at pool
    console.log("💰 STEP 1: Lock 100 ADA at minimal pool...");

    const initialDatum = Data.to({
        total_deposited: 0n,
        total_borrowed: 0n,
        interest_rate: 500n,
        last_updated: BigInt(Date.now()),
    }, V3LendingPoolDatumSchema);

    const lockTx = await lucid
        .newTx()
        .pay.ToContract(
            poolAddress,
            { kind: "inline", value: initialDatum },
            { lovelace: 100_000_000n }
        )
        .complete();

    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockTxHash = await lockSigned.submit();

    console.log(`   ✅ Locked! TX: ${lockTxHash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    await lucid.awaitTx(lockTxHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 2: Spend from pool
    console.log("🔓 STEP 2: Spend 10 ADA from pool...");

    // Find pool UTXO
    const utxos = await lucid.utxosAt(poolAddress);
    if (utxos.length === 0) {
        throw new Error("No UTXOs found at pool");
    }

    const poolUtxo = utxos[0];
    console.log(`   Found pool UTXO: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA`);

    // Simple redeemer = just number 1
    const redeemer = Data.to(1n);
    console.log(`   Redeemer CBOR: ${redeemer}`);

    // New datum (same structure)
    const newDatum = Data.to({
        total_deposited: 0n,
        total_borrowed: 0n,
        interest_rate: 500n,
        last_updated: BigInt(Date.now()),
    }, V3LendingPoolDatumSchema);

    // Build unlock TX
    const unlockTx = await lucid
        .newTx()
        .attach.Script(poolValidator)
        .collectFrom([poolUtxo], redeemer)
        .addSigner(adminAddress)  // Admin signature (validator checks this!)
        .pay.ToAddress(USER1_DESTINATION, { lovelace: 10_000_000n })  // 10 ADA to User1
        .pay.ToContract(  // Rest back to pool
            poolAddress,
            { kind: "inline", value: newDatum },
            { lovelace: 90_000_000n }
        )
        .complete();

    console.log(`   ✅ Transaction built!`);

    const unlockSigned = await unlockTx.sign.withWallet().complete();
    const unlockTxHash = await unlockSigned.submit();

    console.log(`   ✅ Submitted! TX: ${unlockTxHash}\n`);

    await lucid.awaitTx(unlockTxHash);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ MINIMAL POOL WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Lock TX:   https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
    console.log(`Unlock TX: https://preprod.cardanoscan.io/transaction/${unlockTxHash}\n`);
    console.log("🎯 Conclusion: Basic pool structure works!");
    console.log("   Problem must be in lending_pool_v3 logic\n");

} catch (error) {
    console.error("\n❌ MINIMAL POOL FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("\n🎯 Conclusion: Basic structure is broken!");
    console.error("   Need to redesign from scratch\n");
    Deno.exit(1);
}
