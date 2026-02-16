#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST: Pool With Admin Check (Phase 2)
 *
 * Purpose: Test access control - only admin can borrow
 *
 * Test 2a: Admin signs and borrows → SUCCESS ✅
 * Test 2b: User signs and borrows → FAIL ❌
 *
 * Validator: contracts/validators/debug/pool_with_admin_check.ak
 */

import { Blockfrost, Constr, Data, Lucid, Script, validatorToAddress } from "@lucid-evolution/lucid";

// ============================================
// CONFIGURATION
// ============================================

const NETWORK = "Preprod";
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST")!;
const BLOCKFROST_API_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER_SEED = Deno.env.get("USER1_WALLET_SEED")!;

const LOCK_AMOUNT = 100_000_000n; // 100 ADA
const BORROW_AMOUNT = 50_000_000n; // 50 ADA

// ============================================
// DATUM SCHEMA
// ============================================

const PoolDatumSchema = Data.Object({
  total_borrowed: Data.Integer(),
});

type PoolDatum = Data.Static<typeof PoolDatumSchema>;
const PoolDatum = PoolDatumSchema as unknown as PoolDatum;

// VoidRedeemer: Constructor 0 with no fields (simplest possible)
// In Aiken: pub type VoidRedeemer { Void }
// Encodes as: d8799fff (Constructor 0, empty array)

// ============================================
// HELPER FUNCTIONS
// ============================================

async function initLucid(seed: string): Promise<Lucid> {
  const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
    NETWORK
  );
  lucid.selectWallet.fromSeed(seed);
  return lucid;
}

function getValidator(): Script {
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );

  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/pool_with_admin_check.pool_with_admin_check.spend"
  );

  if (!validator) {
    throw new Error("Validator not found in plutus.json");
  }

  return {
    type: "PlutusV3",
    script: validator.compiledCode,
  };
}

async function waitForConfirmation(lucid: Lucid, txHash: string): Promise<void> {
  console.log(`   ⏳ Waiting for confirmation...`);
  let confirmed = false;
  let attempts = 0;
  const maxAttempts = 60;

  while (!confirmed && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const utxos = await lucid.utxosByOutRef([{ txHash, outputIndex: 0 }]);
      if (utxos.length > 0) {
        confirmed = true;
      }
    } catch {
      // Not confirmed yet
    }
    attempts++;
  }

  if (!confirmed) {
    throw new Error("Transaction not confirmed after 60 seconds");
  }

  console.log(`   ✅ Transaction confirmed!`);
}

