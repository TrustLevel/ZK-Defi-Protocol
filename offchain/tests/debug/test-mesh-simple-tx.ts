#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * SIMPLE TX TEST: Just send 5 ADA to self
 * No scripts, no complexity - just basic transaction building
 */

import { BlockfrostProvider, MeshWallet, MeshTxBuilder } from "@meshsdk/core";

const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

console.log("Testing simple transaction building...\n");

try {
  console.log("1. Initializing...");
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: ADMIN_SEED.split(" "),
    },
  });
  const address = await wallet.getChangeAddress();
  console.log(`   ✅ Address: ${address}\n`);

  console.log("2. Getting UTxOs...");
  const utxos = await wallet.getUtxos();
  console.log(`   ✅ Found ${utxos.length} UTxOs\n`);

  console.log("3. Creating MeshTxBuilder...");
  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });
  console.log("   ✅ TxBuilder created\n");

  console.log("4. Building transaction (send 5 ADA to self)...");
  const unsignedTx = await txBuilder
    .txOut(address, [{ unit: "lovelace", quantity: "5000000" }])
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  console.log(`   ✅ Transaction built!`);
  console.log(`   TX hex length: ${unsignedTx.length}\n`);

  console.log("5. Signing transaction...");
  const signedTx = wallet.signTx(unsignedTx);
  console.log(`   ✅ Transaction signed\n`);

  console.log("✅ SUCCESS! Transaction building works!");
  console.log("   (Not submitting to save funds - test passed)\n");

} catch (error: any) {
  console.error("\n❌ ERROR:");
  console.error("Name:", error.name);
  console.error("Message:", error.message);
  console.error("Code:", error.code);
  if (error.cause) {
    console.error("Cause:", error.cause);
  }
  console.error("\nStack:");
  console.error(error.stack);
  Deno.exit(1);
}
