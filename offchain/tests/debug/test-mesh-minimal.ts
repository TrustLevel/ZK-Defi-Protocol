#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * MINIMAL TEST: Mesh.js + PlutusV3 + extra_signatories
 *
 * Purpose: Prove that Mesh.js can handle extra_signatories (ERROR-010)
 *
 * Flow:
 * 1. Lock 10 ADA in validator (no datum, simple transaction)
 * 2. Spend 10 ADA with admin signature (requires extra_signatories check)
 *
 * Validator: contracts/validators/debug/test_only_admin_sig.ak
 *
 * If this succeeds, ERROR-010 is SOLVED! 🎉
 */

import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  deserializeAddress,
  serializePlutusScript,
  mConStr0,
} from "@meshsdk/core";

// ============================================
// CONFIGURATION
// ============================================

const NETWORK = "preprod";
const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

const LOCK_AMOUNT = "5000000"; // 5 ADA (small amount for testing)

// ============================================
// HELPER FUNCTIONS
// ============================================

function getValidator(): { scriptCbor: string; scriptAddress: string } {
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );

  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/test_only_admin_sig.test_only_admin_sig.spend"
  );

  if (!validator) {
    throw new Error("Validator 'test_only_admin_sig' not found in plutus.json");
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

  console.log(`   ✅ Confirmed!`);
}

// ============================================
// MAIN TEST
// ============================================

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("🧪 MINIMAL TEST: Mesh.js + extra_signatories");
  console.log("═══════════════════════════════════════════════════════\n");

  // Initialize
  console.log("📡 Initializing...");
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);

  const wallet = new MeshWallet({
    networkId: NETWORK === "preprod" ? 0 : 1,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: ADMIN_SEED.split(" "),
    },
  });

  const address = await wallet.getChangeAddress();
  const adminPubKeyHash = deserializeAddress(address).pubKeyHash;

  console.log(`   ✅ Connected`);
  console.log(`   Address: ${address}\n`);

  // Load validator
  console.log("📜 Loading validator...");
  const { scriptCbor, scriptAddress } = getValidator();
  console.log(`   ✅ Validator: test_only_admin_sig`);
  console.log(`   Address: ${scriptAddress}\n`);

  // ==========================================
  // STEP 1: LOCK 5 ADA
  // ==========================================
  console.log("🔒 Step 1: Locking 5 ADA...");

  const utxos = await wallet.getUtxos();
  const txBuilder1 = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  // Simple datum (can be anything since validator doesn't use it)
  const datum = mConStr0([0n]);

  const lockTx = await txBuilder1
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: LOCK_AMOUNT }])
    .txOutInlineDatumValue(datum)
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  console.log(`   ✅ Lock TX built! Length: ${lockTx.length}`);

  const lockSignedTx = await wallet.signTx(lockTx, false); // false = not partial sign
  console.log(`   ✅ Lock TX signed!\n`);

  // Submit transaction
  console.log("   📤 Submitting transaction...");
  const lockTxHash = await wallet.submitTx(lockSignedTx);

  console.log(`   ✅ Lock TX: ${lockTxHash}`);
  console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${lockTxHash}`);
  await waitForConfirmation(provider, lockTxHash);

  console.log(`   📦 Locked UTXO: ${lockTxHash}#0\n`);

  // Wait for blockchain to settle
  console.log("   ⏳ Waiting 5s for blockchain to settle...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // ==========================================
  // STEP 2: SPEND WITH ADMIN SIGNATURE
  // ==========================================
  console.log("💸 Step 2: Spending with admin signature...");
  console.log("   This is the CRITICAL test for extra_signatories!\n");

  // Query locked UTXO
  const scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const lockedUtxo = scriptUtxos.find(
    (u) => u.input.txHash === lockTxHash && u.input.outputIndex === 0
  );

  if (!lockedUtxo) {
    throw new Error("Locked UTXO not found!");
  }

  console.log(`   ✅ Found locked UTXO`);

  // Build spend transaction
  const redeemer = mConStr0([]); // Simple empty redeemer

  // Get collateral (required for script execution)
  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) {
    throw new Error("No collateral available! Please set up collateral UTxO.");
  }

  const txBuilder2 = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const inputDatum = mConStr0([0n]); // Match the datum we locked with

  const spendTx = await txBuilder2
    .spendingPlutusScript("V3")
    .txIn(
      lockedUtxo.input.txHash,
      lockedUtxo.input.outputIndex,
      lockedUtxo.output.amount,
      lockedUtxo.output.address
    )
    .txInScript(scriptCbor)
    .txInRedeemerValue(redeemer)
    .txInDatumValue(inputDatum)
    .requiredSignerHash(adminPubKeyHash) // ← THIS IS THE CRITICAL LINE!
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .txOut(address, [{ unit: "lovelace", quantity: LOCK_AMOUNT }])
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  console.log(`   ✅ Transaction built`);
  console.log(`   🔐 Required signer: ${adminPubKeyHash}`);

  const spendSignedTx = await wallet.signTx(spendTx, false);
  const spendTxHash = await wallet.submitTx(spendSignedTx);

  console.log(`   ✅ Spend TX: ${spendTxHash}`);
  console.log(`   Explorer: https://preprod.cardanoscan.io/transaction/${spendTxHash}`);
  await waitForConfirmation(provider, spendTxHash);

  // ==========================================
  // SUCCESS!
  // ==========================================
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("🎉 SUCCESS! MESH.JS WORKS WITH EXTRA_SIGNATORIES!");
  console.log("═══════════════════════════════════════════════════════");
  console.log("\n📋 Result:");
  console.log(`   Lock TX:  ${lockTxHash}`);
  console.log(`   Spend TX: ${spendTxHash}`);
  console.log(`   ✅ PlutusV3 validator with extra_signatories check PASSED!`);
  console.log(`   ✅ ERROR-010 is SOLVED by migrating to Mesh.js!`);
  console.log(`\n🔍 Conclusion:`);
  console.log(`   Mesh.js successfully handles ctx.transaction.extra_signatories`);
  console.log(`   Migration from Lucid Evolution to Mesh.js is the solution.\n`);
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
