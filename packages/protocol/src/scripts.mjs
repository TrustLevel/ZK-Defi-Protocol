/**
 * Script parameter chain of one deployment, from the Aiken blueprint:
 *   pool_nft(seed) -> collateral_v5(policy, settlement_vkey_ref)
 *                  -> lending_pool_v5(policy, collateral_hash, borrow_vkey_ref,
 *                                     repay_vkey_ref, append_vkey_ref, lender_vkey_ref)
 * The blueprint (contracts/plutus.json) is passed in, so Node and the browser
 * load it their own way.
 */
import { applyParamsToScript, resolveScriptHash, serializePlutusScript, byteString } from "@meshsdk/core";
import { outputReference } from "./plutus.mjs";
import { POOL_NFT_NAME_HEX } from "./crypto.mjs";

function validator(blueprint, title) {
  const v = blueprint.validators.find((x) => x.title === title);
  if (!v) throw new Error(`validator ${title} not found in the blueprint`);
  return v.compiledCode;
}

// seed  = { txHash, outputIndex } the init tx spent (one-shot NFT policy)
// vkeys = { txHash, borrowIdx, settlementIdx, appendIdx, repayIdx } of the parked keys,
//         plus lender: { txHash, index } for the lender withdraw key
export function deriveScripts(blueprint, seed, vkeys, networkId = 0) {
  const ref = (idx) => outputReference(vkeys.txHash, idx);
  const nftCbor = applyParamsToScript(
    validator(blueprint, "v5/pool_nft.pool_nft.mint"), [outputReference(seed.txHash, seed.outputIndex)], "JSON");
  const policyId = resolveScriptHash(nftCbor, "V3");
  const collCbor = applyParamsToScript(
    validator(blueprint, "v5/collateral_v5.collateral_v5.spend"),
    [byteString(policyId), ref(vkeys.settlementIdx)], "JSON");
  const collHash = resolveScriptHash(collCbor, "V3");
  const poolCbor = applyParamsToScript(
    validator(blueprint, "v5/lending_pool_v5.lending_pool_v5.spend"),
    [
      byteString(policyId), byteString(collHash), ref(vkeys.borrowIdx), ref(vkeys.repayIdx), ref(vkeys.appendIdx),
      outputReference(vkeys.lender.txHash, vkeys.lender.index),
    ],
    "JSON");
  const addr = (code) => serializePlutusScript({ code, version: "V3" }, undefined, networkId).address;
  return {
    NFT_CBOR: nftCbor, POLICY_ID: policyId, POOL_NFT_UNIT: policyId + POOL_NFT_NAME_HEX,
    COLLATERAL_CBOR: collCbor, COLLATERAL_HASH: collHash, COLLATERAL_ADDRESS: addr(collCbor),
    POOL_CBOR: poolCbor, POOL_HASH: resolveScriptHash(poolCbor, "V3"), POOL_ADDRESS: addr(poolCbor),
  };
}
