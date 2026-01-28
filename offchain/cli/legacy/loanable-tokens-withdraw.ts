import { Data, stringify } from "@lucid-evolution/lucid";
import { adminPkh, deployDetailsFile, getLucidInstance, RedeemerType, UnifiedRedeemer } from "../index.ts";

const lucid = getLucidInstance();

const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

const refUtxos = await lucid.utxosAt(deployed.refscriptsScriptAddr);

const lendingPoolUtxos = await lucid.utxosAt(deployed.lendingPoolScriptAddr);

const withdrawObj: UnifiedRedeemer = RedeemerType.WithdrawLendingPool;
const withdrawLiqRedeemer = Data.to(withdrawObj, UnifiedRedeemer);

const lpContractRefUtxo = refUtxos.find((utxo) => {
    if (utxo.assets[deployed.beaconTokens.lendingPool]) return true;
    else return false;
})!;

const tx = await lucid
    .newTx()
    .collectFrom(lendingPoolUtxos, withdrawLiqRedeemer)
    .readFrom([lpContractRefUtxo])
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

console.log("");
