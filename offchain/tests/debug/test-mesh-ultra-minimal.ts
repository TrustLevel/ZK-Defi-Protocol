#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * ULTRA MINIMAL: Just test Mesh.js initialization
 */

import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";

const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

console.log("Testing Mesh.js initialization...\n");

try {
  console.log("1. Creating BlockfrostProvider...");
  const provider = new BlockfrostProvider(BLOCKFROST_API_KEY);
  console.log("   ✅ Provider created\n");

  console.log("2. Creating MeshWallet...");
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: {
      type: "mnemonic",
      words: ADMIN_SEED.split(" "),
    },
  });
  console.log("   ✅ Wallet created\n");

  console.log("3. Getting address...");
  const address = await wallet.getChangeAddress();
  console.log(`   ✅ Address: ${address}\n`);

  console.log("4. Getting UTxOs...");
  const utxos = await wallet.getUtxos();
  console.log(`   ✅ Found ${utxos.length} UTxOs\n`);

  if (utxos.length > 0) {
    console.log("5. First UTxO:");
    console.log(`   TX: ${utxos[0].input.txHash}`);
    console.log(`   Index: ${utxos[0].input.outputIndex}`);
    const lovelace = utxos[0].output.amount.find((a) => a.unit === "lovelace");
    console.log(`   Lovelace: ${lovelace?.quantity || 0}\n`);
  }

  console.log("✅ ALL CHECKS PASSED!");
} catch (error: any) {
  console.error("❌ ERROR:");
  console.error("Name:", error.name);
  console.error("Message:", error.message);
  console.error("Code:", error.code);
  console.error("\nFull error:", error);
  console.error("\nStack:", error.stack);
  Deno.exit(1);
}
