#!/usr/bin/env -S deno run --allow-all
/**
 * Backend Proving Service for Anonymous Borrowing
 *
 * This script:
 * 1. Reads a borrow request from the user
 * 2. Generates a ZK proof for ownership of collateral
 * 3. Verifies the proof
 * 4. Builds and submits a BorrowAnonymous transaction
 */

import { Lucid, Blockfrost, Kupmios, fromText, Data, UTxO, Constr, Network } from "@lucid-evolution/lucid";
import type { LucidEvolution } from "@lucid-evolution/lucid";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";

// Import contract info from lib
import {
  collateralScript,
  collateralScriptAddr,
  CollateralDatum,
  LoanStatus,
} from "../../lib/collateral.ts";
import {
  lendingPoolScript,
  lendingPoolScriptAddr,
  LendingPoolDatum,
} from "../../lib/lending-pool.ts";
import { deployDetailsFile } from "../../lib/common.ts";

// ============================================================================
// Types
// ============================================================================

interface BorrowRequest {
  secret: string;              // User's secret (as string number)
  collateral_utxo: string;     // Format: "txHash#index"
  loan_amount: string;         // In lovelace
  loan_term: string;           // In milliseconds
  destination: string;         // Cardano address
}

interface ProofResult {
  proof: any;
  publicSignals: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const CIRCUIT_WASM = "../../../circuits/collateral_proof_js/collateral_proof.wasm";
const PROVING_KEY = "../../../circuits/keys/collateral_proof_0000.zkey";
const VERIFICATION_KEY = "../../../circuits/keys/verification_key.json";

const BLOCKFROST_API_KEY = Deno.env.get("BLOCKFROST_API_KEY") || "";
const NETWORK = Deno.env.get("PROVIDER_NETWORK") || Deno.env.get("NETWORK") || "Preprod";
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED") || "";
const PREPROD_KUPO = Deno.env.get("PREPROD_KUPO") || "";
const PREPROD_OGMIOS = Deno.env.get("PREPROD_OGMIOS") || "";

// Interest calculation (5% APR for simplicity)
const INTEREST_RATE = 0.05;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse UTXO reference string into components
 */
function parseUtxoRef(utxoRef: string): { txHash: string; outputIndex: number } {
  const [txHash, indexStr] = utxoRef.split("#");
  return {
    txHash,
    outputIndex: parseInt(indexStr),
  };
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


// ============================================================================
// ZK Proof Functions
// ============================================================================

/**
 * Generate ZK proof for collateral ownership
 */
async function generateProof(
  secret: string,
  collateral_amount: string,
  loan_amount: string,
  collateral_ratio: number = 150
): Promise<ProofResult> {
  console.log("🔐 Generating ZK proof...");

  // Calculate commitment
  const commitment = await calculateCommitment(
    BigInt(collateral_amount),
    BigInt(secret)
  );

  console.log(`   Commitment: ${commitment}`);

  // Prepare circuit inputs
  const inputs = {
    commitment,
    loan_amount,
    collateral_ratio: collateral_ratio.toString(),
    secret,
    collateral_amount,
  };

  console.log(`   Collateral: ${collateral_amount} lovelace`);
  console.log(`   Loan: ${loan_amount} lovelace`);
  console.log(`   Ratio: ${collateral_ratio}%`);

  // Generate proof using snarkjs
  const startTime = Date.now();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    CIRCUIT_WASM,
    PROVING_KEY
  );

  const duration = Date.now() - startTime;
  console.log(`   ✅ Proof generated in ${duration}ms`);

  return { proof, publicSignals };
}

/**
 * Verify ZK proof
 */
async function verifyProof(
  proof: any,
  publicSignals: string[]
): Promise<boolean> {
  console.log("🔍 Verifying proof...");

  const vKey = JSON.parse(await Deno.readTextFile(VERIFICATION_KEY));
  const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);

  if (verified) {
    console.log("   ✅ Proof verified successfully");
  } else {
    console.log("   ❌ Proof verification FAILED");
  }

  return verified;
}

