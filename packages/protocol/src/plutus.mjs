/**
 * Plutus data of the v5 validators: encoders for every datum and redeemer the
 * protocol writes, decoders for the ones the indexer and the UI read back.
 * Encoders return Mesh "JSON" data; integers are passed as decimal strings so
 * 255-bit values never pass through a JS number.
 *
 * Aiken encodings (contracts/lib/types_v5.ak) — field order is load-bearing:
 *   DepositDatumV5 = Constr 0 [commitment, timestamp, unlock_to: Address]
 *   PoolDatumV5    = Constr 0 [total_deposited, total_borrowed, interest_rate,
 *                    group_root, group_next_index, repaid_root,
 *                    next_index, external_nullifier, repay_external_nullifier,
 *                    loan_asset: Asset, collateral_assets: [CollateralAsset],
 *                    loan_denomination, open_loans: [Int],
 *                    used_nullifiers: [Int], last_updated, lender_root,
 *                    lender_next_index, total_shares, lender_nullifiers: [Int],
 *                    lender_external_nullifier, share_start_price, liquidity_reserve]
 *   Asset          = Constr 0 [policy_id, asset_name]          (ADA: "", "")
 *   CollateralAsset= Constr 0 [policy_id, asset_name, denomination]
 *   PoolRedeemerV5 : AddLiquidity 0 [Int, Proof] ·
 *                    DepositCollateral 1 [Int, Int (asset index), Proof] ·
 *                    BorrowAnonymous 2 [Proof, Int, ByteArray] ·
 *                    RepayAnonymous 3 [Proof, Int, Int, Proof] ·
 *                    WithdrawLiquidity 4 [Proof, Int, ByteArray]
 *   CollateralRedeemerV5 : UnlockDeposit 0 [Proof, OutputReference]
 *   Proof          = Constr 0 [piA, piB, piC]   (compressed points)
 *   OutputReference= Constr 0 [txHash, index]
 */
import {
  conStr, integer, byteString, list, pubKeyAddress, deserializeAddress, deserializeDatum, serializeAddressObj,
} from "@meshsdk/core";
import { compressG1, compressG2 } from "./crypto.mjs";

const int = (v) => integer(BigInt(v).toString());

// ── encoders ─────────────────────────────────────────────────────────────────
export function outputReference(txHash, index) {
  return conStr(0, [byteString(txHash), int(index)]);
}
// A key payment address (bech32) as Aiken `Address` data, keeping its stake part.
export function addressData(bech32) {
  const a = deserializeAddress(bech32);
  if (!a.pubKeyHash) throw new Error(`not a key payment address: ${bech32}`);
  if (a.stakeScriptCredentialHash) return pubKeyAddress(a.pubKeyHash, a.stakeScriptCredentialHash, true);
  return pubKeyAddress(a.pubKeyHash, a.stakeCredentialHash || undefined);
}
export function paymentKeyHash(bech32) {
  const { pubKeyHash } = deserializeAddress(bech32);
  if (!pubKeyHash) throw new Error(`not a key payment address: ${bech32}`);
  return pubKeyHash;
}
export function depositDatum(commitment, timestamp, unlockToBech32) {
  return conStr(0, [int(commitment), int(timestamp), addressData(unlockToBech32)]);
}
// An asset as { policy_id, asset_name } (hex; ADA is "", "").
export function assetData(a) {
  return conStr(0, [byteString(a.policy_id), byteString(a.asset_name)]);
}
export function collateralAssetData(c) {
  return conStr(0, [byteString(c.policy_id), byteString(c.asset_name), int(c.denomination)]);
}
export function poolDatum(d) {
  return conStr(0, [
    int(d.total_deposited), int(d.total_borrowed), int(d.interest_rate),
    int(d.group_root), int(d.group_next_index), int(d.repaid_root), int(d.next_index),
    int(d.external_nullifier), int(d.repay_external_nullifier),
    assetData(d.loan_asset), list(d.collateral_assets.map(collateralAssetData)),
    int(d.loan_denomination),
    list((d.open_loans || []).map(int)), list((d.used_nullifiers || []).map(int)),
    int(d.last_updated),
    int(d.lender_root), int(d.lender_next_index), int(d.total_shares),
    list((d.lender_nullifiers || []).map(int)),
    int(d.lender_external_nullifier), int(d.share_start_price), int(d.liquidity_reserve),
  ]);
}
// Inline datum on the loan payout output: the loan nullifier. The lender
// withdraw payout is tagged the same way with its withdraw nullifier W.
export function loanTag(loanNullifier) {
  return int(loanNullifier);
}
// A compressed proof { piA, piB, piC } (see crypto.compressProof).
export function proofData({ piA, piB, piC }) {
  return conStr(0, [byteString(piA), byteString(piB), byteString(piC)]);
}
// Verification key datum (SnarkVerificationKey) parked for the validators.
export function vkeyDatum(curve, vkeyJson) {
  return conStr(0, [
    int(vkeyJson.nPublic),
    byteString(compressG1(curve, vkeyJson.vk_alpha_1)),
    byteString(compressG2(curve, vkeyJson.vk_beta_2)),
    byteString(compressG2(curve, vkeyJson.vk_gamma_2)),
    byteString(compressG2(curve, vkeyJson.vk_delta_2)),
    list([]),
    list(vkeyJson.IC.map((p) => byteString(compressG1(curve, p)))),
  ]);
}

