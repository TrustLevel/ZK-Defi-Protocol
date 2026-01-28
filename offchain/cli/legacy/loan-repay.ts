import { Credential, Data, Datum, getAddressDetails, stringify } from "@lucid-evolution/lucid";
import {
    CollateralDatum,
    CollateralDatumObj,
    deployDetailsFile,
    getLucidInstance,
    getMyCollateralUtxo,
    LendingPoolDatum,
    LoanStatus,
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

/**
 * Submits 2 transactions for repaying a loan. The first one is the repayment request
 * created by the user. The 2nd - chained to the first one - is where the admin processes
 * the repayment request, spending utxos from both the collateral and lending pool contracts.
 *
 * The repayment asset should be contained in the collateral output created by the user in
 * the 1st tx. In the 2nd tx, the admin transfers this repayment asset to the lending pool
 * and marks the collateral utxo as unlocked, free to be used for another loan or withdrawn.
 *
 * IMPORTANT: Before running this, be sure that the user's wallet already has enough of the
 * borrowed assets to repay the loan principal and the interest.
 *
 * The function performs the following steps:
 * 1. Retrieves the user's locked collateral UTXO.
 * 2. Builds a transaction to place a repayment request for the loan.
 * 3. Signs the transaction with the user's wallet.
 * 4. Submits the transaction.
 * 5. Retrieves the new collateral UTXO (updated with repayment request status) and the lending pool UTXO.
 * 6. Builds a transaction to process the repayment request.
 * 7. Signs the transaction with the admin wallet.
 * 8. Submits the transaction.
 */
async function repayLoan() {
    // Switch to user wallet:
    lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
    const userAddress = await lucid.wallet().address();
    const userStakeCred = getAddressDetails(userAddress).stakeCredential as Credential;
    const userPaymtCred = getAddressDetails(userAddress).paymentCredential as Credential;

    const collateralUtxos = await lucid.utxosAt(deployed.collateralScriptAddr);
    const collateralUtxo = getMyCollateralUtxo(collateralUtxos, userPaymtCred, userStakeCred, "used");
    if (!collateralUtxo) {
        console.log(`No collateral utxo found for user`);
        return;
    }
    const inputDatum = Data.from(collateralUtxo.datum!, CollateralDatum);
    // get owner's payment key hash from datum:
    const ownerPaymentHash = Object.hasOwn(inputDatum.owner.payment_credential, "VerificationKey")
        ? (inputDatum.owner.payment_credential as PlutusVerificationKey).VerificationKey[0]
        : (inputDatum.owner.payment_credential as PlutusScriptKey).Script[0];

    // new collateral datum ('RepayRequested' status)
    const loanRepayReqDatumObj: CollateralDatumObj = {
        owner: inputDatum.owner,
        used_in: {
            ...inputDatum.used_in!,
            status: LoanStatus.RepayRequested,
        },
    };
    const loanRepayReqstdDatum = Data.to(loanRepayReqDatumObj, CollateralDatum);

    // repayment asset
    const repaymentAssetId = inputDatum.used_in!.borrowed_asset.policy_id +
        inputDatum.used_in!.borrowed_asset.asset_name;
    const repaymentAmt = inputDatum.used_in!.borrowed_amt + inputDatum.used_in!.interest_amt;

    // prepare collateral contract reference utxo
    const collateralContractRefUtxo = refUtxos.find((utxo) => {
        if (utxo.assets[deployed.beaconTokens.collateral]) return true;
        else return false;
    })!;

    // `RepayRequest` redeemer
    const repayReq: UnifiedRedeemer = RedeemerType.RepayRequest;
    const repayReqRedeemer = Data.to(repayReq, UnifiedRedeemer);

    // ***************************************
    // 1st tx (user places repayment request):
    // ***************************************
    const [newWalletInputs, derivedOutputs, userTx] = await lucid
        .newTx()
        .collectFrom([collateralUtxo], repayReqRedeemer)
        .pay.ToContract(
            deployed.collateralScriptAddr,
            { kind: "inline", value: loanRepayReqstdDatum as Datum },
            {
                ...collateralUtxo.assets,
                [repaymentAssetId]: repaymentAmt,
            },
        )
        .addSignerKey(ownerPaymentHash) // require signature from collateral owner, taken from input datum
        .readFrom([collateralContractRefUtxo])
        .chain();
    console.log(`user's repayment request tx built`);

    const userSignedTx = await userTx.sign.withWallet().complete();
    console.log(`signedTx: ${stringify(userSignedTx)}`);
    console.log(`signedTx hash: ${userSignedTx.toHash()}`);
    console.log(`size: ~${userSignedTx.toCBOR().length / 2048} KB`);

    console.log("");
    const txJson = JSON.parse(stringify(userSignedTx));
    console.log(`txFee: ${parseInt(txJson.body.fee) / 1_000_000} ADA`);
    console.log("");

    const userTxHash = await userSignedTx.submit();
    console.log(`tx submitted. Hash: ${userTxHash}`);
    console.log("");

    // ***************************************************
    // chained 2nd tx (admin processes repayment request):
    // ***************************************************
    lucid.overrideUTxOs(newWalletInputs);
    const newCollateralUtxo = getMyCollateralUtxo(derivedOutputs, userPaymtCred, userStakeCred, "used");
    if (!newCollateralUtxo) {
        console.log(`No *new* collateral utxo found for user`);
        return;
    }
    const lendingPoolUtxo = (await lucid.utxosAt(deployed.lendingPoolScriptAddr))[0];
    const lpDatum = Data.from(lendingPoolUtxo.datum!, LendingPoolDatum);

    // tx validity range; need to set this now that admin is processing repayment request
    const validFrom = Date.now() - (10 * 20 * 1000); // start lower bound 10 slots earlier
    const validTo = validFrom + (1000 * 60 * 60 * 2); // 2hrs
    console.log(`validTo: ${validTo}`);

    // new collateral datum (unlocked status)
    const reqDatum = Data.from(newCollateralUtxo.datum!, CollateralDatum);
    const repaymentProcessedDatumObj: CollateralDatumObj = { ...reqDatum, used_in: null };
    const repaymentProcessedDatum = Data.to(repaymentProcessedDatumObj, CollateralDatum);

    // calculate updated loanable asset amt in lending pool after processing this repayment request
    const loanableAssetId = lpDatum.loanable_asset.policy_id + lpDatum.loanable_asset.asset_name;
    const reserveAmt = lendingPoolUtxo.assets[loanableAssetId];
    const newReserveAmt = reserveAmt + repaymentAmt;

    // new collateral output value
    const newCollateralAssets = { ...newCollateralUtxo.assets };
    delete newCollateralAssets[repaymentAssetId];

    // lending_pool redeemer
    const repayProc: UnifiedRedeemer = RedeemerType.RepayProcess;
    const repayProcRedeemer = Data.to(repayProc, UnifiedRedeemer);

    const lendingPoolContractRefUtxo = refUtxos.find((utxo) => {
        if (utxo.assets[deployed.beaconTokens.lendingPool]) return true;
        else return false;
    })!;

    const adminTx = await lucid
        .newTx()
        .collectFrom([newCollateralUtxo, lendingPoolUtxo], repayProcRedeemer)
        .pay.ToContract(
            deployed.collateralScriptAddr,
            { kind: "inline", value: repaymentProcessedDatum as Datum },
            newCollateralAssets,
        )
        .pay.ToContract(
            deployed.lendingPoolScriptAddr,
            { kind: "inline", value: lendingPoolUtxo.datum! as Datum },
            {
                ...lendingPoolUtxo.assets,
                [loanableAssetId]: newReserveAmt,
            },
        )
        .validFrom(validFrom)
        .validTo(validTo)
        .readFrom([collateralContractRefUtxo, lendingPoolContractRefUtxo])
        .complete();
    console.log(`tx built`);

    const adminSignedTx = await adminTx.sign.withWallet().complete();
    console.log(`adminSignedTx: ${stringify(adminSignedTx)}`);
    console.log(`adminSignedTx hash: ${adminSignedTx.toHash()}`);
    console.log(`size: ~${adminSignedTx.toCBOR().length / 2048} KB`);

    console.log("");
    const adminTxJson = JSON.parse(stringify(adminSignedTx));
    console.log(`txFee: ${parseInt(adminTxJson.body.fee) / 1_000_000} ADA`);
    console.log("");

    const adminTxHash = await adminSignedTx.submit();
    console.log(`tx submitted. Hash: ${adminTxHash}`);
    console.log("");
}
await repayLoan();