// ============================================================================
// Blockchain Functions
// ============================================================================

/**
 * Initialize Lucid instance
 * Prefers Kupo+Ogmios if available, falls back to Blockfrost
 */
async function initLucid(): Promise<LucidEvolution> {
  let provider;

  // Try Kupo + Ogmios first (faster and more reliable)
  if (PREPROD_KUPO && PREPROD_OGMIOS) {
    console.log("🔗 Using Kupo + Ogmios provider");
    provider = new Kupmios(PREPROD_KUPO, PREPROD_OGMIOS);
  }
  // Fallback to Blockfrost
  else if (BLOCKFROST_API_KEY) {
    console.log("🔗 Using Blockfrost provider");
    provider = new Blockfrost(
      `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`,
      BLOCKFROST_API_KEY
    );
  }
  // No provider configured
  else {
    throw new Error(
      "No blockchain provider configured. Please set either:\n" +
      "  - PREPROD_KUPO and PREPROD_OGMIOS (recommended), or\n" +
      "  - BLOCKFROST_API_KEY"
    );
  }

  const lucid = await Lucid(provider, NETWORK as Network);
  return lucid;
}

/**
 * Fetch collateral UTXO from blockchain
 */
async function fetchCollateralUtxo(
  lucid: LucidEvolution,
  utxoRef: string
): Promise<UTxO | null> {
  console.log(`🔎 Fetching collateral UTXO: ${utxoRef}`);

  const { txHash, outputIndex } = parseUtxoRef(utxoRef);

  try {
    const utxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);

    if (utxos.length === 0) {
      console.log("   ❌ UTXO not found");
      return null;
    }

    const utxo = utxos[0];
    console.log(`   ✅ UTXO found: ${utxo.assets.lovelace} lovelace`);
    return utxo;
  } catch (error) {
    console.error(`   ❌ Error fetching UTXO: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Build BorrowAnonymous transaction
 */
async function buildBorrowAnonymousTransaction(
  lucid: LucidEvolution,
  collateralUtxo: UTxO,
  commitment: string,
  loan_amount: string,
  loan_term: string,
  destination: string
): Promise<any> {
  console.log("🏗️  Building BorrowAnonymous transaction...");

  try {
    // 1. Load deployed contract info
    console.log("   📄 Loading deployed contracts...");
    const deployed = JSON.parse(
      new TextDecoder().decode(Deno.readFileSync(deployDetailsFile))
    );

    // 2. Get collateral datum from input
    console.log("   📋 Parsing collateral datum...");
    if (!collateralUtxo.datum) {
      throw new Error("Collateral UTXO has no datum");
    }

    const collateralDatum = Data.from(collateralUtxo.datum, CollateralDatum);

    // 3. Find lending pool UTXO
    console.log("   🔎 Finding lending pool UTXO...");
    const lendingPoolUtxos = await lucid.utxosAt(lendingPoolScriptAddr);

    if (lendingPoolUtxos.length === 0) {
      throw new Error("No lending pool UTXOs found");
    }

    // Find UTXO with loanable asset beacon
    const loanableBeacon = deployed.beaconPolicyId + fromText("lendingPool");
    const lendingPoolUtxo = lendingPoolUtxos.find(
      (utxo) => utxo.assets[loanableBeacon] === 1n
    );

    if (!lendingPoolUtxo) {
      throw new Error("Lending pool UTXO with beacon not found");
    }

    console.log(`   ✅ Found lending pool UTXO`);

    // 4. Parse lending pool datum
    if (!lendingPoolUtxo.datum) {
      throw new Error("Lending pool UTXO has no datum");
    }

    const lendingPoolDatum = Data.from(lendingPoolUtxo.datum, LendingPoolDatum);

    // 5. Calculate interest
    const loanAmountBigInt = BigInt(loan_amount);
    const loanTermBigInt = BigInt(loan_term);
    const loanTermYears = Number(loanTermBigInt) / (365 * 24 * 60 * 60 * 1000);
    const interestAmount = BigInt(Math.floor(Number(loanAmountBigInt) * INTEREST_RATE * loanTermYears));

    console.log(`   💰 Loan: ${loan_amount} lovelace`);
    console.log(`   📈 Interest (5% APR): ${interestAmount} lovelace`);

    // 6. Calculate maturity date
    const maturityDate = BigInt(Date.now() + Number(loanTermBigInt));

    // 7. Get loanable asset class
    const loanableAsset = {
      policy_id: lendingPoolDatum.loanable_asset.policy_id,
      asset_name: lendingPoolDatum.loanable_asset.asset_name,
    };

    // 8. Create updated collateral datum with loan + commitment
    const updatedCollateralDatum = Data.to({
      owner: collateralDatum.owner,
      used_in: {
        status: LoanStatus.LoanProcessed,
        borrowed_asset: loanableAsset,
        borrowed_amt: loanAmountBigInt,
        interest_amt: interestAmount,
        loan_term: loanTermBigInt,
        maturity: maturityDate,
      },
      borrow_commitment: commitment,
    }, CollateralDatum);

    // 9. Create updated lending pool datum (no changes needed)
    const updatedLendingPoolDatum = Data.to({
      ...lendingPoolDatum,
    }, LendingPoolDatum);

    // 10. Create BorrowAnonymous redeemer
    const redeemer = Data.to(
      new Constr(2, [ // BorrowAnonymous variant (index 2 in UnifiedRedeemer)
        commitment,
        loanAmountBigInt,
        loanTermBigInt,
        new Constr(0, [loanableAsset.policy_id, loanableAsset.asset_name]),
        destination,
      ])
    );

    // 11. Create lending pool redeemer (BorrowProcess)
    const lendingPoolRedeemer = Data.to(
      new Constr(1, []) // BorrowProcess variant
    );

    console.log("   🔨 Building transaction...");

    // 12. Calculate assets for each output
    // Collateral output: preserve all assets
    const collateralOutputAssets = collateralUtxo.assets;

    // Lending pool output: remove loaned amount
    const lendingPoolOutputAssets = { ...lendingPoolUtxo.assets };
    const loanableAssetId = loanableAsset.policy_id === ""
      ? "lovelace"
      : loanableAsset.policy_id + loanableAsset.asset_name;

    if (lendingPoolOutputAssets[loanableAssetId]) {
      lendingPoolOutputAssets[loanableAssetId] -= loanAmountBigInt;
      if (lendingPoolOutputAssets[loanableAssetId] <= 0n) {
        delete lendingPoolOutputAssets[loanableAssetId];
      }
    }

    // Loan payment to destination
    const loanPaymentAssets = { [loanableAssetId]: loanAmountBigInt };

    // 13. Build transaction
    const tx = await lucid
      .newTx()
      .collectFrom([collateralUtxo], redeemer)
      .collectFrom([lendingPoolUtxo], lendingPoolRedeemer)
      .pay.ToContract(collateralScriptAddr, { kind: "inline", value: updatedCollateralDatum }, collateralOutputAssets)
      .pay.ToContract(lendingPoolScriptAddr, { kind: "inline", value: updatedLendingPoolDatum }, lendingPoolOutputAssets)
      .pay.ToAddress(destination, loanPaymentAssets)
      .attach.SpendingValidator(collateralScript)
      .attach.SpendingValidator(lendingPoolScript)
      .complete();

    console.log("   ✅ Transaction built successfully");

    return tx;

  } catch (error) {
    console.error(`   ❌ Error building transaction: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Sign and submit transaction
 */
async function signAndSubmitTransaction(
  lucid: LucidEvolution,
  tx: any
): Promise<string> {
  console.log("✍️  Signing and submitting transaction...");

  try {
    // 1. Verify admin wallet seed is available
    if (!ADMIN_WALLET_SEED) {
      throw new Error(
        "ADMIN_WALLET_SEED environment variable is not set. " +
        "Please add it to your .env file."
      );
    }

    // 2. Select wallet in Lucid
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    console.log("   🔐 Wallet selected from seed phrase");

    // 3. Sign transaction
    console.log("   🖊️  Signing transaction...");
    const signedTx = await tx.sign().complete();

    // 4. Submit transaction to blockchain
    console.log("   📤 Submitting to blockchain...");
    const txHash = await signedTx.submit();

    console.log(`   ✅ Transaction submitted successfully`);
    console.log(`   📋 TX Hash: ${txHash}`);

    return txHash;

  } catch (error) {
    console.error(`   ❌ Error signing/submitting: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Main function: Process borrow request end-to-end
 */
async function proveAndIssueLoan(requestFile: string) {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🚀 ZK Proving Service - Anonymous Borrowing");
  console.log("═══════════════════════════════════════════════════════\n");

  // ===== 1. Load Request =====
  console.log("📄 Loading borrow request...");
  const requestJson = await Deno.readTextFile(requestFile);
  const request: BorrowRequest = JSON.parse(requestJson);

  console.log(`   Secret: ${request.secret.substring(0, 20)}...`);
  console.log(`   Collateral UTXO: ${request.collateral_utxo}`);
  console.log(`   Loan Amount: ${request.loan_amount} lovelace`);
  console.log(`   Loan Term: ${request.loan_term} ms`);
  console.log(`   Destination: ${request.destination}\n`);

  // ===== 2. Initialize Blockchain =====
  const lucid = await initLucid();
  console.log(`✅ Connected to ${NETWORK} network\n`);

  // ===== 3. Fetch Collateral UTXO =====
  const collateralUtxo = await fetchCollateralUtxo(lucid, request.collateral_utxo);

  if (!collateralUtxo) {
    console.error("\n❌ ERROR: Collateral UTXO not found");
    Deno.exit(1);
  }

  const collateral_amount = collateralUtxo.assets.lovelace.toString();
  console.log();

  // ===== 4. Generate ZK Proof =====
  const { proof, publicSignals } = await generateProof(
    request.secret,
    collateral_amount,
    request.loan_amount,
    150 // collateral ratio
  );
  console.log();

  // ===== 5. Verify Proof =====
  const verified = await verifyProof(proof, publicSignals);

  if (!verified) {
    console.error("\n❌ ERROR: Proof verification failed");
    console.error("The proof is invalid. Check your secret and amounts.");
    Deno.exit(1);
  }
  console.log();

  // Extract commitment from public signals
  const commitment = publicSignals[0];

  // ===== 6. Build Transaction =====
  const tx = await buildBorrowAnonymousTransaction(
    lucid,
    collateralUtxo,
    commitment,
    request.loan_amount,
    request.loan_term,
    request.destination
  );
  console.log();

  // ===== 7. Sign and Submit =====
  const txHash = await signAndSubmitTransaction(lucid, tx);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ Transaction submitted successfully!");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Transaction Hash: ${txHash}`);
  console.log(`Commitment: ${commitment}`);
  console.log(`Loan Amount: ${request.loan_amount} lovelace`);
  console.log(`Destination: ${request.destination}`);
  console.log("\n🎉 Anonymous loan request processed!");
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  // Check arguments
  if (Deno.args.length === 0) {
    console.error("❌ ERROR: Missing borrow request file");
    console.error("\nUsage:");
    console.error("  deno task admin:prove-and-borrow <request-file.json>");
    console.error("\nExample:");
    console.error("  deno task admin:prove-and-borrow borrow-request.json");
    console.error("\nThe request file should contain:");
    console.error("  {");
    console.error('    "secret": "123456789...",');
    console.error('    "collateral_utxo": "txhash#index",');
    console.error('    "loan_amount": "700000000",');
    console.error('    "loan_term": "3888000000",');
    console.error('    "destination": "addr_test1qz..."');
    console.error("  }");
    Deno.exit(1);
  }

  const requestFile = Deno.args[0];

  // Check if request file exists
  try {
    await Deno.stat(requestFile);
  } catch {
    console.error(`❌ ERROR: Request file not found: ${requestFile}`);
    Deno.exit(1);
  }

  // Run the service
  try {
    await proveAndIssueLoan(requestFile);
  } catch (error) {
    console.error("\n❌ ERROR:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}
