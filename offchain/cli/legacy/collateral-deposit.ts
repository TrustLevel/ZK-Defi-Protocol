import { Credential, Data, Datum, getAddressDetails, stringify } from "@lucid-evolution/lucid";
import { CollateralDatum, CollateralDatumObj, deployDetailsFile, getLucidInstance, USER1_WALLET_SEED } from "../index.ts";

// config: amount of collateral asset to deposit to the collateral contract
// -------------------------------------------------------------------
const collateralAmtToDeposit = 1_000_000_000n;
// -------------------------------------------------------------------

const lucid = getLucidInstance();
const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

// Switch to user wallet:
lucid.selectWallet.fromSeed(USER1_WALLET_SEED);
const userAddress = await lucid.wallet().address();
const userStakeCred = getAddressDetails(userAddress).stakeCredential as Credential;
const userPaymtCred = getAddressDetails(userAddress).paymentCredential as Credential;
const userStakeHash = userStakeCred.hash; // staking PKH
const userPaymentHash = userPaymtCred.hash; // payment PKH

const collateralDatumObj: CollateralDatumObj = {
    owner: {
        payment_credential: { VerificationKey: [userPaymentHash] },
        stake_credential: { Inline: [{ VerificationKey: [userStakeHash] }] },
    },
    used_in: null,
};
const collateralDatum: Datum = Data.to(collateralDatumObj, CollateralDatum);

const tx = await lucid
    .newTx()
    .pay.ToContract(
        deployed.collateralScriptAddr,
        { kind: "inline", value: collateralDatum as Datum },
        { lovelace: collateralAmtToDeposit },
    )
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