// ============================================
// MAIN TEST
// ============================================

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("🧪 TEST: Pool With Admin Check (Phase 2)");
  console.log("═══════════════════════════════════════════════════════\n");

  // Initialize both wallets
  console.log("📡 Step 0: Connecting to Cardano network...");
  const adminLucid = await initLucid(ADMIN_SEED);
  const userLucid = await initLucid(USER_SEED);

  const adminAddress = await adminLucid.wallet().address();
  const userAddress = await userLucid.wallet().address();

  console.log(`   ✅ Connected`);
  console.log(`   Admin: ${adminAddress}`);
  console.log(`   User:  ${userAddress}\n`);

  // Load validator
  console.log("📜 Step 1: Loading validator...");
  const validator = getValidator();
  const validatorAddress = validatorToAddress(NETWORK, validator);
  console.log(`   ✅ Validator loaded`);
  console.log(`   Address: ${validatorAddress}\n`);

  // ==========================================
  // SETUP: Lock 100 ADA (Admin does this)
  // ==========================================
  console.log("🔒 Setup: Locking 100 ADA in pool (Admin)...");

  const initialDatum: PoolDatum = {
    total_borrowed: 0n,
  };

  const lockDatum = Data.to(initialDatum, PoolDatum);

  const lockTx = await adminLucid
    .newTx()
    .pay.ToContract(
      validatorAddress,
      { kind: "inline", value: lockDatum },
      { lovelace: LOCK_AMOUNT }
    )
    .complete();

  const lockSignedTx = await lockTx.sign.withWallet().complete();
  const lockTxHash = await lockSignedTx.submit();

  console.log(`   ✅ Lock TX submitted: ${lockTxHash}`);
  await waitForConfirmation(adminLucid, lockTxHash);

  const poolUtxoRef = { txHash: lockTxHash, outputIndex: 0 };
  console.log(`   📦 Pool UTXO: ${lockTxHash}#0\n`);

  // Wait for blockchain to settle
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ==========================================
  // TEST 2a: ADMIN BORROWS (Should SUCCESS)
  // ==========================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("🧪 TEST 2a: Admin signs and borrows");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("💸 Admin attempts to borrow 50 ADA...");

  // Query pool UTXO
  let poolUtxos = await adminLucid.utxosByOutRef([poolUtxoRef]);
  if (poolUtxos.length === 0) {
    throw new Error("Pool UTXO not found!");
  }
  let poolUtxo = poolUtxos[0];

  const updatedDatum: PoolDatum = {
    total_borrowed: 50_000_000n,
  };

  const newDatum = Data.to(updatedDatum, PoolDatum);
  const redeemer = Data.to(new Constr(0, [])); // VoidRedeemer = Constructor 0, no fields
  const remainingBalance = LOCK_AMOUNT - BORROW_AMOUNT;

  try {
    const borrowTx = await adminLucid
      .newTx()
      .collectFrom([poolUtxo], redeemer)
      .attach.Script(validator)
      .pay.ToAddress(adminAddress, { lovelace: BORROW_AMOUNT })
      .pay.ToContract(
        validatorAddress,
        { kind: "inline", value: newDatum },
        { lovelace: remainingBalance }
      )
      .complete();

    const borrowSignedTx = await borrowTx.sign.withWallet().complete();
    const borrowTxHash = await borrowSignedTx.submit();

    console.log(`   ✅ Borrow TX submitted: ${borrowTxHash}`);
    console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${borrowTxHash}`);
    await waitForConfirmation(adminLucid, borrowTxHash);

    console.log(`\n   ✅ TEST 2a PASSED: Admin successfully borrowed! ✅\n`);

    // Update pool reference for next test
    poolUtxoRef.txHash = borrowTxHash;
    poolUtxoRef.outputIndex = 1; // Pool output is second output

  } catch (error) {
    console.error(`\n   ❌ TEST 2a FAILED: Admin should be able to borrow!`);
    console.error(`   Error: ${error}`);
    throw error;
  }

  // Wait for blockchain to settle
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ==========================================
  // TEST 2b: USER BORROWS (Should FAIL)
  // ==========================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("🧪 TEST 2b: User signs and tries to borrow");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("💸 User attempts to borrow 25 ADA...");
  console.log("   Expected: Should FAIL (user is not admin)\n");

  // Query updated pool UTXO
  poolUtxos = await userLucid.utxosByOutRef([poolUtxoRef]);
  if (poolUtxos.length === 0) {
    throw new Error("Pool UTXO not found!");
  }
  poolUtxo = poolUtxos[0];

  const userBorrowAmount = 25_000_000n;
  const userUpdatedDatum: PoolDatum = {
    total_borrowed: 75_000_000n, // 50 + 25
  };

  const userNewDatum = Data.to(userUpdatedDatum, PoolDatum);
  const userRemainingBalance = remainingBalance - userBorrowAmount;

  try {
    const userBorrowTx = await userLucid
      .newTx()
      .collectFrom([poolUtxo], redeemer)
      .attach.Script(validator)
      .pay.ToAddress(userAddress, { lovelace: userBorrowAmount })
      .pay.ToContract(
        validatorAddress,
        { kind: "inline", value: userNewDatum },
        { lovelace: userRemainingBalance }
      )
      .complete();

    const userBorrowSignedTx = await userBorrowTx.sign.withWallet().complete();
    await userBorrowSignedTx.submit();

    // If we get here, the test failed!
    console.error(`\n   ❌ TEST 2b FAILED: User should NOT be able to borrow!`);
    console.error(`   Transaction was accepted but should have been rejected!\n`);
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
  console.log("✅ ALL TESTS PASSED!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📋 Summary:");
  console.log(`   Setup:    Lock TX ${lockTxHash}`);
  console.log(`   Test 2a:  ✅ Admin can borrow`);
  console.log(`   Test 2b:  ✅ User correctly blocked`);
  console.log(`   Result:   Access control works! 🔐\n`);
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
