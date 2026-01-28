#!/usr/bin/env -S deno run --allow-all --env
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";
const BEACON_POLICY = Deno.env.get("BEACON_POLICY_ID");

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_ENDPOINT!, BLOCKFROST_KEY),
    "Preprod"
);

lucid.selectWallet.fromSeed(ADMIN_SEED!);
const utxos = await lucid.wallet().getUtxos();

console.log("\n═══════════════════════════════════════════════════════");
console.log("📦 Admin Wallet Assets");
console.log("═══════════════════════════════════════════════════════\n");

const poolBeaconUnit = BEACON_POLICY + "4c454e44494e47504f4f4c"; // LENDINGPOOL
const depositBeaconUnit = BEACON_POLICY + "4445504f534954"; // DEPOSIT

let hasPoolBeacon = false;
let hasDepositBeacon = false;

for (const utxo of utxos) {
    console.log(`UTXO: ${utxo.txHash}#${utxo.outputIndex}`);
    console.log(`  ADA: ${Number(utxo.assets.lovelace) / 1_000_000}`);

    const assets = Object.entries(utxo.assets).filter(([unit]) => unit !== "lovelace");
    if (assets.length > 0) {
        console.log("  Tokens:");
        for (const [unit, qty] of assets) {
            if (unit === poolBeaconUnit) {
                console.log(`    ✅ LENDINGPOOL beacon: ${qty}`);
                hasPoolBeacon = true;
            } else if (unit === depositBeaconUnit) {
                console.log(`    ✅ DEPOSIT beacon: ${qty}`);
                hasDepositBeacon = true;
            } else {
                console.log(`    ${unit.slice(0, 10)}...: ${qty}`);
            }
        }
    }
    console.log("");
}

console.log("═══════════════════════════════════════════════════════");
console.log("Token Status:");
console.log(`  LENDINGPOOL beacon: ${hasPoolBeacon ? "✅ Found" : "❌ Missing"}`);
console.log(`  DEPOSIT beacon: ${hasDepositBeacon ? "✅ Found" : "❌ Missing"}`);
console.log("═══════════════════════════════════════════════════════\n");

if (!hasPoolBeacon || !hasDepositBeacon) {
    console.log("⚠️  Some beacon tokens are missing!");
    console.log("   Run: deno run --allow-all --env scripts/3-mint-beacons.ts\n");
}
