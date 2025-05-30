import {
    applyParamsToScript,
    Data,
    Script,
    validatorToAddress,
    validatorToRewardAddress,
    validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { adminPkh, AssetClass, blueprint, CredentialType, provNetwork } from "./common.ts";

const LendingPoolValParamsSchema = Data.Object({
    admin_key_hash: Data.Bytes({ minLength: 28, maxLength: 28 }),
});
type LendingPoolValParams = Data.Static<typeof LendingPoolValParamsSchema>;
const LendingPoolValParams = LendingPoolValParamsSchema as unknown as LendingPoolValParams;
const lendingPoolValParams: LendingPoolValParams = {
    admin_key_hash: adminPkh,
};
export const lendingPoolValParamsData: Data = Data.from(Data.to(lendingPoolValParams, LendingPoolValParams));
const lendingPoolValidatorId = "lending_pool.lending_pool.spend";
const lendingPoolCompiledCode =
    blueprint.validators.find((v: { title: string }) => v.title === lendingPoolValidatorId).compiledCode;
export const lendingPoolScript: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(lendingPoolCompiledCode, [lendingPoolValParamsData]),
};
export const lendingPoolScriptHash = validatorToScriptHash(lendingPoolScript);
export const lendingPoolCredential = { type: CredentialType.script, hash: lendingPoolScriptHash };
export const lendingPoolPolicyID = lendingPoolScriptHash;
export const lendingPoolScriptAddr = validatorToAddress(provNetwork, lendingPoolScript, lendingPoolCredential);
export const lendingPoolRewardAddr = validatorToRewardAddress(provNetwork, lendingPoolScript);

export type CollateralPrice = [bigint, bigint]; // [price, decimal digits]
export type InterestRate = [bigint, bigint]; // [term (in milliseconds), rate]
export type LendingPoolDatumObj = {
    collateral_contract: string;
    loanable_asset: AssetClass;
    collateral_asset: AssetClass;
    collateral_price: CollateralPrice;
    collateral_ratio: bigint;
    interest_rates: InterestRate[];
};

export const LendingPoolDatumSchema = Data.Object({
    collateral_contract: Data.Bytes({ minLength: 28, maxLength: 28 }),
    loanable_asset: Data.Object({
        policy_id: Data.Bytes({ minLength: 0, maxLength: 28 }),
        asset_name: Data.Bytes({ minLength: 0, maxLength: 64 }),
    }),
    collateral_asset: Data.Object({
        policy_id: Data.Bytes({ minLength: 0, maxLength: 28 }),
        asset_name: Data.Bytes({ minLength: 0, maxLength: 64 }),
    }),
    collateral_price: Data.Tuple([Data.Integer(), Data.Integer()]),
    collateral_ratio: Data.Integer(),
    interest_rates: Data.Array(
        Data.Tuple([Data.Integer(), Data.Integer()]),
    ),
});
type LendingPoolDatum = Data.Static<typeof LendingPoolDatumSchema>;
export const LendingPoolDatum = LendingPoolDatumSchema as unknown as LendingPoolDatum;

export function makeLendingPoolDatum(obj: LendingPoolDatumObj): Data {
    const lendingPoolDatumData: Data = Data.to(obj, LendingPoolDatum);
    return lendingPoolDatumData;
}
