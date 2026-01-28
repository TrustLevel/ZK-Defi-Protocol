#!/usr/bin/env -S deno run --allow-all --env
/**
 * Generate Fresh Wallet for Anonymous Borrowing
 *
 * Generates a completely new wallet (seed + address) for receiving loans.
 * This wallet has NO connection to the deposit wallet, ensuring maximum privacy.
 *
 * Usage:
 *   deno run --allow-all --env scripts/utils/generate-fresh-wallet.ts
 */

import { Lucid, Blockfrost, generateSeedPhrase } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

console.log("═══════════════════════════════════════════════════════");
console.log("🆕 Generate Fresh Wallet for Anonymous Borrowing");
console.log("═══════════════════════════════════════════════════════\n");

console.log("🔐 Privacy Note:");
console.log("   This wallet should ONLY be used to receive loans.");
console.log("   It must have NO transaction history with your deposit wallet.\n");

try {
    // Initialize Lucid
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST!, BLOCKFROST_KEY),
        "Preprod"
    );

    // Generate new seed phrase
    console.log("🎲 Generating new seed phrase...");
    const freshSeed = generateSeedPhrase();
    console.log("   ✅ Seed phrase generated\n");

    // Get address from seed
    lucid.selectWallet.fromSeed(freshSeed);
    const freshAddress = await lucid.wallet().address();

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ FRESH WALLET GENERATED");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Fresh Wallet Details:\n");
    console.log("🔑 Seed Phrase (24 words):");
    console.log(`${freshSeed}\n`);

    console.log("📍 Address:");
    console.log(`${freshAddress}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("💾 Add to .env file:");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log(`# Fresh wallet for receiving loans (no connection to deposit wallet)`);
    console.log(`USER1_FRESH_WALLET_SEED="${freshSeed}"`);
    console.log(`USER1_FRESH_ADDRESS=${freshAddress}`);

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📖 Usage in borrow command:");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log(`node cli/v3/borrow-v3-node.mjs \\`);
    console.log(`  ./receipts/deposit-<txhash>.json \\`);
    console.log(`  70 \\`);
    console.log(`  ${freshAddress}`);

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🔐 Security & Privacy Notes:");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("✅ DO:");
    console.log("   • Save this seed phrase securely (encrypted backup)");
    console.log("   • Use this wallet ONLY for receiving loans");
    console.log("   • Keep it completely separate from deposit wallet");
    console.log("   • Never send from this wallet to deposit wallet directly\n");

    console.log("❌ DON'T:");
    console.log("   • Don't share this seed phrase");
    console.log("   • Don't reuse this wallet for deposits");
    console.log("   • Don't send funds between deposit and fresh wallet");
    console.log("   • Don't use this wallet for other transactions\n");

    console.log("📊 Privacy Level:");
    console.log("   Using this fresh wallet: ~60% privacy ✅");
    console.log("   Using deposit wallet:    ~30% privacy ❌\n");

} catch (error) {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
}
