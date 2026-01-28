import { Data, Datum, fromText, stringify } from "@lucid-evolution/lucid";
import {
    ADMIN_WALLET_SEED,
    adminSpendPkh,
    deployDetailsFile,
    getLucidInstance,
    prefix_100,
    prefix_333,
    tusdMintingScript,
    tusdTokensPolicyId,
    USER1_WALLET_SEED,
} from "../index.ts";

const lucid = getLucidInstance();

const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);
const { refscriptsScriptAddr } = deployed;

/**
 * Mints the `tUSDM` CIP68 token pair.
 *
 * The reference token (100)tUSDM that comes with the CIP68 metadata is sent to the
 * `refscriptsScript` address so that its utxo can't be easily spent.
 *
 * The user token (333)tUSDM is sent to the admin address.
 *
 * @returns {Promise<void>}
 */
export async function mintLoanableTokens(): Promise<void> {
    const cip68Token = {
        user: tusdTokensPolicyId + prefix_333 + fromText("tUSDM"),
        ref: tusdTokensPolicyId + prefix_100 + fromText("tUSDM"),
    };
    const assetsToMint = {
        [cip68Token.ref]: 1n,
        [cip68Token.user]: 10_001_000_000_000n,
    };

    const Cip68DatumSchema = Data.Object({
        metadata: Data.Map(Data.Bytes(), Data.Any()),
        version: Data.Integer(),
    });
    type Cip68Datum = Data.Static<typeof Cip68DatumSchema>;
    const Cip68Datum = Cip68DatumSchema as unknown as Cip68Datum;
    const metadata = new Map();
    metadata.set(fromText(`name`), fromText(`tUSDM`));
    metadata.set(fromText(`description`), fromText(`Fiat-backed stablecoin native to the Cardano blockchain`));
    metadata.set(fromText(`ticker`), fromText(`tUSDM`));
    metadata.set(fromText(`url`), fromText(`https://mehen.io/`));
    metadata.set(fromText(`decimals`), 6n);
    metadata.set(fromText(`logo`), fromText(`ipfs://QmPxYepEFHtu3GBRuK6RhL5wKrSmxgYjbEu8CAdFw4Dghq`));
    const cip68Datum = {
        metadata: metadata,
        version: 1n,
    };
    const cip68DatumData: Data = Data.to(cip68Datum, Cip68Datum);

    // switch to user wallet to get address:
    lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    const userAddress = await lucid.wallet().address();

    // switch back to admin wallet:
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);

    const tx = await lucid
        .newTx()
        .mintAssets(assetsToMint)
        .pay.ToContract(
            refscriptsScriptAddr,
            { kind: "inline", value: cip68DatumData as Datum },
            { [cip68Token.ref]: 1n },
        )
        .pay.ToAddress(userAddress, { [cip68Token.user]: 1_000_000_000n })
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

    // update deployDetailsFile
    deployed.loanableAsset = {
        policyId: tusdTokensPolicyId,
        assetName: prefix_333 + fromText("tUSDM"),
    };
    const data = new TextEncoder().encode(stringify(deployed));
    Deno.writeFileSync(deployDetailsFile, data);
}

mintLoanableTokens();
