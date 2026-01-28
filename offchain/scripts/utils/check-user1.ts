import { Lucid, Blockfrost } from "@lucid-evolution/lucid";

const USER1_SEED = Deno.env.get("USER1_WALLET_SEED");
const BLOCKFROST_ENDPOINT = Deno.env.get("PREPROD_BLOCKFROST");
const BLOCKFROST_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

const lucid = await Lucid(
    new Blockfrost(BLOCKFROST_ENDPOINT!, BLOCKFROST_KEY),
    "Preprod"
);

lucid.selectWallet.fromSeed(USER1_SEED!);
const address = await lucid.wallet().address();
const utxos = await lucid.wallet().getUtxos();

console.log("\n📦 USER1 Wallet Status:\n");
console.log(`Address: ${address}`);

const totalLovelace = utxos.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n);
console.log(`Balance: ${Number(totalLovelace) / 1_000_000} ADA`);
console.log(`UTXOs: ${utxos.length}\n`);
