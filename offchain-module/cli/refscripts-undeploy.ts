import { Credential, credentialToRewardAddress, Data, getAddressDetails, Script, stringify } from "@lucid-evolution/lucid";
import { adminAddress, adminPkh, deployDetailsFile, getLucidInstance, provNetwork, refscriptsScriptHash } from "../index.ts";

const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

const refscriptsAddr = deployed.refscriptsScriptAddr;
const refscriptsCred = getAddressDetails(refscriptsAddr).paymentCredential as Credential;
const refscriptsRewardAddr = credentialToRewardAddress(provNetwork, refscriptsCred);

const lucid = getLucidInstance();

const origAdminUtxos = (await lucid.utxosAt(adminAddress)).reverse();

const refUtxos = await lucid.utxosAt(refscriptsAddr);
const refscriptsRefUtxo = refUtxos.find((utxo) => {
    if (utxo.assets[deployed.beaconTokens.refscripts]) return true;
    else return false;
})!;

const refScript = refscriptsRefUtxo.scriptRef as Script;

console.log(`refscriptsAddr: ${refscriptsAddr}`);
console.log(`refscriptsRewardAddr: ${refscriptsRewardAddr}`);
console.log(`refscriptsCred: ${stringify(refscriptsCred)}`);
console.log(`refscriptsScriptHash: ${refscriptsScriptHash}`);

console.log("");

console.log(`refUtxos count: ${refUtxos.length}`);

const tx = lucid
    .newTx()
    .collectFrom([origAdminUtxos[0]])
    .collectFrom(refUtxos, Data.void())
    .deregister.Stake(refscriptsRewardAddr, Data.void())
    .withdraw(refscriptsRewardAddr, 0n, Data.void())
    .addSignerKey(adminPkh)
    .attach.Script(refScript);

const completeTx = await tx.complete();

const signedTx = await completeTx.sign.withWallet().complete();
console.log(`signedTx: ${stringify(signedTx)}`);
console.log(`signedTx hash: ${signedTx.toHash()}`);
console.log(`size: ~${signedTx.toCBOR().length / 2048} KB`);

// Deno.exit(0);
const txHash = await signedTx.submit();
console.log(`tx submitted. Hash: ${txHash}`);

console.log("");
const txJson = JSON.parse(stringify(signedTx));
console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
console.log("");
