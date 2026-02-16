#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * ISOLATED SPEND TEST
 *
 * Purpose: Prove that basic PlutusV3 spending works with Mesh.js
 * NO extra_signatories - just basic spend
 *
 * Steps:
 * 1. Lock 5 ADA in always-true validator
 * 2. Spend 5 ADA back (should always succeed)
 *
 * Validator: test_always_true (returns True, no logic)
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

console.log("\n🧪 ISOLATED SPEND TEST: Basic PlutusV3 spending\n");

try {
  // Init
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: ADMIN_SEED.split(" ") },
  });
  const address = await wallet.getChangeAddress();
  console.log(`Wallet: ${address}\n`);

  // Load validator
  const plutusJson = JSON.parse(Deno.readTextFileSync("../contracts/plutus.json"));
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

  const datum = mConstr0([0n]);
  const utxos = await wallet.getUtxos();

  const lockTx = await new MeshTxBuilder({ fetcher: provider, submitter: provider })
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: AMOUNT }])
    .txOutInlineDatumValue(datum)
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  const lockSigned = await wallet.signTx(lockTx, false);
  const lockHash = await wallet.submitTx(lockSigned);

  console.log(`   TX: ${lockHash}`);
  console.log(`   Waiting for confirmation...`);

  // Wait for confirmation
  let confirmed = false;
  for (let i = 0; i < 60 && !confirmed; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const info = await provider.fetchTxInfo(lockHash);
      if (info) confirmed = true;
    } catch {}
  }
  if (!confirmed) throw new Error("Lock TX not confirmed");
  console.log(`   ✅ Confirmed!\n`);

  await new Promise(r => setTimeout(r, 5000));

  // ========================================
  // STEP 2: SPEND (THE CRITICAL TEST!)
  // ========================================
  console.log("💸 Step 2: Spend from script...");

  const scriptUtxos = await provider.fetchAddressUTxOs(scriptAddress);
  const lockedUtxo = scriptUtxos.find(
    u => u.input.txHash === lockHash && u.input.outputIndex === 0
  );
  if (!lockedUtxo) throw new Error("Locked UTxO not found");

  console.log(`   Found locked UTxO`);

  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("No collateral");

  const redeemer = mConstr0([]); // Empty redeemer

  const spendTx = await new MeshTxBuilder({ fetcher: provider, submitter: provider })
    .spendingPlutusScriptV2() // Using V2 method (works for V3 too)
    .txIn(
      lockedUtxo.input.txHash,
      lockedUtxo.input.outputIndex,
      lockedUtxo.output.amount,
      lockedUtxo.output.address
    )
    .txInDatumValue(datum)
    .txInRedeemerValue(redeemer)
    .txInScript(scriptCbor)
    .txOut(address, [{ unit: "lovelace", quantity: AMOUNT }])
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .changeAddress(address)
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
    await new Promise(r => setTimeout(r, 2000));
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
  console.log("🎉 SUCCESS! BASIC SPENDING WORKS!");
  console.log("════════════════════════════════════════");
  console.log(`\nLock:  ${lockHash}`);
  console.log(`Spend: ${spendHash}`);
  console.log(`\n✅ Mesh.js can spend from PlutusV3 scripts!`);
  console.log(`\nNext: Add extra_signatories check\n`);

} catch (error: any) {
  console.error("\n❌ FAILED:");
  console.error(error.message || error);
  if (error.data) console.error("Details:", error.data);
  Deno.exit(1);
}
