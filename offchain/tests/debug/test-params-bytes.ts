#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST WITH PARAMETERS AS DATA.BYTES
 * Encode each parameter explicitly as Data.Bytes()
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const BEACON_POLICY_ID = Deno.env.get("BEACON_POLICY_ID")!;
const USER1 = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 TEST WITH PARAMETERS AS DATA.BYTES");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    const adminAddress = await lucid.wallet().address();

    console.log("📜 Loading validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_with_params.test_with_params.spend"
    );

    if (!validator) throw new Error("Validator not found");

    // Get admin key hash
    const adminDetails = getAddressDetails(adminAddress);
    const adminKeyHash = adminDetails.paymentCredential!.hash;

    console.log("🔧 Applying parameters as Data.Bytes()...");
    console.log(`   beacon_policy: ${BEACON_POLICY_ID}`);
    console.log(`   admin_key_hash: ${adminKeyHash}\n`);

    // Try encoding each parameter explicitly
    const beaconPolicyData = Data.to(BEACON_POLICY_ID, Data.Bytes());
    const adminKeyHashData = Data.to(adminKeyHash, Data.Bytes());

    const parameterizedScript = applyParamsToScript(validator.compiledCode, [
        beaconPolicyData,
        adminKeyHashData,
    ]);

    const script = {
        type: "PlutusV3" as const,
        script: parameterizedScript,
    };

    const address = validatorToAddress("Preprod", script);
    console.log(`   ✅ Address: ${address}\n`);

    // STEP 1: Lock
    console.log("💰 Step 1: Lock 50 ADA...");
    const lockTx = await lucid
        .newTx()
        .pay.ToContract(
            address,
            { kind: "inline", value: Data.to(1n) },  // Simple datum = 1
            { lovelace: 50_000_000n }
        )
        .complete();

    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockHash = await lockSigned.submit();
    console.log(`   ✅ TX: ${lockHash}`);
    console.log(`   ⏳ Waiting...\n`);
    await lucid.awaitTx(lockHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 2: Spend
    console.log("🔓 Step 2: Spend 10 ADA...");
    const utxos = await lucid.utxosAt(address);
    if (utxos.length === 0) throw new Error("No UTXO");

    const utxo = utxos[0];
    console.log(`   Found: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);

    const spendTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([utxo], Data.to(1n))  // Simple redeemer = 1
        .addSigner(adminAddress)  // Admin signature required
        .pay.ToAddress(USER1, { lovelace: 10_000_000n })
        .complete();

    console.log(`   ✅ Transaction built!`);

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendHash = await spendSigned.submit();

    console.log(`   ✅ TX: ${spendHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ DATA.BYTES() PARAMS WORK! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Lock:  https://preprod.cardanoscan.io/transaction/${lockHash}`);
    console.log(`Spend: https://preprod.cardanoscan.io/transaction/${spendHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
