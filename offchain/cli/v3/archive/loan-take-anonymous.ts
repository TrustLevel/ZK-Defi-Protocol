#!/usr/bin/env -S deno run --allow-net --allow-env --env --allow-read --allow-write
/**
 * Anonymous Loan Request Script
 * Creates a borrow request for anonymous borrowing
 *
 * This script:
 * 1. Reads your secret from secrets.json
 * 2. Fetches the collateral UTXO from blockchain
 * 3. Calculates the Poseidon commitment
 * 4. Creates a borrow request file for backend processing
 *
 * Usage:
 *   deno task borrow-anonymous <utxo-ref> <loan-amount> <loan-term> <destination>
 *
 * Example:
 *   deno task borrow-anonymous abc123def...#0 700000000 3888000000 addr_test1qz...
 *
 * Arguments:
 *   utxo-ref: Your collateral UTXO (format: txHash#index)
 *   loan-amount: Loan amount in lovelace (e.g., 700000000 = 700 ADA)
 *   loan-term: Loan term in milliseconds (e.g., 3888000000 = 45 days)
 *   destination: Your address to receive the loan
 */

import { Lucid, Blockfrost, Network } from "@lucid-evolution/lucid";
import { buildPoseidon } from "circomlibjs";

const BLOCKFROST_API_KEY = Deno.env.get("BLOCKFROST_API_KEY") || "";
const NETWORK = (Deno.env.get("NETWORK") || "Preprod") as Network;
const SECRETS_FILE = "./secrets.json";
const OUTPUT_FILE = "./borrow-request.json";

/**
 * Parse UTXO reference string
 */
function parseUtxoRef(utxoRef: string): { txHash: string; outputIndex: number } {
  const [txHash, indexStr] = utxoRef.split("#");
  if (!txHash || !indexStr) {
    throw new Error("Invalid UTXO reference format. Expected: txHash#index");
  }
  return {
    txHash,
    outputIndex: parseInt(indexStr),
  };
}

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
 * Calculate Poseidon commitment
 */
async function calculateCommitment(
  collateral_amount: bigint,
  secret: bigint
): Promise<string> {
  const poseidon = await buildPoseidon();
  const commitment = poseidon.F.toString(poseidon([collateral_amount, secret]));
  return commitment;
}

/**
 * Format lovelace to ADA
 */
function formatAda(lovelace: string | bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return `${ada.toFixed(2)} ADA`;
}

/**
 * Format milliseconds to human readable duration
 */
function formatDuration(ms: string): string {
  const days = Math.floor(Number(ms) / (1000 * 60 * 60 * 24));
  return `${days} days`;
}

