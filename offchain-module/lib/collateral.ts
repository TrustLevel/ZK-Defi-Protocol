import {
    applyParamsToScript,
    Credential,
    Data,
    Datum,
    Script,
    UTxO,
    validatorToAddress,
    validatorToRewardAddress,
    validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { adminPkh, AssetClass, blueprint, CredentialType, provNetwork } from "./common.ts";
import { lendingPoolScriptHash } from "./lending-pool.ts";
import { assertEquals } from "@std/assert";

const CollateralValParamsSchema = Data.Object({
    lending_pool: Data.Bytes({ minLength: 28, maxLength: 28 }),
    admin_key_hash: Data.Bytes({ minLength: 28, maxLength: 28 }),
});
type CollateralValParams = Data.Static<typeof CollateralValParamsSchema>;
const CollateralValParams = CollateralValParamsSchema as unknown as CollateralValParams;
const collateralValParams: CollateralValParams = {
    lending_pool: lendingPoolScriptHash,
    admin_key_hash: adminPkh,
};
export const collateralValParamsData: Data = Data.from(Data.to(collateralValParams, CollateralValParams));
const collateralValidatorId = "collateral.collateral.spend";
const collateralCompiledCode =
    blueprint.validators.find((v: { title: string }) => v.title === collateralValidatorId).compiledCode;
export const collateralScript: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(collateralCompiledCode, [collateralValParamsData]),
};
export const collateralScriptHash = validatorToScriptHash(collateralScript);
export const collateralCredential = { type: CredentialType.script, hash: collateralScriptHash };
export const collateralScriptAddr = validatorToAddress(provNetwork, collateralScript, collateralCredential);
export const collateralRewardAddr = validatorToRewardAddress(provNetwork, collateralScript);

export type PlutusVerificationKey = { VerificationKey: [string] };
export type PlutusScriptKey = { Script: [string] };
export type PlutusPaymentCred = PlutusVerificationKey | PlutusScriptKey;
export type PlutusStakeCred = { Inline: [PlutusVerificationKey | PlutusScriptKey] } | {
    Pointer: { slot_number: bigint; transaction_index: bigint; certificate_index: bigint };
} | null;
export type UserAddress = {
    payment_credential: PlutusPaymentCred;
    stake_credential: PlutusStakeCred;
};
export enum LoanStatus {
    LoanRequested = "LoanRequested",
    LoanProcessed = "LoanProcessed",
    RepayRequested = "RepayRequested",
}
// export type LoanStatus = "LoanRequested" | "LoanProcessed" | "RepayRequested";
export type LoanDatum = {
    status: LoanStatus;
    borrowed_asset: AssetClass;
    borrowed_amt: bigint;
    interest_amt: bigint;
    loan_term: bigint;
    maturity: bigint;
};
export type CollateralDatumObj = {
    owner: UserAddress;
    used_in: LoanDatum | null;
};
const CollateralDatumSchema = Data.Object({
    owner: Data.Object({
        payment_credential: Data.Enum([
            Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
            Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
        ]),
        stake_credential: Data.Nullable(
            Data.Enum([
                Data.Object({
                    Inline: Data.Tuple([
                        Data.Enum([
                            Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
                            Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
                        ]),
                    ]),
                }),
                Data.Object({
                    Pointer: Data.Object({
                        slot_number: Data.Integer(),
                        transaction_index: Data.Integer(),
                        certificate_index: Data.Integer(),
                    }),
                }),
            ]),
        ),
    }),
    used_in: Data.Nullable(
        Data.Object({
            status: Data.Enum([
                Data.Literal(LoanStatus.LoanRequested),
                Data.Literal(LoanStatus.LoanProcessed),
                Data.Literal(LoanStatus.RepayRequested),
            ]),
            borrowed_asset: Data.Object({
                policy_id: Data.Bytes({ minLength: 0, maxLength: 28 }),
                asset_name: Data.Bytes({ minLength: 0, maxLength: 64 }),
            }),
            borrowed_amt: Data.Integer(),
            interest_amt: Data.Integer(),
            loan_term: Data.Integer(),
            maturity: Data.Integer(),
        }),
    ),
});
type CollateralDatum = Data.Static<typeof CollateralDatumSchema>;
export const CollateralDatum = CollateralDatumSchema as unknown as CollateralDatum;

export function makeCollateralDatum(obj: CollateralDatumObj): Datum {
    const collateralDatumData: Datum = Data.to(obj, CollateralDatum);
    return collateralDatumData;
}

export function getMyCollateralUtxo(
    utxos: UTxO[],
    userPaymentCred: Credential,
    userStakeCred?: Credential,
    status: "used" | "unused" = "unused",
): UTxO | null {
    const paymentCred: PlutusPaymentCred = userPaymentCred.type === "Key"
        ? { VerificationKey: [userPaymentCred.hash] }
        : { Script: [userPaymentCred.hash] };
    const stakeCred: PlutusStakeCred = (() => {
        if (userStakeCred) {
            return userStakeCred.type === "Key"
                ? { Inline: [{ VerificationKey: [userStakeCred.hash] }] }
                : { Inline: [{ Script: [userStakeCred.hash] }] };
        } else return null;
    })();
    const myUtxo = utxos.find((utxo) => {
        // console.log(`utxo: ${utxo.txHash}#${utxo.outputIndex}`);
        const datumCbor = utxo.datum;
        if (!datumCbor) return false;

        const datum = Data.from(datumCbor, CollateralDatum);
        const owner = datum.owner;

        const paymentCredMatches = (() => {
            try {
                assertEquals(paymentCred, owner.payment_credential);
                // console.log(`paymentCredMatches!`);
                return true;
            } catch (_error) {
                // console.log(`paymentCred does not match.`);
                return false;
            }
        })();
        const stakeCredMatches = (() => {
            try {
                assertEquals(stakeCred, owner.stake_credential);
                // console.log(`stakeCredMatches!`);
                return true;
            } catch (_error) {
                // console.log(`stakeCred does not match.`);
                return false;
            }
        })();

        const isNotLocked = datum.used_in === null;

        return status === "unused"
            ? paymentCredMatches && stakeCredMatches && isNotLocked
            : paymentCredMatches && stakeCredMatches && !isNotLocked;
    });
    return myUtxo ?? null;
}
