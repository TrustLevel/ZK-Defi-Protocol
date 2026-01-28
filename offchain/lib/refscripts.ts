import {
    applyParamsToScript,
    Script,
    validatorToAddress,
    validatorToRewardAddress,
    validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { adminPkh, blueprint, CredentialType, provNetwork } from "./common.ts";

const refscriptsValidatorId = "refscripts.refscripts.spend";
const refscriptsCompiledCode =
    blueprint.validators.find((v: { title: string }) => v.title === refscriptsValidatorId).compiledCode;
export const refscriptsScript: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(refscriptsCompiledCode, [adminPkh]),
};
export const refscriptsScriptHash = validatorToScriptHash(refscriptsScript);
export const refscriptsCredential = { type: CredentialType.script, hash: refscriptsScriptHash };
export const refscriptsPolicyID = refscriptsScriptHash;
export const refscriptsScriptAddr = validatorToAddress(provNetwork, refscriptsScript, refscriptsCredential);
export const refscriptsRewardAddr = validatorToRewardAddress(provNetwork, refscriptsScript);
