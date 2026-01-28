import { stringify } from "@lucid-evolution/lucid";
import { adminMintingScript, adminPkh, beaconTokens, getLucidInstance } from "../index.ts";

const lucid = getLucidInstance();

const assetsToMint = {
    [beaconTokens.refscripts]: 1n,
    [beaconTokens.collateral]: 1n,
    [beaconTokens.lendingPool]: 1n,
};

const tx = await lucid
    .newTx()
    .mintAssets(assetsToMint)
    .attach.Script(adminMintingScript)
    .addSignerKey(adminPkh)
    .complete();
console.log(`tx built`);

const signedTx = await tx.sign.withWallet().complete();
console.log(`signedTx: ${stringify(signedTx)}`);
console.log(`signedTx hash: ${signedTx.toHash()}`);
console.log(`size: ~${signedTx.toCBOR().length / 2048} KB`);

console.log("");
const txJson = JSON.parse(stringify(signedTx));
console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
console.log("");

// Deno.exit(0);
const txHash = await signedTx.submit();
console.log(`tx submitted. Hash: ${txHash}`);
