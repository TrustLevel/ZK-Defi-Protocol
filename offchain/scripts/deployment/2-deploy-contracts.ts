#!/usr/bin/env -S deno run --allow-all --env
/**
 * Deploy V3 Smart Contracts to Preprod
 *
 * Generates script addresses for:
 * - collateral_v3.ak
 * - lending_pool_v3.ak
 *
 * Saves addresses to .env
 */

import { Lucid, Blockfrost, Script, validatorToAddress, validatorToScriptHash, Data, getAddressDetails, applyParamsToScript } from "@lucid-evolution/lucid";

const NETWORK = "Preprod";
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";
const BEACON_POLICY_ID = Deno.env.get("BEACON_POLICY_ID");

if (!ADMIN_SEED) {
    console.error("❌ ADMIN_WALLET_SEED not set in .env");
    Deno.exit(1);
}

if (!BLOCKFROST_ENDPOINT) {
    console.error("❌ PREPROD_BLOCKFROST not set in .env");
    Deno.exit(1);
}

if (!BEACON_POLICY_ID) {
    console.error("❌ BEACON_POLICY_ID not set in .env");
    Deno.exit(1);
}

console.log("═══════════════════════════════════════════════════════");
console.log("🚀 Deploying V3 Smart Contracts");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Initialize Lucid
    const lucid = await Lucid(
        new Blockfrost(
            BLOCKFROST_ENDPOINT,
            BLOCKFROST_KEY
        ),
        NETWORK
    );

    lucid.selectWallet.fromSeed(ADMIN_SEED);
    const adminAddress = await lucid.wallet().address();
    console.log(`Admin Address: ${adminAddress}\n`);

    // Extract admin key hash
    const addressDetails = getAddressDetails(adminAddress);
    const adminKeyHash = addressDetails.paymentCredential?.hash;

    if (!adminKeyHash) {
        console.error("❌ Failed to extract admin key hash");
        Deno.exit(1);
    }

    console.log(`Admin Key Hash: ${adminKeyHash}`);
    console.log(`Beacon Policy:  ${BEACON_POLICY_ID}\n`);

    // Define parameter schema (DepositContractParams)
    const DepositContractParamsSchema = Data.Object({
        beacon_policy: Data.Bytes(),
        admin_key_hash: Data.Bytes(),
    });

    // Build parameters
    const params = Data.to({
        beacon_policy: BEACON_POLICY_ID,
        admin_key_hash: adminKeyHash,
    }, DepositContractParamsSchema);

    // Read plutus.json
    console.log("📖 Reading plutus.json...");
    const validatorJson = JSON.parse(
        await Deno.readTextFile("../contracts/plutus.json")
    );

    // Deploy Collateral Contract
    console.log("\n1️⃣  Deploying Collateral V3 Contract (with parameters)...");
    const collateralValidator = validatorJson.validators.find(
        (v: any) => v.title.includes("collateral_v3")
    );

    if (!collateralValidator) {
        console.error("❌ collateral_v3 validator not found in plutus.json");
        Deno.exit(1);
    }

    // Apply parameters to collateral validator
    const parameterizedCollateralScript = applyParamsToScript(
        collateralValidator.compiledCode,
        [params]
    );

    const collateralScript: Script = {
        type: "PlutusV2",
        script: parameterizedCollateralScript,
    };

    const collateralScriptHash = validatorToScriptHash(collateralScript);
    const collateralCredential = { type: "Script" as const, hash: collateralScriptHash };
    const collateralAddress = validatorToAddress("Preprod", collateralScript, collateralCredential);
    console.log(`   ✅ Collateral Address: ${collateralAddress}`);

    // Deploy Lending Pool Contract
    console.log("\n2️⃣  Deploying Lending Pool V3 Contract (with parameters)...");
    const poolValidator = validatorJson.validators.find(
        (v: any) => v.title.includes("lending_pool_v3")
    );

    if (!poolValidator) {
        console.error("❌ lending_pool_v3 validator not found in plutus.json");
        Deno.exit(1);
    }

    // Apply parameters to lending pool validator (CRITICAL FIX!)
    const parameterizedPoolScript = applyParamsToScript(
        poolValidator.compiledCode,
        [params]
    );

    const poolScript: Script = {
        type: "PlutusV2",
        script: parameterizedPoolScript,
    };

    const poolScriptHash = validatorToScriptHash(poolScript);
    const poolCredential = { type: "Script" as const, hash: poolScriptHash };
    const poolAddress = validatorToAddress("Preprod", poolScript, poolCredential);
    console.log(`   ✅ Lending Pool Address: ${poolAddress}`);

    // Save to .env
    console.log("\n3️⃣  Saving addresses to .env...");
    const envPath = "../.env";
    let envContent = await Deno.readTextFile(envPath);

    // Remove old addresses if exist
    envContent = envContent.replace(/^COLLATERAL_V3_ADDRESS=.*$/m, "");
    envContent = envContent.replace(/^LENDING_POOL_V3_ADDRESS=.*$/m, "");

    // Add new addresses
    envContent += `\nCOLLATERAL_V3_ADDRESS=${collateralAddress}\n`;
    envContent += `LENDING_POOL_V3_ADDRESS=${poolAddress}\n`;

    await Deno.writeTextFile(envPath, envContent);

    console.log("   ✅ Addresses saved to .env");

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("✅ CONTRACTS DEPLOYED SUCCESSFULLY (WITH PARAMETERS)!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Summary:");
    console.log(`   Collateral: ${collateralAddress}`);
    console.log(`   Pool:       ${poolAddress}\n`);

    console.log("🔧 Parameters Applied:");
    console.log(`   beacon_policy:  ${BEACON_POLICY_ID}`);
    console.log(`   admin_key_hash: ${adminKeyHash}\n`);

    console.log("🔗 Verify on Explorer:");
    console.log(`   https://preprod.cardanoscan.io/address/${collateralAddress}`);
    console.log(`   https://preprod.cardanoscan.io/address/${poolAddress}\n`);

    console.log("⚠️  IMPORTANT: Old pool address will no longer work!");
    console.log("   Run 4-initialize-pool.ts to fund the new pool address.");

} catch (error) {
    console.error("\n❌ Deployment failed:", error.message);
    Deno.exit(1);
}
