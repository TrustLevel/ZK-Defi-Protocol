#!/usr/bin/env -S deno run --allow-all --env
/**
 * Verify Complete Deployment
 *
 * Checks all components are properly deployed and configured:
 * - Smart contracts
 * - Beacon tokens
 * - Lending pool
 * - Backend configuration
 * - Environment variables
 */

import { Lucid, Blockfrost, Data } from "@lucid-evolution/lucid";
import { V3LendingPoolDatumSchema } from "../../lib/types.ts";

console.log("═══════════════════════════════════════════════════════");
console.log("🔍 Deployment Verification");
console.log("═══════════════════════════════════════════════════════\n");

// Track results
const results: { name: string; status: boolean; message?: string }[] = [];

// Check 1: Environment Variables
console.log("1️⃣  Checking Environment Variables...");
const requiredVars = [
    "ADMIN_WALLET_SEED",
    "COLLATERAL_V3_ADDRESS",
    "LENDING_POOL_V3_ADDRESS",
    "BEACON_POLICY_ID",
    "BACKEND_BORROW_ADDR",
    "BACKEND_REPAYMENT_ADDR",
];

let allVarsPresent = true;
for (const varName of requiredVars) {
    const value = Deno.env.get(varName);
    if (!value) {
        console.log(`   ❌ ${varName}: NOT SET`);
        results.push({ name: `Env: ${varName}`, status: false });
        allVarsPresent = false;
    } else {
        console.log(`   ✅ ${varName}: ${value.substring(0, 20)}...`);
        results.push({ name: `Env: ${varName}`, status: true });
    }
}

if (!allVarsPresent) {
    console.log("\n❌ Missing required environment variables!");
    console.log("   Run deployment scripts 2-5 first.");
    Deno.exit(1);
}

// Check 2: Blockchain Connectivity
console.log("\n2️⃣  Testing Blockchain Connection...");
try {
    const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
    const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

    if (!BLOCKFROST_ENDPOINT) {
        console.error("❌ PREPROD_BLOCKFROST not set in .env");
        Deno.exit(1);
    }

    const lucid = await Lucid(
        new Blockfrost(
            BLOCKFROST_ENDPOINT,
            BLOCKFROST_KEY
        ),
        "Preprod"
    );

    lucid.selectWallet.fromSeed(Deno.env.get("ADMIN_WALLET_SEED")!);
    const address = await lucid.wallet().address();
    console.log(`   ✅ Connected to Preprod`);
    console.log(`   ✅ Admin wallet: ${address.substring(0, 30)}...`);
    results.push({ name: "Blockchain Connection", status: true });

    // Check 3: Admin Wallet Balance
    console.log("\n3️⃣  Checking Admin Wallet Balance...");
    const utxos = await lucid.wallet().getUtxos();
    const totalLovelace = utxos.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n);
    const totalAda = Number(totalLovelace) / 1_000_000;

    console.log(`   Balance: ${totalAda.toFixed(2)} ADA`);
    if (totalAda >= 50) {
        console.log(`   ✅ Sufficient balance`);
        results.push({ name: "Admin Balance", status: true });
    } else {
        console.log(`   ⚠️  Low balance (< 50 ADA)`);
        results.push({ name: "Admin Balance", status: false, message: "Low balance" });
    }

    // Check 4: Beacon Token (LENDINGPOOL only)
    console.log("\n4️⃣  Verifying Beacon Token...");
    const BEACON_POLICY = Deno.env.get("BEACON_POLICY_ID")!;
    const POOL_TOKEN = BEACON_POLICY + "4c454e44494e47504f4f4c";

    let poolFound = false;

    for (const utxo of utxos) {
        if (utxo.assets[POOL_TOKEN]) {
            poolFound = true;
            console.log(`   ✅ LENDINGPOOL token found (qty: ${utxo.assets[POOL_TOKEN]})`);
        }
    }

    results.push({ name: "LENDINGPOOL Beacon", status: poolFound });

    if (!poolFound) {
        console.log(`   ⚠️  LENDINGPOOL token not in wallet (should be in pool)`);
    }

    // Check 5: Lending Pool UTXO
    console.log("\n5️⃣  Verifying Lending Pool...");
    const POOL_ADDRESS = Deno.env.get("LENDING_POOL_V3_ADDRESS")!;
    const poolUtxos = await lucid.utxosAt(POOL_ADDRESS);

    const poolUtxo = poolUtxos.find(utxo => utxo.assets[POOL_TOKEN] === 1n);

    if (poolUtxo) {
        console.log(`   ✅ Pool UTXO found: ${poolUtxo.txHash.substring(0, 20)}...#${poolUtxo.outputIndex}`);
        console.log(`   ✅ Value: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA`);

        // Parse datum
        if (poolUtxo.datum) {
            const datum = Data.from(poolUtxo.datum, V3LendingPoolDatumSchema);
            console.log(`   ✅ Total Deposited: ${Number(datum.total_deposited) / 1_000_000} ADA`);
            console.log(`   ✅ Total Borrowed: ${Number(datum.total_borrowed) / 1_000_000} ADA`);
            console.log(`   ✅ Interest Rate: ${Number(datum.interest_rate) / 100}% APR`);
        }

        results.push({ name: "Lending Pool UTXO", status: true });
    } else {
        console.log(`   ❌ Pool UTXO not found`);
        console.log(`      Run script 4 to initialize pool`);
        results.push({ name: "Lending Pool UTXO", status: false });
    }

    // Check 6: Backend Health
    console.log("\n6️⃣  Testing Backend API...");
    try {
        const response = await fetch("http://localhost:3000/api/health");
        if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ Backend responding`);
            console.log(`   ✅ Version: ${data.version}`);
            results.push({ name: "Backend API", status: true });
        } else {
            console.log(`   ❌ Backend not healthy (status: ${response.status})`);
            results.push({ name: "Backend API", status: false });
        }
    } catch (error) {
        console.log(`   ⚠️  Backend not running`);
        console.log(`      Start with: deno task backend-v3`);
        results.push({ name: "Backend API", status: false, message: "Not running" });
    }

} catch (error) {
    console.error("\n❌ Verification failed:", error.message);
    Deno.exit(1);
}

// Print Summary
console.log("\n═══════════════════════════════════════════════════════");
console.log("📊 VERIFICATION SUMMARY");
console.log("═══════════════════════════════════════════════════════\n");

const passed = results.filter(r => r.status).length;
const total = results.length;

for (const result of results) {
    const icon = result.status ? "✅" : "❌";
    const msg = result.message ? ` (${result.message})` : "";
    console.log(`${icon} ${result.name}${msg}`);
}

console.log(`\nScore: ${passed}/${total} checks passed\n`);

if (passed === total) {
    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ALL CHECKS PASSED!");
    console.log("✅ SYSTEM READY FOR TESTING!");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("💡 Next Steps:");
    console.log("   1. Start backend (if not running): deno task backend-v3");
    console.log("   2. Run integration tests:");
    console.log("      - Deposit:  deno task deposit-v3 100");
    console.log("      - Borrow:   deno task borrow-v3 <receipt> 70");
    console.log("      - Repay:    deno task repay-v3 <receipt> 70");
    console.log("      - Withdraw: deno task withdraw-v3 <receipt>");
} else {
    console.log("═══════════════════════════════════════════════════════");
    console.log("⚠️  SOME CHECKS FAILED");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("💡 Fix issues before testing:");
    for (const result of results) {
        if (!result.status) {
            console.log(`   • ${result.name}`);
        }
    }
}
