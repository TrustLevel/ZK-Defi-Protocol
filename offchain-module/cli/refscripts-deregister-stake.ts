import { Data, stringify } from "@lucid-evolution/lucid";
import { adminAddress, adminPkh, getDeployUtxos, getLucidInstance, refscriptsRewardAddr, refscriptsScript } from "../index.ts";

const lucid = getLucidInstance();

const origAdminUtxos = (await lucid.utxosAt(adminAddress)).reverse();
const [deployUtxos] = getDeployUtxos(origAdminUtxos);

const tx = await lucid
    .newTx()
    .collectFrom(deployUtxos)
    .deregister.Stake(refscriptsRewardAddr, Data.void())
    .addSignerKey(adminPkh)
    .attach.Script(refscriptsScript)
    .complete();

console.log(`refscripts deregister stake addr tx built`);

const signedTx = await tx.sign.withWallet().complete();
console.log(`signedTx: ${stringify(signedTx)}`);
console.log(`signedTx hash: ${signedTx.toHash()}`);
console.log(`size: ~${signedTx.toCBOR().length / 2048} KB`);
console.log("");

console.log("");
const txJson = JSON.parse(stringify(signedTx));
console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
console.log("");

//   Deno.exit(0);
const txHash = await signedTx.submit();
console.log(`tx submitted. Hash: ${txHash}`);
console.log("");
