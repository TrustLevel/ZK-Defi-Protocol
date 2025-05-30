import { Credential, Data, getAddressDetails, stringify } from "@lucid-evolution/lucid";
import {
    CollateralDatum,
    deployDetailsFile,
    getLucidInstance,
    getMyCollateralUtxo,
    PlutusScriptKey,
    PlutusVerificationKey,
    RedeemerType,
    UnifiedRedeemer,
    USER1_WALLET_SEED,
} from "../index.ts";

const lucid = getLucidInstance();

const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

const refUtxos = await lucid.utxosAt(deployed.refscriptsScriptAddr);

async function withdrawCollateral() {
    // Switch to user wallet:
    lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    const userAddress = await lucid.wallet().address();
    const userStakeCred = getAddressDetails(userAddress).stakeCredential as Credential;
    const userPaymtCred = getAddressDetails(userAddress).paymentCredential as Credential;

    const collateralUtxos = await lucid.utxosAt(deployed.collateralScriptAddr);
    const collateralUtxo = getMyCollateralUtxo(collateralUtxos, userPaymtCred, userStakeCred, "unused");
    if (!collateralUtxo) {
        console.log(`No collateral utxo found for user`);
        return;
    }
    const inputDatum = Data.from(collateralUtxo.datum!, CollateralDatum);
    // get owner's payment key hash from datum:
    const ownerPaymentHash = Object.hasOwn(inputDatum.owner.payment_credential, "VerificationKey")
        ? (inputDatum.owner.payment_credential as PlutusVerificationKey).VerificationKey[0]
        : (inputDatum.owner.payment_credential as PlutusScriptKey).Script[0];

    const withdrawReq: UnifiedRedeemer = RedeemerType.WithdrawCollateral;
    const withdrawReqRedeemer = Data.to(withdrawReq, UnifiedRedeemer);

    const collateralContractRefUtxo = refUtxos.find((utxo) => {
        if (utxo.assets[deployed.beaconTokens.collateral]) return true;
        else return false;
    })!;

    const tx = await lucid
        .newTx()
        .collectFrom([collateralUtxo], withdrawReqRedeemer)
        .readFrom([collateralContractRefUtxo])
        .addSignerKey(ownerPaymentHash)
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

await withdrawCollateral();
