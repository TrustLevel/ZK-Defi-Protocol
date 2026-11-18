/**
 * Plutus data of the v5 validators: encoders for every datum and redeemer the
 * protocol writes, decoders for the ones the indexer and the UI read back.
 * Encoders return Mesh "JSON" data; integers are passed as decimal strings so
 * 255-bit values never pass through a JS number.
 *
 * Aiken encodings (contracts/lib/types_v5.ak) — field order is load-bearing:
 *   DepositDatumV5 = Constr 0 [commitment, timestamp, unlock_to: Address]
 *   PoolDatumV5    = Constr 0 [total_deposited, total_borrowed, interest_rate,
 *                    collateral_ratio, group_root, group_next_index, repaid_root,
 *                    next_index, external_nullifier, repay_external_nullifier,
 *                    collateral_denomination, loan_denomination, open_loans: [Int],
 *                    used_nullifiers: [Int], last_updated]
 *   PoolRedeemerV5 : AddLiquidity 0 [] · DepositCollateral 1 [Int, Proof] ·
 *                    BorrowAnonymous 2 [Proof, Int, Int, ByteArray] ·
 *                    RepayAnonymous 3 [Proof, Int, Int, Int, Proof]
 *   CollateralRedeemerV5 : UnlockDeposit 0 [Proof, OutputReference]
 *   Proof          = Constr 0 [piA, piB, piC]   (compressed points)
 *   OutputReference= Constr 0 [txHash, index]
 */
import {
  conStr, integer, byteString, list, pubKeyAddress, deserializeAddress, deserializeDatum,
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
export function poolDatum(d) {
  return conStr(0, [
    int(d.total_deposited), int(d.total_borrowed), int(d.interest_rate), int(d.collateral_ratio),
    int(d.group_root), int(d.group_next_index), int(d.repaid_root), int(d.next_index),
    int(d.external_nullifier), int(d.repay_external_nullifier),
    int(d.collateral_denomination), int(d.loan_denomination),
    list((d.open_loans || []).map(int)), list((d.used_nullifiers || []).map(int)),
    int(d.last_updated),
  ]);
}
// Inline datum on the loan payout output: the loan nullifier.
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

export const R_AddLiquidity = conStr(0, []);
export function R_DepositCollateral(commitment, appendProof) {
  return conStr(1, [int(commitment), proofData(appendProof)]);
}
export function R_Borrow(proof, loanAmount, loanNullifier, recipientPkh) {
  return conStr(2, [proofData(proof), int(loanAmount), int(loanNullifier), byteString(recipientPkh)]);
}
export function R_Repay(proof, repayAmount, loanNullifier, repayNullifier, appendProof) {
  return conStr(3, [proofData(proof), int(repayAmount), int(loanNullifier), int(repayNullifier), proofData(appendProof)]);
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

const POOL_FIELDS = [
  "total_deposited", "total_borrowed", "interest_rate", "collateral_ratio", "group_root",
  "group_next_index", "repaid_root", "next_index", "external_nullifier", "repay_external_nullifier",
  "collateral_denomination", "loan_denomination", "open_loans", "used_nullifiers", "last_updated",
];
export function decodePoolDatum(cbor) {
  const d = deserializeDatum(cbor);
  if (constrOf(d) !== 0 || d.fields.length !== POOL_FIELDS.length) throw new Error("not a PoolDatumV5");
  return Object.fromEntries(POOL_FIELDS.map((name, i) => {
    const f = d.fields[i];
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
    case 0: return { type: "AddLiquidity" };
    case 1: return { type: "DepositCollateral", commitment: asInt(f[0]), appendProof: asProof(f[1]) };
    case 2: return {
      type: "BorrowAnonymous", proof: asProof(f[0]), loanAmount: asInt(f[1]),
      loanNullifier: asInt(f[2]), recipient: f[3].bytes,
    };
    case 3: return {
      type: "RepayAnonymous", proof: asProof(f[0]), repayAmount: asInt(f[1]),
      loanNullifier: asInt(f[2]), repayNullifier: asInt(f[3]), appendProof: asProof(f[4]),
    };
    default: throw new Error(`unknown pool redeemer constructor ${constrOf(d)}`);
  }
}
export function decodeUnlockRedeemer(cbor) {
  const d = deserializeDatum(cbor);
  if (constrOf(d) !== 0) throw new Error("not an UnlockDeposit redeemer");
  const ref = d.fields[1];
  return { proof: asProof(d.fields[0]), poolRef: { txHash: ref.fields[0].bytes, index: Number(ref.fields[1].int) } };
}
