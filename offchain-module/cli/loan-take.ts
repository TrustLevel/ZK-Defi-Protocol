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

// config: amount of collateral asset to deposit to the collateral contract
// -------------------------------------------------------------------
const borrowAmt = 434_000_000n; // 434 tUSDM

// selected from pre-set list of [term, interest_rate] contained in LendingPoolDatum
// change value to get different results / test
const loanTerm = 10_800_000n; // 3 hours
// -------------------------------------------------------------------

const lucid = getLucidInstance();
const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);
const loanAsset = {
    policy_id: deployed.loanableAsset.policyId,
    asset_name: deployed.loanableAsset.assetName,
};

const refUtxos = await lucid.utxosAt(deployed.refscriptsScriptAddr);

// Switch to user wallet:
lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
const userAddress = await lucid.wallet().address();
const userStakeCred = getAddressDetails(userAddress).stakeCredential as Credential;
const userPaymtCred = getAddressDetails(userAddress).paymentCredential as Credential;
const userStakeHash = userStakeCred.hash; // staking PKH
const userPaymentHash = userPaymtCred.hash; // payment PKH

const collateralUtxos = await lucid.utxosAt(deployed.collateralScriptAddr);
const collateralUtxo = getMyCollateralUtxo(collateralUtxos, userPaymtCred, userStakeCred, "unused");
if (!collateralUtxo) {
    console.log(`No collateral utxo found for user`);
    Deno.exit(0);
}
const inputDatum = Data.from(collateralUtxo.datum!, CollateralDatum);
// get owner's payment key hash from datum:
const ownerPaymentHash = Object.hasOwn(inputDatum.owner.payment_credential, "VerificationKey")
    ? (inputDatum.owner.payment_credential as PlutusVerificationKey).VerificationKey[0]
    : (inputDatum.owner.payment_credential as PlutusScriptKey).Script[0];

const borrowReq: UnifiedRedeemer = {
    BorrowRequest: {
        loan_amt: borrowAmt,
        loan_term: loanTerm,
        loan_asset: loanAsset,
    },
};
const borrowReqRedeemer = Data.to(borrowReq, UnifiedRedeemer);

// new collateral datum ('LoanRequested' status)
const loanReqstdDatumObj: CollateralDatumObj = {
    ...inputDatum,
    used_in: {
        status: LoanStatus.LoanRequested,
        borrowed_asset: loanAsset,
        borrowed_amt: borrowAmt,
        interest_amt: 0n, // no need to set this when user is still placing a request
        loan_term: loanTerm,
        maturity: 0n, // no need to set this when user is still placing a request
    },
};
const loanReqstdDatum = Data.to(loanReqstdDatumObj, CollateralDatum);

const collateralContractRefUtxo = refUtxos.find((utxo) => {
    if (utxo.assets[deployed.beaconTokens.collateral]) return true;
    else return false;
})!;

// ***********************************
// 1st tx (user places loan request):
// ***********************************
const [newWalletInputs, derivedOutputs, userTx] = await lucid
    .newTx()
    .collectFrom([collateralUtxo], borrowReqRedeemer)
    .pay.ToContract(
        deployed.collateralScriptAddr,
        { kind: "inline", value: loanReqstdDatum as Datum },
        collateralUtxo.assets,
    )
    .addSignerKey(ownerPaymentHash) // require signature from collateral owner, taken from input datum
    .readFrom([collateralContractRefUtxo])
    .chain();
console.log(`user's loan request tx built`);

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

// **********************************************
// chained 2nd tx (admin processes loan request):
// **********************************************
lucid.overrideUTxOs(newWalletInputs);
const newCollateralUtxo = getMyCollateralUtxo(derivedOutputs, userPaymtCred, userStakeCred, "used");
if (!newCollateralUtxo) {
    console.log(`No *new* collateral utxo found for user`);
    Deno.exit(0);
}
const lendingPoolUtxo = (await lucid.utxosAt(deployed.lendingPoolScriptAddr))[0];
const lpDatum = Data.from(lendingPoolUtxo.datum!, LendingPoolDatum);

// calculate payable interest, using applicable interest rate in lending pool datum
const interestAmt = (() => {
    const interestRate = lpDatum.interest_rates.find((rate) => rate[0] == loanTerm);
    if (!interestRate) throw new Error(`No interest rate found for requested loan term: ${loanTerm}`);
    return BigInt(Math.floor((Number(borrowAmt) * Number(interestRate[1])) / 100));
})();
console.log(`calculated interestAmt: ${interestAmt}`);

// tx validity range; need to set this now that admin is processing loan request
const validFrom = Date.now() - (10 * 20 * 1000); // start lower bound 10 slots earlier
const validTo = validFrom + (1000 * 60 * 60 * 2); // 2hrs
console.log(`validTo: ${validTo}`);

// calc loan maturity, starting from validTo
const loanMaturity = (() => {
    const loanStart = Math.floor(validTo / 1_000); // in seconds, from validTo (in order to drop the odd millisecs);
    const loanStartMs = loanStart * 1_000; // convert back to millisecs
    return BigInt(loanStartMs) + loanTerm;
})();
console.log(`loanMaturity: ${loanMaturity}`);

// new collateral datum ('loan processed' status)
const loanProcessedDatumObj: CollateralDatumObj = {
    owner: {
        payment_credential: { VerificationKey: [userPaymentHash] },
        stake_credential: { Inline: [{ VerificationKey: [userStakeHash] }] },
    },
    used_in: {
        status: LoanStatus.LoanProcessed,
        borrowed_asset: loanAsset,
        borrowed_amt: borrowAmt,
        interest_amt: interestAmt, // need to set this here now that admin is processing loan request
        loan_term: loanTerm,
        maturity: loanMaturity, // need to set this here now that admin is processing loan request
    },
};
const loanProcessedDatum = Data.to(loanProcessedDatumObj, CollateralDatum);

// calculate remaining loanable asset amt in lending pool after processing this loan request
const loanableAssetId = loanAsset.policy_id + loanAsset.asset_name;
const reserveAmt = lendingPoolUtxo.assets[loanableAssetId];
const newReserveAmt = reserveAmt - borrowAmt;

// lending_pool redeemer
const borrowProc: UnifiedRedeemer = RedeemerType.BorrowProcess;
const borrowProcRedeemer = Data.to(borrowProc, UnifiedRedeemer);

const lendingPoolContractRefUtxo = refUtxos.find((utxo) => {
    if (utxo.assets[deployed.beaconTokens.lendingPool]) return true;
    else return false;
})!;

const adminTx = await lucid
    .newTx()
    .collectFrom([newCollateralUtxo, lendingPoolUtxo], borrowProcRedeemer)
    .pay.ToContract(
        deployed.collateralScriptAddr,
        { kind: "inline", value: loanProcessedDatum as Datum },
        { lovelace: newCollateralUtxo.assets.lovelace },
    )
    .pay.ToContract(
        deployed.lendingPoolScriptAddr,
        { kind: "inline", value: lendingPoolUtxo.datum! as Datum },
        {
            lovelace: lendingPoolUtxo.assets.lovelace,
            [loanableAssetId]: newReserveAmt,
        },
    )
    .pay.ToAddress(userAddress, { [loanableAssetId]: borrowAmt })
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
