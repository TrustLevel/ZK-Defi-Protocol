#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST: Pool With Admin Check - MESH.JS VERSION
 *
 * Purpose: Prove that Mesh.js can handle PlutusV3 extra_signatories
 * This test uses the SAME validator that fails with Lucid Evolution
 *
 * Test 2a: Admin signs and borrows → SUCCESS ✅
 * Test 2b: User signs and borrows → FAIL ❌
 *
 * Validator: contracts/validators/debug/pool_with_admin_check.ak
 *
 * This is the CRITICAL test that will prove whether Mesh.js solves ERROR-010
 */

import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  deserializeAddress,
  serializePlutusScript,
  mConStr0,
} from "@meshsdk/core";
import { CardanoSDK } from "@meshsdk/core-csl";

// ============================================
// CONFIGURATION
// ============================================

const NETWORK = "preprod";
const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER_SEED = Deno.env.get("USER1_WALLET_SEED")!;

const LOCK_AMOUNT = "100000000"; // 100 ADA in lovelace
const BORROW_AMOUNT = "50000000"; // 50 ADA in lovelace

// ============================================
// DATUM SCHEMA (Manual Encoding for Mesh.js)
// ============================================

/**
 * PoolDatum in Aiken:
 * pub type PoolDatum {
 *   total_borrowed: Int,
 * }
 *
 * CBOR encoding: Constructor 0, single field (Int)
 * Example: { total_borrowed: 0 } → d87980 (Constr 0, [0])
 */
function encodePoolDatum(totalBorrowed: bigint): string {
  // Constructor 0 with one integer field
  return mConStr0([totalBorrowed]);
}

// VoidRedeemer: Constructor 0 with no fields
// In Aiken: pub type VoidRedeemer { Void }
// Encodes as: d8799fff (Constructor 0, empty array)
function encodeVoidRedeemer(): string {
  return mConStr0([]);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getValidator(): { scriptCbor: string; scriptAddress: string } {
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );

  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/pool_with_admin_check.pool_with_admin_check.spend"
  );

  if (!validator) {
    throw new Error("Validator not found in plutus.json");
  }

  const scriptCbor = validator.compiledCode;
  const scriptAddress = serializePlutusScript(
    { code: scriptCbor, version: "V3" },
    undefined,
    NETWORK === "preprod" ? 0 : 1
  ).address;

  return { scriptCbor, scriptAddress };
}

async function waitForConfirmation(
  provider: BlockfrostProvider,
  txHash: string
): Promise<void> {
  console.log(`   ⏳ Waiting for confirmation...`);
  let confirmed = false;
  let attempts = 0;
  const maxAttempts = 60;

  while (!confirmed && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const txInfo = await provider.fetchTxInfo(txHash);
      if (txInfo) {
        confirmed = true;
      }
    } catch {
      // Not confirmed yet
    }
    attempts++;
  }

  if (!confirmed) {
    throw new Error("Transaction not confirmed after 120 seconds");
  }

  console.log(`   ✅ Transaction confirmed!`);
}

