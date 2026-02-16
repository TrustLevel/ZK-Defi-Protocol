#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST: Send to script address (no datum)
 */

import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  serializePlutusScript,
} from "@meshsdk/core";

const BLOCKFROST_API_KEY = Deno.env.get("PREPROD_BLOCKFROST_API_KEY")!;
const ADMIN_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

console.log("Testing send to script address...\n");

try {
  // Get validator
  const plutusJson = JSON.parse(
    Deno.readTextFileSync("../contracts/plutus.json")
  );
  const validator = plutusJson.validators.find(
    (v: any) => v.title === "debug/test_only_admin_sig.test_only_admin_sig.spend"
  );
  const scriptCbor = validator.compiledCode;
  const scriptAddress = serializePlutusScript(
    { code: scriptCbor, version: "V3" },
    undefined,
    0
  ).address;

  console.log(`Script address: ${scriptAddress}\n`);

  // Init wallet
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
  const utxos = await wallet.getUtxos();

  console.log("Building TX: Send 5 ADA to script (NO DATUM)...");

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const unsignedTx = await txBuilder
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: "5000000" }])
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  console.log(`✅ Transaction built! TX hex length: ${unsignedTx.length}\n`);

  const signedTx = wallet.signTx(unsignedTx);
  console.log(`✅ Transaction signed\n`);

  console.log("✅ SUCCESS! Sending to script address works!");

} catch (error: any) {
  console.error("\n❌ ERROR:");
  console.error("Name:", error.name);
  console.error("Message:", error.message);
  console.error("\nStack:");
  console.error(error.stack);
  Deno.exit(1);
}
