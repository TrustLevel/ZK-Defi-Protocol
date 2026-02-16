#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * MESH.JS HIGH-LEVEL TRANSACTION API
 *
 * Based on official aiken-next-ts-template which uses Transaction class
 * instead of MeshTxBuilder
 *
 * https://github.com/MeshJS/aiken-next-ts-template
 */

import {
  BlockfrostProvider,
  MeshWallet,
  Transaction,
  serializePlutusScript,
  mConStr0,
} from "@meshsdk/core";

const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const AMOUNT = "5000000";

console.log("\n🧪 MESH.JS TRANSACTION API TEST\n");

try {
  // ========================================
  // SETUP
  // ========================================
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: ADMIN_SEED.split(" ") },
  });

  const walletAddress = await wallet.getChangeAddress();
  console.log(`Wallet: ${walletAddress}\n`);

  // Load validator
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );
  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/test_always_true.test_always_true.spend"
  );
  if (!validator) throw new Error("Validator not found");

  const scriptCbor = validator.compiledCode;
  const script = {
    code: scriptCbor,
    version: "V3",
  };

  const scriptAddress = serializePlutusScript(script, undefined, 0).address;

  console.log(`Script: ${scriptAddress}\n`);

  // ========================================
  // STEP 1: LOCK
  // ========================================
  console.log("🔒 Step 1: Lock 5 ADA...");

  const datum = mConStr0([0n]);

  const lockTx = await new Transaction({ initiator: wallet })
    .sendLovelace(
      {
        address: scriptAddress,
        datum: { value: datum },
      },
      AMOUNT
    )
    .build();

  const lockSigned = await wallet.signTx(lockTx, false);
  const lockHash = await wallet.submitTx(lockSigned);

  console.log(`   TX: ${lockHash}`);
  console.log(`   Waiting for confirmation...`);

  // Wait for confirmation
  let confirmed = false;
  for (let i = 0; i < 60 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const info = await provider.fetchTxInfo(lockHash);
      if (info) confirmed = true;
    } catch {}
  }
  if (!confirmed) throw new Error("Lock TX not confirmed");
  console.log(`   ✅ Confirmed!\n`);

  await new Promise((r) => setTimeout(r, 5000));

  // ========================================
  // STEP 2: SPEND (Using Transaction API)
  // ========================================
  console.log("💸 Step 2: Spend using Transaction API...");

  const scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const lockedUtxo = scriptUtxos.find(
    (u) => u.input.txHash === lockHash && u.input.outputIndex === 0
  );
  if (!lockedUtxo) throw new Error("Locked UTxO not found");

  console.log(`   Found locked UTxO`);

  const redeemer = { data: { alternative: 0, fields: [] } };

  const spendTx = await new Transaction({ initiator: wallet })
    .redeemValue({
      value: lockedUtxo,
      script: script,
      datum: datum,
      redeemer: redeemer,
    })
    .sendLovelace(walletAddress, AMOUNT)
    .build();

  console.log(`   Transaction built`);

  const spendSigned = await wallet.signTx(spendTx, false);
  const spendHash = await wallet.submitTx(spendSigned);

  console.log(`   TX: ${spendHash}`);
  console.log(`   Waiting for confirmation...`);

  // Wait for confirmation
  confirmed = false;
  for (let i = 0; i < 60 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const info = await provider.fetchTxInfo(spendHash);
      if (info) confirmed = true;
    } catch {}
  }
  if (!confirmed) throw new Error("Spend TX not confirmed");
  console.log(`   ✅ Confirmed!\n`);

  // ========================================
  // SUCCESS!
  // ========================================
  console.log("════════════════════════════════════════");
  console.log("🎉 SUCCESS! TRANSACTION API WORKS!");
  console.log("════════════════════════════════════════");
  console.log(`\nLock:  ${lockHash}`);
  console.log(`Spend: ${spendHash}`);
  console.log(`\n✅ High-level Transaction API confirmed working!\n`);
} catch (error: any) {
  console.error("\n❌ FAILED:");
  console.error(error.message || error);
  if (error.data) console.error("Details:", error.data);
  if (error.stack) console.error("Stack:", error.stack);
  Deno.exit(1);
}
