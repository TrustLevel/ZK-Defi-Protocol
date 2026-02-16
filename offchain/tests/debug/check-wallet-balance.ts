#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const lucid = await Lucid(
    new Blockfrost(Deno.env.get("PREPROD_BLOCKFROST")!, "blockfrost1he7uy2whn7zfqzlw2m7"),
    "Preprod"
);

lucid.selectWallet.fromSeed(Deno.env.get("USER1_WALLET_SEED")!);
const addr = await lucid.wallet().address();
const utxos = await lucid.wallet().getUtxos();

console.log("Wallet:", addr.slice(0, 40) + "...");
console.log("Total UTXOs:", utxos.length);

let totalAda = 0n;
let withRefScript = 0;

for (const utxo of utxos) {
    totalAda += utxo.assets.lovelace;
    if (utxo.scriptRef) {
        withRefScript++;
        console.log(`  UTXO ${utxo.txHash.slice(0, 10)}... has ref script`);
    }
}

console.log("\nTotal ADA:", Number(totalAda) / 1_000_000);
console.log("UTXOs with ref scripts:", withRefScript);
console.log("Usable UTXOs:", utxos.length - withRefScript);
