#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";

// Lucid address
const lucid = await Lucid(
  new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", "blockfrost1he7uy2whn7zfqzlw2m7"),
  "Preprod"
);
lucid.selectWallet.fromSeed(Deno.env.get("ADMIN_WALLET_SEED")!);
const lucidAddress = await lucid.wallet().address();

// Mesh address
const provider = new BlockfrostProvider("blockfrost1he7uy2whn7zfqzlw2m7");
const meshWallet = new MeshWallet({
  networkId: 0,
  fetcher: provider,
  submitter: provider,
  key: {
    type: "mnemonic",
    words: Deno.env.get("ADMIN_WALLET_SEED")!.split(" "),
  },
});
const meshAddress = await meshWallet.getChangeAddress();

console.log("Lucid Address:", lucidAddress);
console.log("Mesh Address: ", meshAddress);
console.log("Same?:", lucidAddress === meshAddress);