/**
 * Main function: Create anonymous borrow request
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔐 Anonymous Borrow Request Creation");
  console.log("═══════════════════════════════════════════════════════\n");

  // Parse CLI arguments
  if (Deno.args.length < 4) {
    console.error("❌ ERROR: Missing required arguments\n");
    console.error("Usage:");
    console.error("  deno task borrow-anonymous <utxo-ref> <loan-amount> <loan-term> <destination>\n");
    console.error("Example:");
    console.error("  deno task borrow-anonymous abc123def...#0 700000000 3888000000 addr_test1qz...\n");
    console.error("Arguments:");
    console.error("  utxo-ref: Your collateral UTXO (format: txHash#index)");
    console.error("  loan-amount: Loan amount in lovelace (e.g., 700000000 = 700 ADA)");
    console.error("  loan-term: Loan term in milliseconds (e.g., 3888000000 = 45 days)");
    console.error("  destination: Your address to receive the loan");
    Deno.exit(1);
  }

  const [utxoRef, loanAmountStr, loanTermStr, destination] = Deno.args;

  // Validate inputs
  if (!utxoRef.includes("#")) {
    console.error("❌ ERROR: Invalid UTXO reference format");
    console.error("Expected format: txHash#index");
    Deno.exit(1);
  }

  const loanAmount = loanAmountStr;
  const loanTerm = loanTermStr;

  console.log("📋 Request Parameters:");
  console.log(`   Collateral UTXO: ${utxoRef}`);
  console.log(`   Loan Amount: ${formatAda(loanAmount)} (${loanAmount} lovelace)`);
  console.log(`   Loan Term: ${formatDuration(loanTerm)} (${loanTerm} ms)`);
  console.log(`   Destination: ${destination}\n`);

  // Check for required environment variables
  if (!BLOCKFROST_API_KEY) {
    console.error("❌ ERROR: BLOCKFROST_API_KEY not set");
    console.error("Please set BLOCKFROST_API_KEY in your .env file\n");
    Deno.exit(1);
  }

  // Read secret from secrets.json
  console.log("🔑 Reading secret from secrets.json...");
  let secretData;
  try {
    const secretJson = await Deno.readTextFile(SECRETS_FILE);
    secretData = JSON.parse(secretJson);
    console.log("   ✅ Secret loaded\n");
  } catch (error) {
    console.error(`   ❌ Failed to read ${SECRETS_FILE}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n   Did you run: deno task generate-secret ?\n`);
    Deno.exit(1);
  }

  const secret = secretData.secret;
  if (!secret) {
    console.error("❌ ERROR: Secret not found in secrets.json");
    Deno.exit(1);
  }

  // Initialize Lucid
  console.log(`🌐 Connecting to ${NETWORK} network...`);
  const lucid = await initLucid();
  console.log("   ✅ Connected\n");

  // Fetch collateral UTXO
  console.log(`🔎 Fetching collateral UTXO: ${utxoRef}...`);
  const { txHash, outputIndex } = parseUtxoRef(utxoRef);

  let utxo;
  try {
    const utxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);
    if (utxos.length === 0) {
      console.error("   ❌ UTXO not found on blockchain");
      console.error("\n   Make sure:");
      console.error("   1. The UTXO reference is correct");
      console.error("   2. The UTXO exists on the blockchain");
      console.error("   3. You're using the correct network (Preprod/Mainnet)\n");
      Deno.exit(1);
    }
    utxo = utxos[0];
    console.log(`   ✅ UTXO found: ${formatAda(utxo.assets.lovelace)}\n`);
  } catch (error) {
    console.error(`   ❌ Error fetching UTXO: ${error instanceof Error ? error.message : String(error)}\n`);
    Deno.exit(1);
  }

  const collateralAmount = utxo.assets.lovelace.toString();

  // Calculate commitment
  console.log("🔐 Calculating Poseidon commitment...");
  const commitment = await calculateCommitment(
    BigInt(collateralAmount),
    BigInt(secret)
  );
  console.log(`   Commitment: ${commitment}\n`);

  // Validate collateral ratio (150% = 1.5x loan amount)
  const collateralValue = BigInt(collateralAmount);
  const loanValue = BigInt(loanAmount);
  const requiredCollateral = (loanValue * 150n) / 100n;

  console.log("📊 Collateral Check:");
  console.log(`   Collateral: ${formatAda(collateralAmount)}`);
  console.log(`   Loan: ${formatAda(loanAmount)}`);
  console.log(`   Required (150%): ${formatAda(requiredCollateral.toString())}`);

  if (collateralValue < requiredCollateral) {
    console.error(`\n   ❌ ERROR: Insufficient collateral!`);
    console.error(`   You need at least ${formatAda(requiredCollateral.toString())} for this loan\n`);
    Deno.exit(1);
  }
  console.log(`   ✅ Collateral sufficient (${((Number(collateralValue) / Number(loanValue)) * 100).toFixed(1)}%)\n`);

  // Create borrow request
  const borrowRequest = {
    secret,
    collateral_utxo: utxoRef,
    loan_amount: loanAmount,
    loan_term: loanTerm,
    destination,
    // Metadata for reference
    _metadata: {
      collateral_amount: collateralAmount,
      commitment,
      created_at: new Date().toISOString(),
      network: NETWORK,
    },
  };

  // Save to file
  console.log(`💾 Saving borrow request to: ${OUTPUT_FILE}...`);
  await Deno.writeTextFile(
    OUTPUT_FILE,
    JSON.stringify(borrowRequest, null, 2)
  );
  console.log("   ✅ Request saved\n");

  // Display summary
  console.log("═══════════════════════════════════════════════════════");
  console.log("✅ Borrow Request Created Successfully!");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`\nFile: ${OUTPUT_FILE}`);
  console.log(`\nRequest Summary:`);
  console.log(`  Collateral: ${formatAda(collateralAmount)} (UTXO: ${utxoRef})`);
  console.log(`  Loan: ${formatAda(loanAmount)} for ${formatDuration(loanTerm)}`);
  console.log(`  Destination: ${destination}`);
  console.log(`  Commitment: ${commitment.substring(0, 40)}...`);

  console.log("\n📤 Next Steps:");
  console.log("   1. Review the borrow-request.json file");
  console.log("   2. Submit to backend proving service:");
  console.log(`      deno task admin:prove-and-borrow ${OUTPUT_FILE}`);
  console.log("   3. Wait for backend to generate ZK proof and submit transaction");
  console.log("   4. Loan will be issued to your destination address anonymously!");

  console.log("\n⚠️  Security Reminder:");
  console.log("   - Keep your secret secure!");
  console.log("   - The borrow-request.json file contains your secret");
  console.log("   - Delete it after submission or store securely");
  console.log("\n═══════════════════════════════════════════════════════");
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
