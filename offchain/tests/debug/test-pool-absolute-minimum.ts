/**
 * TEST: Pool Absolute Minimum
 *
 * Purpose: Test the simplest possible pool validator
 * - Lock 100 ADA
 * - Spend 50 ADA
 * Both should succeed (validator always returns True)
 *
 * Validator: contracts/validators/debug/pool_absolute_minimum.ak
 */

import { Blockfrost, Data, Lucid, Script, validatorToAddress } from "@lucid-evolution/lucid";

// ============================================
// CONFIGURATION
// ============================================

const NETWORK = "Preprod";
const BLOCKFROST_URL = Deno.env.get("PREPROD_BLOCKFROST")!;
const BLOCKFROST_API_KEY = "blockfrost1he7uy2whn7zfqzlw2m7"; // From existing tests
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

const LOCK_AMOUNT = 100_000_000n; // 100 ADA
const SPEND_AMOUNT = 50_000_000n; // 50 ADA

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
    (v: any) => v.title === "debug/pool_absolute_minimum.pool_absolute_minimum.spend"
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
  const maxAttempts = 60; // 60 seconds

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
  console.log("🧪 TEST: Pool Absolute Minimum");
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

  // PHASE 1: LOCK 100 ADA
  console.log("🔒 Step 2: Locking 100 ADA in pool...");

  const lockDatum = Data.to(100n); // Simple integer datum

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

  // Wait a bit for blockchain to settle
  console.log("   ⏳ Waiting 5 seconds for blockchain to settle...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // PHASE 2: SPEND 50 ADA
  console.log("💸 Step 3: Spending 50 ADA from pool...");

  // Query pool UTXO
  const poolUtxos = await lucid.utxosByOutRef([poolUtxoRef]);
  if (poolUtxos.length === 0) {
    throw new Error("Pool UTXO not found!");
  }
  const poolUtxo = poolUtxos[0];
  console.log(`   ✅ Pool UTXO found: ${poolUtxo.assets.lovelace} lovelace`);

  const spendRedeemer = Data.to(1n); // Simple integer redeemer

  const spendTx = await lucid
    .newTx()
    .collectFrom([poolUtxo], spendRedeemer)
    .attach.Script(validator)
    .pay.ToAddress(adminAddress, { lovelace: SPEND_AMOUNT })
    .complete();

  const spendSignedTx = await spendTx.sign.withWallet().complete();
  const spendTxHash = await spendSignedTx.submit();

  console.log(`   ✅ Spend TX submitted`);
  console.log(`   TX Hash: ${spendTxHash}`);
  console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);

  await waitForConfirmation(lucid, spendTxHash);

  // SUCCESS!
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ TEST PASSED!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📋 Summary:");
  console.log(`   Lock TX:  ${lockTxHash}`);
  console.log(`   Spend TX: ${spendTxHash}`);
  console.log(`   Result:   Both succeeded ✅\n`);
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
