#!/usr/bin/env -S deno run --allow-all --env
/**
 * Check Admin Wallet Balance
 *
 * Verifies admin wallet has sufficient funds for deployment.
 * Minimum required: 50 ADA
 * Recommended: 100+ ADA
 */

import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const NETWORK = Deno.env.get("PROVIDER_NETWORK") || "Preprod";
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

if (!ADMIN_SEED) {
    console.error("❌ ADMIN_WALLET_SEED not set in .env");
    console.error("   Please configure your wallet seed phrase");
    Deno.exit(1);
}

if (!BLOCKFROST_ENDPOINT) {
    console.error("❌ PREPROD_BLOCKFROST not set in .env");
    Deno.exit(1);
}

console.log("═══════════════════════════════════════════════════════");
console.log("💰 Admin Wallet Balance Check");
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
    const address = await lucid.wallet().address();

    console.log(`Network: ${NETWORK}`);
    console.log(`Admin Address: ${address}\n`);

    const utxos = await lucid.wallet().getUtxos();
    const totalLovelace = utxos.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n);
    const totalAda = Number(totalLovelace) / 1_000_000;

    console.log(`💰 Balance: ${totalAda.toFixed(2)} ADA`);
    console.log(`📦 UTXOs: ${utxos.length}\n`);

    if (totalAda < 50) {
        console.log("⚠️  WARNING: Balance below 50 ADA");
        console.log("   Recommended: 100+ ADA for deployment");
        console.log("\n📍 Get test ADA from faucet:");
        console.log("   https://docs.cardano.org/cardano-testnet/tools/faucet/");
        console.log(`\n   Your address: ${address}`);
        Deno.exit(1);
    } else if (totalAda < 100) {
        console.log("✅ Sufficient balance (minimum met)");
        console.log("💡 TIP: 100+ ADA recommended for comfortable deployment");
    } else {
        console.log("✅ Excellent balance for deployment!");
    }

    console.log("\n═══════════════════════════════════════════════════════");

} catch (error) {
    console.error("❌ Error checking balance:", error.message);
    Deno.exit(1);
}
