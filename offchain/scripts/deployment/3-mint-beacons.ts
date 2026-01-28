#!/usr/bin/env -S deno run --allow-all --env
/**
 * Mint Beacon Tokens for V3
 *
 * Mints:
 * - DEPOSIT beacon (for collateral UTXOs)
 * - LENDINGPOOL beacon (for pool UTXO)
 *
 * Saves policy ID to .env
 */

import { Lucid, Blockfrost, MintingPolicy, PolicyId, getAddressDetails, scriptFromNative, mintingPolicyToId } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

if (!ADMIN_SEED) {
    console.error("❌ ADMIN_WALLET_SEED not set in .env");
    Deno.exit(1);
}

if (!BLOCKFROST_ENDPOINT) {
    console.error("❌ PREPROD_BLOCKFROST not set in .env");
    Deno.exit(1);
}

console.log("═══════════════════════════════════════════════════════");
console.log("🪙 Minting Beacon Tokens");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(
            BLOCKFROST_ENDPOINT,
            BLOCKFROST_KEY
        ),
        "Preprod"
    );

    lucid.selectWallet.fromSeed(ADMIN_SEED);
    const adminAddress = await lucid.wallet().address();

    console.log(`Admin Address: ${adminAddress}\n`);

    // Create simple minting policy (one-time mint)
    console.log("1️⃣  Creating minting policy...");
    const { paymentCredential } = getAddressDetails(adminAddress);

    const mintingPolicy: MintingPolicy = scriptFromNative({
        type: "all",
        scripts: [
            {
                type: "sig",
                keyHash: paymentCredential!.hash,
            },
        ],
    });

    const policyId: PolicyId = mintingPolicyToId(mintingPolicy);
    console.log(`   ✅ Policy ID: ${policyId}`);

    // Token names (hex encoded)
    const POOL_TOKEN = "4c454e44494e47504f4f4c"; // "LENDINGPOOL" in hex

    console.log("\n2️⃣  Building mint transaction...");
    console.log(`   Minting: LENDINGPOOL token (1x)`);

    // Build transaction
    const tx = await lucid
        .newTx()
        .mintAssets({
            [policyId + POOL_TOKEN]: 1n,
        })
        .attach.Script(mintingPolicy)
        .addSignerKey(paymentCredential!.hash)
        .complete();

    console.log("\n3️⃣  Signing transaction...");
    const signedTx = await tx.sign.withWallet().complete();
    const txHash = await signedTx.submit();

    console.log(`   ✅ TX Hash: ${txHash}`);
    console.log("\n⏳ Waiting for confirmation...");

    await lucid.awaitTx(txHash);

    console.log("   ✅ Transaction confirmed!");

    // Save policy ID to .env
    console.log("\n4️⃣  Saving policy ID to .env...");
    const envPath = "../.env";
    let envContent = await Deno.readTextFile(envPath);
    envContent = envContent.replace(/^BEACON_POLICY_ID=.*$/m, "");
    envContent += `\nBEACON_POLICY_ID=${policyId}\n`;
    await Deno.writeTextFile(envPath, envContent);

    console.log("   ✅ BEACON_POLICY_ID saved");

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("✅ BEACON TOKEN MINTED SUCCESSFULLY!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Summary:");
    console.log(`   Policy ID: ${policyId}`);
    console.log(`   LENDINGPOOL token: 1\n`);

    console.log("🔗 View on Explorer:");
    console.log(`   https://preprod.cardanoscan.io/transaction/${txHash}`);

} catch (error) {
    console.error("\n❌ Minting failed:", error.message);
    Deno.exit(1);
}
