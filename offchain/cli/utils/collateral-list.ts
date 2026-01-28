#!/usr/bin/env -S deno run --allow-net --allow-env --env --allow-read
/**
 * Collateral List Script
 * Lists user's collateral UTXOs with their status
 *
 * Usage:
 *   deno task list-collateral
 */

import { Lucid, Blockfrost, Data, Network } from "@lucid-evolution/lucid";
import { CollateralDatum, collateralScriptAddr } from "../index.ts";

const BLOCKFROST_API_KEY = Deno.env.get("BLOCKFROST_API_KEY") || "";
const NETWORK = (Deno.env.get("NETWORK") || "Preprod") as Network;
const USER_ADDRESS = Deno.env.get("USER_ADDRESS") || "";

/**
 * Initialize Lucid instance
 */
async function initLucid(): Promise<Awaited<ReturnType<typeof Lucid>>> {
  const lucid = await Lucid(
    new Blockfrost(
      `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`,
      BLOCKFROST_API_KEY
    ),
    NETWORK
  );

  return lucid;
}

/**
 * Format lovelace to ADA
 */
function formatAda(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return `${ada.toFixed(2)} ADA (${lovelace} lovelace)`;
}

/**
 * Main function: List all collateral UTXOs
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("📋 Collateral UTXOs List");
  console.log("═══════════════════════════════════════════════════════\n");

  if (!BLOCKFROST_API_KEY) {
    console.error("❌ ERROR: BLOCKFROST_API_KEY not set");
    console.error("Please set BLOCKFROST_API_KEY in your .env file\n");
    Deno.exit(1);
  }

  console.log(`Network: ${NETWORK}`);
  console.log(`Collateral Script Address: ${collateralScriptAddr}\n`);

  // Initialize Lucid
  const lucid = await initLucid();

  // Query all UTXOs at collateral script address
  console.log("🔎 Fetching collateral UTXOs...\n");
  const utxos = await lucid.utxosAt(collateralScriptAddr);

  if (utxos.length === 0) {
    console.log("No collateral UTXOs found at this address.\n");
    return;
  }

  console.log(`Found ${utxos.length} collateral UTXO(s):\n`);
  console.log("═══════════════════════════════════════════════════════");

  // Process each UTXO
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    const utxoRef = `${utxo.txHash}#${utxo.outputIndex}`;

    console.log(`\n${i + 1}. UTXO: ${utxoRef}`);
    console.log(`   Amount: ${formatAda(utxo.assets.lovelace)}`);

    // Parse datum if it exists
    if (utxo.datum) {
      try {
        const datum = Data.from(utxo.datum, CollateralDatum);

        // Extract owner info
        const paymentCred = datum.owner.payment_credential;
        const paymentType = "VerificationKey" in paymentCred ? "Key" : "Script";
        const paymentHash = "VerificationKey" in paymentCred
          ? paymentCred.VerificationKey[0]
          : paymentCred.Script[0];

        console.log(`   Owner (Payment): ${paymentType} - ${paymentHash.substring(0, 16)}...`);

        // Check if user owns this
        if (USER_ADDRESS) {
          // TODO: Compare with USER_ADDRESS to determine ownership
          console.log(`   Your UTXO: (comparison not yet implemented)`);
        }

        // Check loan status
        if (datum.used_in === null) {
          console.log(`   Status: ✅ UNLOCKED (Available for borrowing)`);
          console.log(`   Loan: None`);
        } else {
          const loan = datum.used_in;
          console.log(`   Status: 🔒 LOCKED (In active loan)`);
          console.log(`   Loan Status: ${loan.status}`);
          console.log(`   Borrowed: ${formatAda(loan.borrowed_amt)}`);
          console.log(`   Interest: ${formatAda(loan.interest_amt)}`);
          console.log(`   Maturity: ${new Date(Number(loan.maturity)).toISOString()}`);
        }

        // Check for borrow commitment (anonymous borrowing)
        if (datum.borrow_commitment) {
          const commitmentHex = datum.borrow_commitment;
          console.log(`   Commitment: ${commitmentHex.substring(0, 20)}... (Anonymous borrow)`);
        } else {
          console.log(`   Commitment: None`);
        }
      } catch (error) {
        console.log(`   ⚠️  Failed to parse datum: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log(`   ⚠️  No datum found`);
    }

    console.log("───────────────────────────────────────────────────────");
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`Total: ${utxos.length} UTXO(s)`);
  console.log("═══════════════════════════════════════════════════════");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error("\n❌ ERROR:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}
