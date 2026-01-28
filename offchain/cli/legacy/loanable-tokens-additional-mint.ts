import { fromText, stringify } from "@lucid-evolution/lucid";
import { adminSpendPkh, getLucidInstance, prefix_100, prefix_333, tusdMintingScript, tusdTokensPolicyId } from "../index.ts";

const mintedAssetsRecipientAddr =
    "addr_test1qrpcqzeecyyn2gcvy7tulnaxgrdwd9fp2cpde55sv05dh5vty75sar6jd4qtg8g0puxvtz29nrwwwasy0acemrepdt8s9z36p2";

const lucid = getLucidInstance();

/**
 * Mints additional `tUSDM` CIP68 user token.
 *
 * @returns {Promise<void>}
 */
export async function mintMoreLoanableTokens(): Promise<void> {
    const cip68Token = {
        user: tusdTokensPolicyId + prefix_333 + fromText("tUSDM"),
        ref: tusdTokensPolicyId + prefix_100 + fromText("tUSDM"),
    };
    const assetsToMint = {
        [cip68Token.user]: 1_000_000_000n,
    };

    const tx = await lucid
        .newTx()
        .mintAssets(assetsToMint)
        .pay.ToAddress(mintedAssetsRecipientAddr, assetsToMint)
        .attach.Script(tusdMintingScript)
        .addSignerKey(adminSpendPkh)
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
}

mintMoreLoanableTokens();
