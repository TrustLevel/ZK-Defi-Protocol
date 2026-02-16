#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";

const provider = new BlockfrostProvider("blockfrost1he7uy2whn7zfqzlw2m7");
const wallet = new MeshWallet({
  networkId: 0,
  fetcher: provider,
  submitter: provider,
  key: {
    type: "mnemonic",
    words: Deno.env.get("ADMIN_WALLET_SEED")!.split(" "),
  },
});

const address = await wallet.getChangeAddress();
const utxos = await wallet.getUtxos();

console.log("Address:", address);
console.log("UTxOs:", utxos.length);

const total = utxos.reduce((sum, u) => {
  const lovelace = u.output.amount.find((a) => a.unit === "lovelace");
  return sum + BigInt(lovelace?.quantity || "0");
}, 0n);

console.log("Total ADA:", Number(total) / 1_000_000);
