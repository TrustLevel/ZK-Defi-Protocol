#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST: Pool With Datum (Phase 1)
 *
 * Purpose: Test structured datum with one Int field
 * - Lock 100 ADA with datum { total_borrowed: 0 }
 * - Spend 50 ADA with updated datum { total_borrowed: 50 }
 * Validator still returns True (no checks), we just test datum structure
 *
 * Validator: contracts/validators/debug/pool_with_datum.ak
 */

import { Blockfrost, Data, Lucid, Script, validatorToAddress } from "@lucid-evolution/lucid";

// ============================================
// CONFIGURATION
// ============================================

const NETWORK = "Preprod";
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST")!;
const BLOCKFROST_API_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

const LOCK_AMOUNT = 100_000_000n; // 100 ADA
const SPEND_AMOUNT = 50_000_000n; // 50 ADA

// ============================================
// DATUM SCHEMA
// ============================================

// Must match the Aiken type:
// pub type PoolDatum {
//   total_borrowed: Int,
// }
const PoolDatumSchema = Data.Object({
  total_borrowed: Data.Integer(),
});

type PoolDatum = Data.Static<typeof PoolDatumSchema>;
const PoolDatum = PoolDatumSchema as unknown as PoolDatum;

// ============================================
// HELPER FUNCTIONS
// ============================================

async function initLucid(): Promise<Lucid> {
  const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
    NETWORK
  );
  lucid.selectWallet.fromSeed(ADMIN_SEED);
  return lucid;
}

function getValidator(): Script {
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );

  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/pool_with_datum.pool_with_datum.spend"
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
  console.log("🧪 TEST: Pool With Datum (Phase 1)");
  console.log("═══════════════════════════════════════════════════════\n");

  // Initialize Lucid
  console.log("📡 Step 0: Connecting to Cardano network...");
  const lucid = await initLucid();
  const adminAddress = await lucid.wallet().address();
  console.log(`   ✅ Connected`);
  console.log(`   Admin: ${adminAddress}\n`);

  // Load validator
  console.log("📜 Step 1: Loading validator...");
  const validator = getValidator();
  const validatorAddress = validatorToAddress(NETWORK, validator);
  console.log(`   ✅ Validator loaded`);
  console.log(`   Address: ${validatorAddress}\n`);

  // PHASE 1: LOCK 100 ADA WITH INITIAL DATUM
  console.log("🔒 Step 2: Locking 100 ADA with initial datum...");
  console.log(`   Datum: { total_borrowed: 0 }`);

  const initialDatum: PoolDatum = {
    total_borrowed: 0n,
  };

  const lockDatum = Data.to(initialDatum, PoolDatum);

  const lockTx = await lucid
    .newTx()
    .pay.ToContract(
      validatorAddress,
      { kind: "inline", value: lockDatum },
      { lovelace: LOCK_AMOUNT }
    )
    .complete();

  const lockSignedTx = await lockTx.sign.withWallet().complete();
  const lockTxHash = await lockSignedTx.submit();

  console.log(`   ✅ Lock TX submitted`);
  console.log(`   TX Hash: ${lockTxHash}`);
  console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);

  await waitForConfirmation(lucid, lockTxHash);

  const poolUtxoRef = { txHash: lockTxHash, outputIndex: 0 };
  console.log(`   📦 Pool UTXO: ${lockTxHash}#0\n`);

  // Wait for blockchain to settle
  console.log("   ⏳ Waiting 5 seconds for blockchain to settle...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // PHASE 2: SPEND 50 ADA WITH UPDATED DATUM
  console.log("💸 Step 3: Spending 50 ADA with updated datum...");
  console.log(`   New Datum: { total_borrowed: 50000000 } (50 ADA)`);

  // Query pool UTXO
  const poolUtxos = await lucid.utxosByOutRef([poolUtxoRef]);
  if (poolUtxos.length === 0) {
    throw new Error("Pool UTXO not found!");
  }
  const poolUtxo = poolUtxos[0];
  console.log(`   ✅ Pool UTXO found: ${poolUtxo.assets.lovelace} lovelace`);

  // Parse current datum
  const currentDatum = Data.from(poolUtxo.datum!, PoolDatum);
  console.log(`   📄 Current datum: { total_borrowed: ${currentDatum.total_borrowed} }`);

  // Create updated datum (simulate 50 ADA borrowed)
  const updatedDatum: PoolDatum = {
    total_borrowed: 50_000_000n, // 50 ADA borrowed
  };

  const newDatum = Data.to(updatedDatum, PoolDatum);
  const spendRedeemer = Data.to(1n);

  // Calculate remaining pool balance
  const remainingBalance = LOCK_AMOUNT - SPEND_AMOUNT; // 50 ADA stays in pool

  const spendTx = await lucid
    .newTx()
    .collectFrom([poolUtxo], spendRedeemer)
    .attach.Script(validator)
    .pay.ToAddress(adminAddress, { lovelace: SPEND_AMOUNT })
    .pay.ToContract(
      validatorAddress,
      { kind: "inline", value: newDatum },
      { lovelace: remainingBalance }
    )
    .complete();

  const spendSignedTx = await spendTx.sign.withWallet().complete();
  const spendTxHash = await spendSignedTx.submit();

  console.log(`   ✅ Spend TX submitted`);
  console.log(`   TX Hash: ${spendTxHash}`);
  console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

  await waitForConfirmation(lucid, spendTxHash);

  // Verify new pool UTXO
  const newPoolUtxos = await lucid.utxosByOutRef([{ txHash: spendTxHash, outputIndex: 1 }]);
  if (newPoolUtxos.length > 0) {
    const newPoolUtxo = newPoolUtxos[0];
    const newPoolDatum = Data.from(newPoolUtxo.datum!, PoolDatum);
    console.log(`   ✅ New pool UTXO created`);
    console.log(`   📦 Balance: ${newPoolUtxo.assets.lovelace} lovelace`);
    console.log(`   📄 Datum: { total_borrowed: ${newPoolDatum.total_borrowed} }`);
  }

  // SUCCESS!
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ TEST PASSED!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📋 Summary:");
  console.log(`   Lock TX:   ${lockTxHash}`);
  console.log(`   Spend TX:  ${spendTxHash}`);
  console.log(`   Result:    Structured datum works! ✅`);
  console.log(`   - Initial datum: { total_borrowed: 0 }`);
  console.log(`   - Updated datum: { total_borrowed: 50000000 }`);
  console.log(`   - Both transactions succeeded!\n`);
}

// ============================================
// RUN TEST
// ============================================

if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error(error);
    Deno.exit(1);
  }
}
