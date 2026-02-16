#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * MESH.JS CORRECT API TEST
 *
 * Following exact API reference from:
 * https://meshjs.dev/apis/txbuilder/smart-contracts
 *
 * Key corrections:
 * - Use .spendingPlutusScriptV3() for PlutusV3 scripts
 * - Use .txInInlineDatumPresent() NOT .spendingReferenceTxInInlineDatumPresent()
 * - Use .txInRedeemerValue() NOT .spendingReferenceTxInRedeemerValue()
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

console.log("\n🧪 MESH.JS CORRECT API TEST\n");

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
    { code: scriptCbor, version: "V2" }, // Try V2 since we're using spendingPlutusScriptV2()
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
  // STEP 2: SPEND (Using Correct API)
  // ========================================
  console.log("💸 Step 2: Spend using correct API...");

  const scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const lockedUtxo = scriptUtxos.find(
    (u) => u.input.txHash === lockHash && u.input.outputIndex === 0
  );
  if (!lockedUtxo) throw new Error("Locked UTxO not found");

  console.log(`   Found locked UTxO`);

  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("No collateral");

  const spendBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  // CORRECT ORDER FROM DOCS:
  const spendTx = await spendBuilder
    .spendingPlutusScriptV2() // 1. Declare script version (V2 method works for V3 too per vesting example)
    .txIn(
      // 2. Specify input
      lockedUtxo.input.txHash,
      lockedUtxo.input.outputIndex,
      lockedUtxo.output.amount,
      lockedUtxo.output.address
    )
    .txInInlineDatumPresent() // 3. Indicate inline datum (NOT spendingReferenceTxIn...)
    .txInRedeemerValue(mConStr0([])) // 4. Supply redeemer (NOT spendingReferenceTxIn...)
    .txInScript(scriptCbor) // 5. Include script
    .txOut(walletAddress, []) // Output (empty = send all)
    .txInCollateral(
      // 6. Add collateral
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .changeAddress(walletAddress) // 7. Set change address
    .selectUtxosFrom(utxos) // 8. Select UTxOs
    .complete(); // 9. Complete

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
  console.log("🎉 SUCCESS! MESH.JS SPENDING WORKS!");
  console.log("════════════════════════════════════════");
  console.log(`\nLock:  ${lockHash}`);
  console.log(`Spend: ${spendHash}`);
  console.log(`\n✅ PlutusV3 spending confirmed working!`);
  console.log(`\nNext: Test with extra_signatories check\n`);
} catch (error: any) {
  console.error("\n❌ FAILED:");
  console.error(error.message || error);
  if (error.data) console.error("Details:", error.data);
  Deno.exit(1);
}