// ============================================
// MAIN TEST
// ============================================

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("🧪 TEST: Pool With Admin Check - MESH.JS VERSION");
  console.log("═══════════════════════════════════════════════════════\n");

  // Initialize Blockfrost provider
  console.log("📡 Step 0: Connecting to Cardano network...");
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);

  // Initialize wallets
  const adminWallet = new MeshWallet({
    networkId: NETWORK === "preprod" ? 0 : 1,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: ADMIN_SEED.split(" "),
    },
  });

  const userWallet = new MeshWallet({
    networkId: NETWORK === "preprod" ? 0 : 1,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: USER_SEED.split(" "),
    },
  });

  const adminAddress = await adminWallet.getChangeAddress();
  const userAddress = await userWallet.getChangeAddress();

  console.log(`   ✅ Connected`);
  console.log(`   Admin: ${adminAddress}`);
  console.log(`   User:  ${userAddress}\n`);

  // Load validator
  console.log("📜 Step 1: Loading validator...");
  const { scriptCbor, scriptAddress } = getValidator();
  console.log(`   ✅ Validator loaded`);
  console.log(`   Address: ${scriptAddress}\n`);

  // ==========================================
  // SETUP: Lock 100 ADA (Admin does this)
  // ==========================================
  console.log("🔒 Setup: Locking 100 ADA in pool (Admin)...");

  const initialDatum = encodePoolDatum(0n);

  const adminUtxos = await adminWallet.getUtxos();
  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const lockTx = await txBuilder
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: LOCK_AMOUNT }])
    .txOutInlineDatumValue(initialDatum)
    .changeAddress(adminAddress)
    .selectUtxosFrom(adminUtxos)
    .complete();

  const lockSignedTx = adminWallet.signTx(lockTx);
  const lockTxHash = await adminWallet.submitTx(lockSignedTx);

  console.log(`   ✅ Lock TX submitted: ${lockTxHash}`);
  await waitForConfirmation(provider, lockTxHash);

  const poolUtxoRef = { txHash: lockTxHash, outputIndex: 0 };
  console.log(`   📦 Pool UTXO: ${lockTxHash}#0\n`);

  // Wait for blockchain to settle
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // ==========================================
  // TEST 2a: ADMIN BORROWS (Should SUCCESS)
  // ==========================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("🧪 TEST 2a: Admin signs and borrows");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("💸 Admin attempts to borrow 50 ADA...");

  // Query pool UTXO
  const poolUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const poolUtxo = poolUtxos.find(
    (u) => u.input.txHash === lockTxHash && u.input.outputIndex === 0
  );

  if (!poolUtxo) {
    throw new Error("Pool UTXO not found!");
  }

  const updatedDatum = encodePoolDatum(50_000_000n);
  const redeemer = encodeVoidRedeemer();
  const remainingBalance = (
    BigInt(LOCK_AMOUNT) - BigInt(BORROW_AMOUNT)
  ).toString();

  // Get admin's public key hash for required signer
  const adminPubKeyHash = deserializeAddress(adminAddress).pubKeyHash;

  try {
    const txBuilder2 = new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
    });

    const borrowTx = await txBuilder2
      .spendingPlutusScriptV3()
      .txIn(
        poolUtxo.input.txHash,
        poolUtxo.input.outputIndex,
        poolUtxo.output.amount,
        poolUtxo.output.address
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemer)
      .txInScript(scriptCbor)
      .txOut(adminAddress, [{ unit: "lovelace", quantity: BORROW_AMOUNT }])
      .txOut(scriptAddress, [{ unit: "lovelace", quantity: remainingBalance }])
      .txOutInlineDatumValue(updatedDatum)
      .requiredSignerHash(adminPubKeyHash) // ← THIS ADDS TO extra_signatories!
      .changeAddress(adminAddress)
      .selectUtxosFrom(adminUtxos)
      .complete();

    const borrowSignedTx = adminWallet.signTx(borrowTx);
    const borrowTxHash = await adminWallet.submitTx(borrowSignedTx);

    console.log(`   ✅ Borrow TX submitted: ${borrowTxHash}`);
    console.log(
      `   Explorer: https://preprod.cardanoscan.io/transaction/${borrowTxHash}`
    );
    await waitForConfirmation(provider, borrowTxHash);

    console.log(`\n   ✅ TEST 2a PASSED: Admin successfully borrowed! ✅\n`);

    // Update pool reference for next test
    poolUtxoRef.txHash = borrowTxHash;
    poolUtxoRef.outputIndex = 1; // Pool output is second output
  } catch (error) {
    console.error(
      `\n   ❌ TEST 2a FAILED: Admin should be able to borrow!`
    );
    console.error(`   Error: ${error}`);
    throw error;
  }

  // Wait for blockchain to settle
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // ==========================================
  // TEST 2b: USER BORROWS (Should FAIL)
  // ==========================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("🧪 TEST 2b: User signs and tries to borrow");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("💸 User attempts to borrow 25 ADA...");
  console.log("   Expected: Should FAIL (user is not admin)\n");

  // Query updated pool UTXO
  const poolUtxos2 = await provider.fetchAddressUTxOs(scriptAddress);
  const poolUtxo2 = poolUtxos2.find(
    (u) =>
      u.input.txHash === poolUtxoRef.txHash &&
      u.input.outputIndex === poolUtxoRef.outputIndex
  );

  if (!poolUtxo2) {
    throw new Error("Pool UTXO not found!");
  }

  const userBorrowAmount = "25000000";
  const userUpdatedDatum = encodePoolDatum(75_000_000n); // 50 + 25
  const userRemainingBalance = (
    BigInt(remainingBalance) - BigInt(userBorrowAmount)
  ).toString();

  // Get user's public key hash
  const userPubKeyHash = deserializeAddress(userAddress).pubKeyHash;
  const userUtxos = await userWallet.getUtxos();

  try {
    const txBuilder3 = new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
    });

    const userBorrowTx = await txBuilder3
      .spendingPlutusScriptV3()
      .txIn(
        poolUtxo2.input.txHash,
        poolUtxo2.input.outputIndex,
        poolUtxo2.output.amount,
        poolUtxo2.output.address
      )
      .txInInlineDatumPresent()
      .txInRedeemerValue(redeemer)
      .txInScript(scriptCbor)
      .txOut(userAddress, [{ unit: "lovelace", quantity: userBorrowAmount }])
      .txOut(scriptAddress, [
        { unit: "lovelace", quantity: userRemainingBalance },
      ])
      .txOutInlineDatumValue(userUpdatedDatum)
      .requiredSignerHash(userPubKeyHash) // User's signature (not admin!)
      .changeAddress(userAddress)
      .selectUtxosFrom(userUtxos)
      .complete();

    const userBorrowSignedTx = userWallet.signTx(userBorrowTx);
    await userWallet.submitTx(userBorrowSignedTx);

    // If we get here, the test failed!
    console.error(
      `\n   ❌ TEST 2b FAILED: User should NOT be able to borrow!`
    );
    console.error(
      `   Transaction was accepted but should have been rejected!\n`
    );
    throw new Error("User borrow should have failed but succeeded!");
  } catch (error: any) {
    // This is expected! User should NOT be able to borrow
    if (error.message && error.message.includes("should have failed")) {
      // Our own error - actual failure
      throw error;
    }

    console.log(`   ✅ Transaction rejected as expected!`);
    console.log(`   Error (expected): ${error.message?.substring(0, 100)}...`);
    console.log(`\n   ✅ TEST 2b PASSED: User correctly blocked! ✅\n`);
  }

  // ==========================================
  // SUMMARY
  // ==========================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("✅ ALL TESTS PASSED WITH MESH.JS!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📋 Summary:");
  console.log(`   Setup:    Lock TX ${lockTxHash}`);
  console.log(`   Test 2a:  ✅ Admin can borrow`);
  console.log(`   Test 2b:  ✅ User correctly blocked`);
  console.log(`   Result:   Mesh.js handles extra_signatories correctly! 🎉`);
  console.log(`\n🔍 Conclusion:`);
  console.log(
    `   Mesh.js SOLVES ERROR-010! PlutusV3 + extra_signatories works!`
  );
  console.log(`   Migration from Lucid Evolution to Mesh.js is recommended.\n`);
}

// ============================================
// RUN TEST
// ============================================

if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (error) {
    console.error("\n❌ TEST SUITE FAILED:");
    console.error(error);
    Deno.exit(1);
  }
}
