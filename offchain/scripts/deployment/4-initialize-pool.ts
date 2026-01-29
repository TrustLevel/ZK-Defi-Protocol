#!/usr/bin/env -S deno run --allow-all --env
/**
 * Initialize Lending Pool V3
 *
 * Creates initial pool UTXO with:
 * - 1000 ADA liquidity
 * - LENDINGPOOL beacon token
 * - Initial datum (total_deposited=0, total_borrowed=0)
 */

import { Lucid, Blockfrost, Data, getAddressDetails } from "@lucid-evolution/lucid";
import { V3LendingPoolDatumSchema } from "../../lib/types.ts";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const POOL_ADDRESS = Deno.env.get("LENDING_POOL_V3_ADDRESS");
const BEACON_POLICY = Deno.env.get("BEACON_POLICY_ID");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

if (!POOL_ADDRESS || !BEACON_POLICY) {
    console.error("❌ Missing required env variables:");
    console.error("   LENDING_POOL_V3_ADDRESS");
    console.error("   BEACON_POLICY_ID");
    console.error("\n   Run scripts 2 and 3 first!");
    Deno.exit(1);
}

if (!BLOCKFROST_ENDPOINT) {
    console.error("❌ PREPROD_BLOCKFROST not set in .env");
    Deno.exit(1);
}

// Initial liquidity (in ADA)
const INITIAL_LIQUIDITY = 1000;
const LIQUIDITY_LOVELACE = BigInt(INITIAL_LIQUIDITY * 1_000_000);

console.log("═══════════════════════════════════════════════════════");
console.log("🏦 Initializing Lending Pool V3");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(
            BLOCKFROST_ENDPOINT,
            BLOCKFROST_KEY
        ),
        "Preprod"
    );

    lucid.selectWallet.fromSeed(ADMIN_SEED!);
    const adminAddress = await lucid.wallet().address();
    const adminPkh = getAddressDetails(adminAddress).paymentCredential?.hash;

    console.log(`Admin Address: ${adminAddress}`);
    console.log(`Pool Address: ${POOL_ADDRESS}`);
    console.log(`Initial Liquidity: ${INITIAL_LIQUIDITY} ADA\n`);

    // Create initial pool datum
    // Fields in DECLARATION ORDER (matches Aiken definition)
    // IMPORTANT: DO NOT wrap! Inline datums are automatically "Some" - Lucid unwraps them automatically
    console.log("1️⃣  Creating pool datum...");
    const poolDatum = Data.to({
        total_deposited: 0n,
        total_borrowed: 0n,
        interest_rate: 500n, // 5% APR (500 basis points)
        last_updated: BigInt(Date.now()), // Current timestamp
    } as any, V3LendingPoolDatumSchema);

    console.log("   ✅ Datum created");
    console.log(`      Total Deposited: 0 ADA`);
    console.log(`      Total Borrowed: 0 ADA`);
    console.log(`      Interest Rate: 5% APR (500 bps)`);
    console.log(`      Last Updated: ${new Date().toISOString()}`);

    // Beacon token unit
    const poolBeaconUnit = BEACON_POLICY + "4c454e44494e47504f4f4c"; // LENDINGPOOL

    console.log("\n2️⃣  Building initialization transaction...");

    // Build transaction
    const tx = await lucid
        .newTx()
        .pay.ToContract(
            POOL_ADDRESS,
            { kind: "inline", value: poolDatum },
            {
                lovelace: LIQUIDITY_LOVELACE,
                [poolBeaconUnit]: 1n,
            }
        )
        .complete();

    console.log("   ✅ Transaction built");

    console.log("\n3️⃣  Signing transaction...");
    const signedTx = await tx.sign.withWallet().complete();
    const txHash = await signedTx.submit();

    console.log(`   ✅ TX Hash: ${txHash}`);
    console.log("\n⏳ Waiting for confirmation...");

    await lucid.awaitTx(txHash);

    console.log("   ✅ Transaction confirmed!");

    // Query created UTXO
    console.log("\n4️⃣  Verifying pool UTXO...");
    const poolUtxos = await lucid.utxosAt(POOL_ADDRESS);
    const poolUtxo = poolUtxos.find(utxo => utxo.assets[poolBeaconUnit] === 1n);

    if (poolUtxo) {
        console.log(`   ✅ Pool UTXO found: ${poolUtxo.txHash}#${poolUtxo.outputIndex}`);
        console.log(`   ✅ Value: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA`);
    }

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("✅ LENDING POOL INITIALIZED!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Pool Details:");
    console.log(`   TX Hash: ${txHash}`);
    console.log(`   Address: ${POOL_ADDRESS}`);
    console.log(`   Liquidity: ${INITIAL_LIQUIDITY} ADA`);
    console.log(`   Total Deposited: 0 ADA`);
    console.log(`   Total Borrowed: 0 ADA`);
    console.log(`   Max LTV: 80%`);
    console.log(`   Interest Rate: 5% APR\n`);

    console.log("🔗 View on Explorer:");
    console.log(`   https://preprod.cardanoscan.io/transaction/${txHash}`);

    console.log("\n💡 Next Step:");
    console.log("   Configure backend: deno run scripts/5-configure-backend.ts");

} catch (error) {
    console.error("\n❌ Initialization failed:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
