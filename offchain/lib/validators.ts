/**
 * Validator Scripts for V3 Protocol
 *
 * Loads compiled validators from plutus.json and applies parameters
 */

import { type Script, applyParamsToScript, Data, Lucid, getAddressDetails, validatorToAddress, validatorToScriptHash } from "@lucid-evolution/lucid";
import { BEACON_POLICY_ID } from "./config.ts";
import { DepositContractParamsSchema } from "./types.ts";

// Path to compiled validators (relative to working directory: offchain/backend/)
const PLUTUS_JSON_PATH = "../../contracts/plutus.json";

// Cache for loaded validators
let lendingPoolV3Validator: Script | null = null;

/**
 * Load and parameterize Lending Pool V3 validator script
 *
 * The validator requires parameters:
 * - beacon_policy: Policy ID of beacon tokens
 * - admin_key_hash: Admin wallet payment credential hash
 *
 * @param lucid - Lucid instance
 * @param adminAddress - Admin wallet address
 * @returns Lucid Script object with applied parameters
 */
export async function getLendingPoolV3Validator(
    _lucid: Awaited<ReturnType<typeof Lucid>>,
    _adminAddress: string
): Promise<Script> {
    if (lendingPoolV3Validator) {
        return lendingPoolV3Validator;
    }

    try {
        // Load plutus.json
        const plutusJson = JSON.parse(
            await Deno.readTextFile(PLUTUS_JSON_PATH)
        );

        // Find lending_pool_v3 validator
        const validator = plutusJson.validators.find((v: any) =>
            v.title === "lending_pool_v3.lending_pool_v3.spend"
        );

        if (!validator) {
            throw new Error("Lending Pool V3 validator not found in plutus.json");
        }

        // Extract admin key hash from admin address
        const adminAddressDetails = getAddressDetails(_adminAddress);
        if (!adminAddressDetails.paymentCredential?.hash) {
            throw new Error("Invalid admin address: no payment credential");
        }
        const adminKeyHash = adminAddressDetails.paymentCredential.hash;

        // Build params (same structure as deployment script)
        const params = Data.to({
            beacon_policy: BEACON_POLICY_ID,
            admin_key_hash: adminKeyHash,
        }, DepositContractParamsSchema);

        // Apply parameters to validator (same as deployment script)
        const parameterizedPoolScript = applyParamsToScript(
            validator.compiledCode,
            [params]
        );

        lendingPoolV3Validator = {
            type: "PlutusV3",  // ← FIXED! Aiken v1.1.15 only compiles to V3
            script: parameterizedPoolScript,
        };

        // Debug: Verify address matches deployed contract
        const scriptHash = validatorToScriptHash(lendingPoolV3Validator);
        const credential = { type: "Script" as const, hash: scriptHash };
        const scriptAddress = validatorToAddress("Preprod", lendingPoolV3Validator, credential);
        console.log(`   🔍 Debug: Loaded validator address: ${scriptAddress}`);

        return lendingPoolV3Validator;
    } catch (error) {
        throw new Error(`Failed to load Lending Pool V3 validator: ${error}`);
    }
}
