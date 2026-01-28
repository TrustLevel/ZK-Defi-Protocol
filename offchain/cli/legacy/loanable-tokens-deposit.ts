import { Datum, fromText, stringify } from "@lucid-evolution/lucid";
import {
    AssetClass,
    collateralScriptHash,
    deployDetailsFile,
    getLoanableAssetAtAdminAddress,
    getLucidInstance,
    InterestRate,
    LendingPoolDatumObj,
    makeLendingPoolDatum,
} from "../index.ts";

// config: lending_pool contract settings to be stored in utxo datum
// -------------------------------------------------------------------
const collateralAsset: AssetClass = { // currently set to ADA:
    policy_id: fromText(""), // ada policy id in aiken is just empty string
    asset_name: fromText(""), // ada asset name in aiken is just empty string
};
const collateralPrice = [620_000n, 6n] as [bigint, bigint]; // 0.620000 tUSDM / 1 ADA
const collateralRatio = 70n; // 70%
const interestRates = [
    [10_800_000n, 5n], // 3 hrs, 5% (quick maturing, useful for testing)
    [604_800_000n, 8n], // 7 days, 8%
    [1_209_600_000n, 10n], // 14 days, 10%
    [2_592_000_000n, 15n], // 30 days, 15%
    [3_888_000_000n, 25n], // 45 days, 25%
] as InterestRate[];
// -------------------------------------------------------------------

const lucid = getLucidInstance();

const deployed = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync(deployDetailsFile)),
);

const { loanableAsset } = deployed;
const loanableAssetAmt = await getLoanableAssetAtAdminAddress({
    policy_id: loanableAsset.policyId,
    asset_name: loanableAsset.assetName,
});

const lpDatumObj: LendingPoolDatumObj = {
    collateral_contract: collateralScriptHash,
    loanable_asset: {
        policy_id: loanableAsset.policyId,
        asset_name: loanableAsset.assetName,
    },
    collateral_asset: collateralAsset,
    collateral_price: collateralPrice,
    collateral_ratio: collateralRatio,
    interest_rates: interestRates,
};
const lp_datum = makeLendingPoolDatum(lpDatumObj);

const tx = await lucid
    .newTx()
    .pay.ToContract(
        deployed.lendingPoolScriptAddr,
        { kind: "inline", value: lp_datum as Datum },
        { [loanableAsset.policyId + loanableAsset.assetName]: loanableAssetAmt },
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

// update deployDetailsFile
deployed.lp_datum = lpDatumObj;
const data = new TextEncoder().encode(stringify(deployed));
Deno.writeFileSync(deployDetailsFile, data);