export function R_AddLiquidity(commitment, appendProof) {
  return conStr(0, [int(commitment), proofData(appendProof)]);
}
export function R_DepositCollateral(commitment, assetIndex, appendProof) {
  return conStr(1, [int(commitment), int(assetIndex), proofData(appendProof)]);
}
export function R_Borrow(proof, loanNullifier, recipientPkh) {
  return conStr(2, [proofData(proof), int(loanNullifier), byteString(recipientPkh)]);
}
export function R_Repay(proof, loanNullifier, repayNullifier, appendProof) {
  return conStr(3, [proofData(proof), int(loanNullifier), int(repayNullifier), proofData(appendProof)]);
}
export function R_WithdrawLiquidity(proof, withdrawNullifier, recipientPkh) {
  return conStr(4, [proofData(proof), int(withdrawNullifier), byteString(recipientPkh)]);
}
export function R_Unlock(proof, poolRefTx, poolRefIdx) {
  return conStr(0, [proofData(proof), outputReference(poolRefTx, poolRefIdx)]);
}
// NFT mint redeemer (the policy ignores it).
export const R_Mint = conStr(0, []);

// ── decoders (CBOR hex -> plain values, integers as BigInt) ──────────────────
const asInt = (d) => BigInt(d.int);
const asProof = (d) => ({ piA: d.fields[0].bytes, piB: d.fields[1].bytes, piC: d.fields[2].bytes });
const constrOf = (d) => Number(d.constructor);

const asAsset = (d) => ({ policy_id: d.fields[0].bytes, asset_name: d.fields[1].bytes });
const asCollateralAsset = (d) => ({ ...asAsset(d), denomination: asInt(d.fields[2]) });
const POOL_FIELDS = [
  "total_deposited", "total_borrowed", "interest_rate", "group_root",
  "group_next_index", "repaid_root", "next_index", "external_nullifier", "repay_external_nullifier",
  "loan_asset", "collateral_assets", "loan_denomination", "open_loans", "used_nullifiers", "last_updated",
  "lender_root", "lender_next_index", "total_shares", "lender_nullifiers", "lender_external_nullifier",
  "share_start_price", "liquidity_reserve",
];
export function decodePoolDatum(cbor) {
  const d = deserializeDatum(cbor);
  if (constrOf(d) !== 0 || d.fields.length !== POOL_FIELDS.length) throw new Error("not a PoolDatumV5");
  return Object.fromEntries(POOL_FIELDS.map((name, i) => {
    const f = d.fields[i];
    if (name === "loan_asset") return [name, asAsset(f)];
    if (name === "collateral_assets") return [name, f.list.map(asCollateralAsset)];
    return [name, f.list ? f.list.map(asInt) : asInt(f)];
  }));
}
export function decodeDepositDatum(cbor) {
  const d = deserializeDatum(cbor);
  if (constrOf(d) !== 0 || d.fields.length !== 3) throw new Error("not a DepositDatumV5");
  return { commitment: asInt(d.fields[0]), timestamp: asInt(d.fields[1]), unlockTo: d.fields[2] };
}
export function decodePoolRedeemer(cbor) {
  const d = deserializeDatum(cbor);
  const f = d.fields;
  switch (constrOf(d)) {
    case 0: return { type: "AddLiquidity", commitment: asInt(f[0]), appendProof: asProof(f[1]) };
    case 1: return {
      type: "DepositCollateral", commitment: asInt(f[0]), assetIndex: asInt(f[1]), appendProof: asProof(f[2]),
    };
    case 2: return { type: "BorrowAnonymous", proof: asProof(f[0]), loanNullifier: asInt(f[1]), recipient: f[2].bytes };
    case 3: return {
      type: "RepayAnonymous", proof: asProof(f[0]), loanNullifier: asInt(f[1]),
      repayNullifier: asInt(f[2]), appendProof: asProof(f[3]),
    };
    case 4: return {
      type: "WithdrawLiquidity", proof: asProof(f[0]), withdrawNullifier: asInt(f[1]), recipient: f[2].bytes,
    };
    default: throw new Error(`unknown pool redeemer constructor ${constrOf(d)}`);
  }
}
// A decoded Aiken `Address` (e.g. DepositDatumV5.unlock_to) back to bech32.
export function addressFromData(addressData, networkId = 0) {
  const plain = JSON.parse(JSON.stringify(addressData, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
  return serializeAddressObj(plain, networkId);
}
export function decodeUnlockRedeemer(cbor) {
  const d = deserializeDatum(cbor);
  if (constrOf(d) !== 0) throw new Error("not an UnlockDeposit redeemer");
  const ref = d.fields[1];
  return { proof: asProof(d.fields[0]), poolRef: { txHash: ref.fields[0].bytes, index: Number(ref.fields[1].int) } };
}
