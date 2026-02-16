#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * MESH.JS + AIKEN OFFICIAL PATTERN
 *
 * Following EXACT pattern from official Aiken documentation:
 * https://aiken-lang.org/example--hello-world/end-to-end/mesh
 *
 * Key discovery: Use .spendingPlutusScript("V3") NOT .spendingPlutusScriptV2()
 */

import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  serializePlutusScript,
  mConStr0,
} from "@meshsdk/core";

const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const AMOUNT = "5000000";

console.log("\n🧪 MESH.JS + AIKEN OFFICIAL PATTERN TEST\n");

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
  const scriptAddress = serializePlutusScript(
    { code: scriptCbor, version: "V3" },
    undefined,
    0
  ).address;

  console.log(`Script: ${scriptAddress}\n`);

  // ========================================
  // STEP 1: LOCK
  // ========================================
  console.log("🔒 Step 1: Lock 5 ADA...");

  const datum = mConStr0([0n]);
  const utxos = await wallet.getUtxos();

  const lockBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const lockTx = await lockBuilder
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: AMOUNT }])
    .txOutInlineDatumValue(datum)
    .changeAddress(walletAddress)
    .selectUtxosFrom(utxos)
    .complete();

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
  // STEP 2: SPEND (Official Aiken Pattern)
  // ========================================
  console.log("💸 Step 2: Spend using official Aiken pattern...");

  const scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const lockedUtxo = scriptUtxos.find(
    (u) => u.input.txHash === lockHash && u.input.outputIndex === 0
  );
  if (!lockedUtxo) throw new Error("Locked UTxO not found");

  console.log(`   Found locked UTxO`);
  console.log(`   UTxO address: ${lockedUtxo.output.address}`);
  console.log(`   Script address: ${scriptAddress}`);
  console.log(`   Has plutusData: ${!!lockedUtxo.output.plutusData}`);

  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("No collateral");

  const spendBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  // OFFICIAL AIKEN + MESH.JS PATTERN:
  const spendTx = await spendBuilder
    .spendingPlutusScript("V3") // KEY: Use this method with string parameter!
    .txIn(
      lockedUtxo.input.txHash,
      lockedUtxo.input.outputIndex,
      lockedUtxo.output.amount,
      lockedUtxo.output.address
    )
    .txInScript(scriptCbor)
    .txInInlineDatumPresent() // Tell Mesh.js that inline datum is present
    .txInRedeemerValue(mConStr0([]))
    .changeAddress(walletAddress)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .selectUtxosFrom(utxos)
    .complete();

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
  console.log("🎉 SUCCESS! AIKEN + MESH.JS WORKS!");
  console.log("════════════════════════════════════════");
  console.log(`\nLock:  ${lockHash}`);
  console.log(`Spend: ${spendHash}`);
  console.log(`\n✅ PlutusV3 spending confirmed working!`);
  console.log(`\nUsing: .spendingPlutusScript("V3")`);
  console.log(`Source: https://aiken-lang.org/example--hello-world/end-to-end/mesh\n`);
} catch (error: any) {
  console.error("\n❌ FAILED:");
  console.error(error.message || error);
  if (error.data) console.error("Details:", error.data);
  Deno.exit(1);
}
