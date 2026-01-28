import { Data, stringify, UTxO } from "@lucid-evolution/lucid";
import {
    adminAddress,
    adminSpendPkh,
    adminTokensPolicyId,
    beaconTokens,
    collateralScript,
    collateralScriptAddr,
    deployDetailsFile,
    getDeployUtxos,
    getLucidInstance,
    lendingPoolScript,
    lendingPoolScriptAddr,
    refscriptsRewardAddr,
    refscriptsScript,
    refscriptsScriptAddr,
} from "../index.ts";

const lucid = getLucidInstance();

const origAdminUtxos = (await lucid.utxosAt(adminAddress)).reverse();
const [deployUtxos] = getDeployUtxos(origAdminUtxos);

const [newWalletInputs, derivedOutputs, tx] = await lucid
    .newTx()
    .collectFrom(deployUtxos)
    .register.Stake(refscriptsRewardAddr)
    .pay.ToContract(
        refscriptsScriptAddr,
        { kind: "inline", value: Data.void() },
        { [beaconTokens.refscripts]: 1n },
        refscriptsScript,
    )
    .pay.ToContract(
        refscriptsScriptAddr,
        { kind: "inline", value: Data.void() },
        { [beaconTokens.collateral]: 1n },
        collateralScript,
    )
    .chain();

console.log(`deploy refscripts tx1 built`);

const signedTx = await tx.sign.withWallet().complete();
console.log(`signedTx: ${stringify(signedTx)}`);
console.log(`signedTx hash: ${signedTx.toHash()}`);
console.log(`size: ~${signedTx.toCBOR().length / 2048} KB`);
console.log("");

console.log("");
const txJson = JSON.parse(stringify(signedTx));
console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
console.log("");

// Deno.exit(0);
const txHash = await signedTx.submit();
console.log(`tx submitted. Hash: ${txHash}`);
console.log("");

const [newDeployUtxos] = getDeployUtxos(newWalletInputs);
const [, derivedOutputs2, tx2] = await lucid
    .newTx()
    .collectFrom(newDeployUtxos)
    .pay.ToContract(
        refscriptsScriptAddr,
        { kind: "inline", value: Data.void() },
        { [beaconTokens.lendingPool]: 1n },
        lendingPoolScript,
    )
    .addSignerKey(adminSpendPkh)
    .chain();

console.log(`deploy refscripts tx2 built`);

const signedTx2 = await tx2.sign.withWallet().complete();
console.log(`signedTx2: ${stringify(signedTx2)}`);
console.log(`signedTx2 hash: ${signedTx2.toHash()}`);
console.log(`size: ~${signedTx2.toCBOR().length / 2048} KB`);
console.log("");

// Deno.exit(0);
const tx2Hash = await signedTx2.submit();
console.log(`tx2 submitted. Hash: ${tx2Hash}`);
console.log("");

console.log("");
const tx2Json = JSON.parse(stringify(signedTx2));
console.log(`txFee: ${parseInt(tx2Json.body.fee) / 1_000_000} ADA`);
console.log("");

const refscriptsRefUtxo: UTxO = derivedOutputs.find((utxo) => {
    if (utxo.assets[beaconTokens.refscripts]) return true;
    else return false;
}) as UTxO;

const collateralValRefUtxo: UTxO = derivedOutputs.find((utxo) => {
    if (utxo.assets[beaconTokens.collateral]) return true;
    else return false;
}) as UTxO;

const lendingPoolValRefUtxo: UTxO = derivedOutputs2.find((utxo) => {
    if (utxo.assets[beaconTokens.lendingPool]) return true;
    else return false;
}) as UTxO;

const referenceUtxos = {
    refscripts: refscriptsRefUtxo,
    collateral: collateralValRefUtxo,
    lendingPool: lendingPoolValRefUtxo,
};
const results = {
    referenceUtxos,
    adminTokensPolicyId,
    refscriptsScriptAddr,
    lendingPoolScriptAddr,
    collateralScriptAddr,
    beaconTokens: beaconTokens,
};

const data = new TextEncoder().encode(stringify(results));
Deno.writeFileSync(deployDetailsFile, data);
