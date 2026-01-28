#!/usr/bin/env -S deno run --allow-all --env
/**
 * Configure Backend Service
 *
 * Sets BACKEND_BORROW_ADDR and BACKEND_REPAYMENT_ADDR in .env
 * (Uses admin wallet address)
 */

import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

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
console.log("⚙️  Configuring Backend Service");
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

    console.log("1️⃣  Setting backend addresses in .env...");
    const envPath = "../.env";
    let envContent = await Deno.readTextFile(envPath);

    // Remove old addresses if exist
    envContent = envContent.replace(/^BACKEND_BORROW_ADDR=.*$/m, "");
    envContent = envContent.replace(/^BACKEND_REPAYMENT_ADDR=.*$/m, "");

    // Add new addresses
    envContent += `\nBACKEND_BORROW_ADDR=${adminAddress}\n`;
    envContent += `BACKEND_REPAYMENT_ADDR=${adminAddress}\n`;

    await Deno.writeTextFile(envPath, envContent);

    console.log("   ✅ Backend addresses configured");

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("✅ BACKEND CONFIGURED!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Configuration:");
    console.log(`   BACKEND_BORROW_ADDR=${adminAddress}`);
    console.log(`   BACKEND_REPAYMENT_ADDR=${adminAddress}\n`);

    console.log("💡 Next Step:");
    console.log("   Start backend: deno task backend-v3");

} catch (error) {
    console.error("\n❌ Configuration failed:", error.message);
    Deno.exit(1);
}
