#!/usr/bin/env -S deno run --allow-all --env
/**
 * Debug wallet connection and UTXO structure
 */

import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");

if (!ADMIN_SEED) {
    console.error("❌ ADMIN_WALLET_SEED not set");
    Deno.exit(1);
}

try {
    console.log("🔍 Debugging wallet connection...\n");

    const lucid = await Lucid(
        new Blockfrost(
            `https://cardano-preprod.blockfrost.io/api/v0`,
            "blockfrost1he7uy2whn7zfqzlw2m7"
        ),
        "Preprod"
    );

    lucid.selectWallet.fromSeed(ADMIN_SEED);
    const address = await lucid.wallet().address();

    console.log(`✅ Wallet address: ${address}\n`);

    const utxos = await lucid.wallet().getUtxos();
    console.log(`📦 Number of UTXOs: ${utxos.length}\n`);

    if (utxos.length === 0) {
        console.log("❌ Wallet has NO UTXOs!");
        console.log("   The wallet needs to be funded first.");
        console.log("\n📍 Get test ADA from faucet:");
        console.log("   https://docs.cardano.org/cardano-testnet/tools/faucet/");
        console.log(`\n   Your address: ${address}`);
    } else {
        console.log("UTXO structure:");
        console.log(JSON.stringify(utxos[0], null, 2));
    }

} catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
}
