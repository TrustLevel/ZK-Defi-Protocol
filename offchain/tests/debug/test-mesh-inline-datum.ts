#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST: Send to script with inline datum
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

console.log("Testing send to script WITH inline datum...\n");

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

  console.log("Creating datum...");
  const datum = mConStr0([42n]); // Simple: Constructor 0, one integer
  console.log(`   Datum: ${datum}\n`);

  console.log("Building TX: Send 5 ADA to script WITH inline datum...");

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const unsignedTx = await txBuilder
    .txOut(scriptAddress, [{ unit: "lovelace", quantity: "5000000" }])
    .txOutInlineDatumValue(datum)
    .changeAddress(address)
    .selectUtxosFrom(utxos)
    .complete();

  console.log(`✅ Transaction built! TX hex length: ${unsignedTx.length}\n`);

  const signedTx = wallet.signTx(unsignedTx);
  console.log(`✅ Transaction signed\n`);

  console.log("✅ SUCCESS! Inline datum works!");

} catch (error: any) {
  console.error("\n❌ ERROR:");
  console.error("Name:", error.name);
  console.error("Message:", error.message);
  console.error("Code:", error.code);
  if (error.cause) {
    console.error("Cause:", JSON.stringify(error.cause, null, 2));
  }
  console.error("\nStack:");
  console.error(error.stack);
  Deno.exit(1);
}
