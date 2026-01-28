import {
    Credential,
    credentialToRewardAddress,
    Data,
    fromText,
    getAddressDetails,
    Kupmios,
    Lucid,
    mintingPolicyToId,
    Network,
    scriptFromNative,
} from "@lucid-evolution/lucid";

const kupoUrl = Deno.env.get("KUPO_PREPROD") as string;
const ogmiosUrl = Deno.env.get("OGMIOS_PREPROD") as string;
export const provNetwork = Deno.env.get("PROVIDER_NETWORK") as Network;
export const providerKupmios = new Kupmios(kupoUrl, ogmiosUrl);

export const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED") as string;
export const USER1_WALLET_SEED = Deno.env.get("USER1_WALLET_SEED") as string;

const lucid = await Lucid(providerKupmios, provNetwork);
lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);

export function getLucidInstance() {
    return lucid;
}

export const adminAddress = await lucid.wallet().address();
export const adminStakeCred = getAddressDetails(adminAddress).stakeCredential as Credential;
export const adminPaymtCred = getAddressDetails(adminAddress).paymentCredential as Credential;
export const adminStakeAddr = credentialToRewardAddress(provNetwork, adminStakeCred);
export const adminPkh = adminStakeCred.hash; // staking PKH
export const adminSpendPkh = adminPaymtCred.hash; // payment PKH

export const adminMintingScript = scriptFromNative({
    type: "all",
    scripts: [
        { type: "sig", keyHash: adminPkh },
        // { type: "after", slot: unixTimeToSlot(lucid.config().network as Network, 1704067200000) },
    ],
});
export const adminTokensPolicyId = mintingPolicyToId(adminMintingScript);

export const tusdMintingScript = scriptFromNative({
    type: "all",
    scripts: [
        { type: "sig", keyHash: adminSpendPkh },
        // { type: "after", slot: unixTimeToSlot(lucid.config().network as Network, 1704067201000) },
    ],
});
export const tusdTokensPolicyId = mintingPolicyToId(tusdMintingScript);

// CIP68 token name prefixes
export const prefix_100 = "000643b0";
export const prefix_333 = "0014df10";

/**
 * Beacon tokens for the utxos that will hold the protocol's reference scripts
 */
export const beaconTokens = {
    refscripts: adminTokensPolicyId + fromText(`refscripts`),
    collateral: adminTokensPolicyId + fromText(`collateral`),
    lendingPool: adminTokensPolicyId + fromText(`lendingPool`),
};

export const blueprint = JSON.parse(
    new TextDecoder().decode(Deno.readFileSync("./onchain/plutus.json")),
);

export enum CredentialType {
    script = "Script",
    key = "Key",
}

export type AssetClass = {
    policy_id: string;
    asset_name: string;
};

// ```aiken
// pub type UnifiedRedeemer {
//     BorrowRequest { loan_amt: Int, loan_term: Int, loan_asset: AssetClass }
//     BorrowProcess
//     RepayRequest
//     RepayProcess
//     LiquidateCollateral
//     WithdrawCollateral
//     WithdrawLendingPool
// }
// ```
export enum RedeemerType {
    BorrowRequest = "BorrowRequest",
    BorrowProcess = "BorrowProcess",
    RepayRequest = "RepayRequest",
    RepayProcess = "RepayProcess",
    LiquidateCollateral = "LiquidateCollateral",
    WithdrawCollateral = "WithdrawCollateral",
    WithdrawLendingPool = "WithdrawLendingPool",
}
const UnifiedRedeemerSchema = Data.Enum([
    Data.Object({
        BorrowRequest: Data.Object({
            loan_amt: Data.Integer(),
            loan_term: Data.Integer(),
            loan_asset: Data.Object({
                policy_id: Data.Bytes({ minLength: 0, maxLength: 28 }),
                asset_name: Data.Bytes({ minLength: 0, maxLength: 64 }),
            }),
        }),
    }),
    Data.Literal(RedeemerType.BorrowProcess),
    Data.Literal(RedeemerType.RepayRequest),
    Data.Literal(RedeemerType.RepayProcess),
    Data.Literal(RedeemerType.LiquidateCollateral),
    Data.Literal(RedeemerType.WithdrawCollateral),
    Data.Literal(RedeemerType.WithdrawLendingPool),
]);
export type UnifiedRedeemer = Data.Static<typeof UnifiedRedeemerSchema>;
export const UnifiedRedeemer = UnifiedRedeemerSchema as unknown as UnifiedRedeemer;

export const deployDetailsFile = "./data/deployed.json";
try {
    await Deno.lstat("./data");
    // do nothing if dir already exists
} catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
    }
    Deno.mkdirSync("./data");
}
