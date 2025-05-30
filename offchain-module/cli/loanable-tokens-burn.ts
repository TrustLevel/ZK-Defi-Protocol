import { Data, fromText, stringify } from "@lucid-evolution/lucid";
import {
    adminPkh,
    adminSpendPkh,
    deployDetailsFile,
    getLucidInstance,
    prefix_100,
    prefix_333,
    refscriptsRewardAddr,
    tusdMintingScript,
    tusdTokensPolicyId,
    // USER1_WALLET_SEED,
    // ADMIN_WALLET_SEED
} from "../index.ts";

const lucid = getLucidInstance();
const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);
const refUtxos = await lucid.utxosAt(deployed.refscriptsScriptAddr);

/**
 * Burns the `tUSDM` CIP68 token pair that got sent back to admin wallet
 * after running task `undeploy-refscripts`
 *
 * @returns {Promise<void>}
 */
export async function burnLoanableTokens(): Promise<void> {
    const cip68Token = {
        user: tusdTokensPolicyId + prefix_333 + fromText("tUSDM"),
        ref: tusdTokensPolicyId + prefix_100 + fromText("tUSDM"),
    };

    // Switch to user wallet:
    // lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    // const userAddress = await lucid.wallet().address();
    
    // const userUtxos = await lucid.utxosAt(userAddress);
    // const userLoanableUtxos = (userUtxos.filter((utxo) => {
    //     if (utxo.assets[cip68Token.user]) return true;
    //     else return false;
    // }))!;

    // Switch back to admin wallet:
    // lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);

    const cip68RefTokenUtxo = (refUtxos.find((utxo) => {
        if (utxo.assets[cip68Token.ref]) return true;
        else return false;
    }))!;
    const refscriptsContractRefUtxo = refUtxos.find((utxo) => {
        if (utxo.assets[deployed.beaconTokens.refscripts]) return true;
        else return false;
    })!;

    const assetsToMint = {
        [cip68Token.ref]: -1n,
        [cip68Token.user]: -10_001_000_000_000n,
    };

    const tx = await lucid
        .newTx()
        .mintAssets(assetsToMint)
        .collectFrom([cip68RefTokenUtxo!], Data.void())
        // .collectFrom([...userLoanableUtxos])
        .attach.Script(tusdMintingScript)
        .withdraw(refscriptsRewardAddr, 0n, Data.void())
        .readFrom([refscriptsContractRefUtxo])
        .addSignerKey(adminSpendPkh)
        .addSignerKey(adminPkh)
        .complete();
    console.log(`tx built`);

    // const adminSignedTx = await tx.sign.withWallet().complete();
    const signedTx = await tx.sign.withWallet().complete();

    // Switch to user wallet again:
    // lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    // sign with user's account
    // const userTx = lucid.fromTx(adminSignedTx.toCBOR());
    // const signedTx = await userTx.sign.withWallet().complete();



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
}

burnLoanableTokens();
