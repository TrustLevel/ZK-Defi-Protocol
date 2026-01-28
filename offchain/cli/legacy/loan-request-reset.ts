import { Credential, Data, Datum, getAddressDetails, stringify } from "@lucid-evolution/lucid";
import {
    ADMIN_WALLET_SEED,
    adminPkh,
    CollateralDatum,
    CollateralDatumObj,
    deployDetailsFile,
    getLucidInstance,
    getMyCollateralUtxo,
    RedeemerType,
    UnifiedRedeemer,
    USER1_WALLET_SEED,
} from "../index.ts";

const lucid = getLucidInstance();
const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

const refUtxos = await lucid.utxosAt(deployed.refscriptsScriptAddr);

/**
 * Cancels a loan request by resetting the 'loan requested' status of the user's collateral.
 *
 * This function switches to the user's wallet, retrieves the user's collateral UTXO,
 * and constructs a transaction to reset the loan status. It requires the collateral owner's
 * payment key hash for signing. The transaction is first signed by the user, then by the admin.
 *
 * The function performs the following steps:
 * 1. Switches to the user's wallet and retrieves the user's address and credentials.
 * 2. Finds the user's collateral UTXO at the deployed collateral script address.
 * 3. Constructs a new datum object with the loan status reset and converts it to a datum.
 * 4. Builds a transaction to collect the collateral UTXO and send it to the contract with the new datum.
 * 5. Signs the transaction with the user's wallet and completes it.
 * 6. Switches back to the admin wallet, signs the transaction, and submit.
 */

async function cancelLoanRequest() {
    // Switch to user wallet:
    lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    const userAddress = await lucid.wallet().address();
    const userStakeCred = getAddressDetails(userAddress).stakeCredential as Credential;
    const userPaymtCred = getAddressDetails(userAddress).paymentCredential as Credential;
    const userStakeHash = userStakeCred.hash; // staking PKH
    const userPaymentHash = userPaymtCred.hash; // payment PKH

    const collateralUtxos = await lucid.utxosAt(deployed.collateralScriptAddr);
    const collateralUtxo = getMyCollateralUtxo(collateralUtxos, userPaymtCred, userStakeCred, "used");
    if (!collateralUtxo) {
        console.log(`No collateral utxo found for user`);
        return;
    }

    const resetReq: UnifiedRedeemer = RedeemerType.LiquidateCollateral;
    const resetReqRedeemer = Data.to(resetReq, UnifiedRedeemer);

    // new collateral datum (reset 'loan requested' status)
    const newDatumObj: CollateralDatumObj = {
        owner: {
            payment_credential: { VerificationKey: [userPaymentHash] },
            stake_credential: { Inline: [{ VerificationKey: [userStakeHash] }] },
        },
        used_in: null,
    };
    const newCollateraldDatum = Data.to(newDatumObj, CollateralDatum);

    const collateralContractRefUtxo = refUtxos.find((utxo) => {
        if (utxo.assets[deployed.beaconTokens.collateral]) return true;
        else return false;
    })!;

    const userTx = await lucid
        .newTx()
        .collectFrom([collateralUtxo], resetReqRedeemer)
        .pay.ToContract(
            deployed.collateralScriptAddr,
            { kind: "inline", value: newCollateraldDatum as Datum },
            { lovelace: collateralUtxo.assets.lovelace },
        )
        .addSignerKey(adminPkh) // require signature from collateral owner, taken from input datum
        .readFrom([collateralContractRefUtxo])
        .complete();
    console.log(`loan request reset tx built`);

    // sign with user's account
    const userSignedTx = await userTx.sign.withWallet().complete();

    // Switch back to admin wallet:
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);

    // sign with admin's account
    const adminTx = lucid.fromTx(userSignedTx.toCBOR());
    const adminSignedTx = await adminTx.sign.withWallet().complete();

    console.log(`signedTx: ${stringify(adminSignedTx)}`);
    console.log(`signedTx hash: ${adminSignedTx.toHash()}`);
    console.log(`size: ~${adminSignedTx.toCBOR().length / 2048} KB`);

    console.log("");
    const txJson = JSON.parse(stringify(adminSignedTx));
    console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
    console.log("");

    const txHash = await adminSignedTx.submit();
    console.log(`tx submitted. Hash: ${txHash}`);
    console.log("");
}
await cancelLoanRequest();
