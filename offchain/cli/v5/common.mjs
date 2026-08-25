/**
 * v5 off-chain shared helpers (Mesh-based, Node ESM).
 *
 * Milestone 3: real on-chain Groth16 verification. This module wires up the
 * Mesh BlockfrostProvider + admin wallet, derives the v5 validator addresses
 * from contracts/plutus.json, loads the BLS12-381 circuit artifacts, and
 * provides point-compression + proof/vkey/datum encoders that match exactly
 * what the on-chain ak_381/groth16 verifier and types_v5 expect.
 *
 * Encoding facts (from contracts/lib/types_v5.ak and ak_381/groth16):
 *   DepositDatumV5  = conStr 0 [owner:bytes, collateral_amount:int, commitment:int, timestamp:int]
 *   PoolDatumV5     = conStr 0 [total_deposited:int, total_borrowed:int, interest_rate:int,
 *                               collateral_ratio:int, vkey_ref:OutputReference, last_updated:int]
 *   OutputReference = conStr 0 [ txHash:bytes , outputIndex:int ]   (stdlib v2.2.0: flat bytes)
 *   PoolRedeemerV5:
 *     Deposit                                       = conStr 0 []
 *     BorrowAnonymous{collateral_ref,proof,loan}    = conStr 1 [OutputReference, Proof, int]
 *     RepayAnonymous {deposit_ref,proof,repay}      = conStr 2 [OutputReference, Proof, int]
 *   CollateralRedeemerV5:
 *     Withdraw                                      = conStr 0 []
 *     UsedAsCollateral{loan_id}                     = conStr 1 [bytes]
 *     UnlockDeposit{proof,vkey_ref}                 = conStr 2 [Proof, OutputReference]
 *   Proof                                           = conStr 0 [piA:bytes, piB:bytes, piC:bytes]
 *   SnarkVerificationKey = conStr 0 [nPublic:int, vkAlpha, vkBeta, vkGamma, vkDelta,
 *                                    vkAlphaBeta:[], vkIC:List<bytes>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  serializePlutusScript,
  applyCborEncoding,
  resolveScriptHash,
  conStr,
  integer,
  byteString,
  list,
} from "@meshsdk/core";
import * as snarkjs from "snarkjs";
import * as ff from "ffjavascript";
import { poseidon2 } from "poseidon-bls12381";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../../..");
export const CIRCUITS = path.join(ROOT, "circuits");
export const WASM = path.join(CIRCUITS, "collateral_proof_js/collateral_proof.wasm");
export const ZKEY = path.join(CIRCUITS, "keys/collateral_proof_final.zkey");
export const VKEY_JSON = JSON.parse(
  fs.readFileSync(path.join(CIRCUITS, "keys/verification_key.json"), "utf8"),
);
export const RECEIPTS = path.join(__dirname, "receipts");

// ── env (names only; never log values) ──────────────────────────────────────
export function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  for (const k of ["PREPROD_BLOCKFROST_API_KEY", "ADMIN_WALLET_SEED"]) {
    if (!env[k]) throw new Error(`Missing required env var ${k}`);
  }
  return env;
}

export function makeProvider(env) {
  return new BlockfrostProvider(env.PREPROD_BLOCKFROST_API_KEY);
}

export async function makeWallet(env, provider) {
  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: provider,
    submitter: provider,
    key: { type: "mnemonic", words: env.ADMIN_WALLET_SEED.split(/\s+/) },
  });
  await wallet.init();
  return wallet;
}

export async function walletAddress(wallet) {
  const used = await wallet.getUsedAddresses();
  if (used.length) return used[0];
  const unused = await wallet.getUnusedAddresses();
  if (unused.length) return unused[0];
  return wallet.getChangeAddress();
}

// ── validator addresses from plutus.json ─────────────────────────────────────
const BLUEPRINT = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/plutus.json"), "utf8"));
function validator(title) {
  const v = BLUEPRINT.validators.find((x) => x.title === title);
  if (!v) throw new Error(`validator ${title} not found in plutus.json`);
  return v;
}
export const POOL_VALIDATOR = validator("v5/lending_pool_v5.lending_pool_v5.spend");
export const COLLATERAL_VALIDATOR = validator("v5/collateral_v5.collateral_v5.spend");
// Aiken's plutus.json `compiledCode` is the raw flat-encoded UPLC program. A
// PlutusV3 script witness / address must use the DOUBLE-CBOR-wrapped form
// (applyCborEncoding) — its hash then matches the blueprint `hash` field. Using
// the raw bytes yields a malformed script witness (MalformedScriptWitnesses) and
// a different (wrong) address. Always wrap.
export const POOL_CBOR = applyCborEncoding(POOL_VALIDATOR.compiledCode);
export const COLLATERAL_CBOR = applyCborEncoding(COLLATERAL_VALIDATOR.compiledCode);
if (resolveScriptHash(POOL_CBOR, "V3") !== POOL_VALIDATOR.hash)
  throw new Error("pool script hash mismatch vs plutus.json");
if (resolveScriptHash(COLLATERAL_CBOR, "V3") !== COLLATERAL_VALIDATOR.hash)
  throw new Error("collateral script hash mismatch vs plutus.json");
export const POOL_ADDRESS = serializePlutusScript(
  { code: POOL_CBOR, version: "V3" }, undefined, 0,
).address;
export const COLLATERAL_ADDRESS = serializePlutusScript(
  { code: COLLATERAL_CBOR, version: "V3" }, undefined, 0,
).address;

// always-false script address (preprod) — an unspendable park for the VKey UTxO.
// Reused from ZK-Voting-App: script hash 7b21efdd7d88e44caeadcf7c35a61c4dd2f6f57caac61674559fe435.
// The v5 code only ever reads the VKey UTxO as a read-only reference input, so
// the park address just needs to be permanently unspendable.
export const ALWAYS_FALSE_ADDRESS =
  "addr_test1wzl94ddu5xplr7p8f55ldtxjvw6cqqsh57jkj4vndwthtkgdw2fq8";

// ── BLS12-381 point compression (mirrors gen-onchain-fixture.cjs) ────────────
const COMPRESSED = 0b10000000, INFINITY = 0b01000000, YBIT = 0b00100000;
function toBufferBE(v, width) {
  const hex = BigInt(v).toString(16);
  if (hex.length > width * 2) throw new Error(`value too large for ${width} bytes`);
  return Buffer.from(hex.padStart(width * 2, "0"), "hex");
}
function compressedG1(curve, point) {
  const result = toBufferBE(BigInt(point[0]), 48);
  result[0] |= COMPRESSED;
  if (BigInt(point[2]) !== 1n) { result[0] |= INFINITY; return result.toString("hex"); }
  const F = curve.G1.F;
  const x = F.fromObject(BigInt(point[0]));
  const x3b = F.add(F.mul(F.square(x), x), curve.G1.b);
  const y1 = F.toObject(F.sqrt(x3b));
  const y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const y = BigInt(point[1]);
  if ((y1 > y2 && y > y2) || (y1 < y2 && y > y1)) result[0] |= YBIT;
  return result.toString("hex");
}
function compressedG2(curve, point) {
  const result = Buffer.concat([
    toBufferBE(BigInt(point[0][1]), 48),
    toBufferBE(BigInt(point[0][0]), 48),
  ]);
  result[0] |= COMPRESSED;
  if (BigInt(point[2][0]) !== 1n) { result[0] |= INFINITY; return result.toString("hex"); }
  const F = curve.G2.F;
  const x = F.fromObject(point[0].map((i) => BigInt(i)));
  const x3b = F.add(F.mul(F.square(x), x), curve.G2.b);
  const y1 = F.toObject(F.sqrt(x3b));
  const y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const gt = (a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]);
  const y = point[1].map((i) => BigInt(i));
  if ((gt(y1, y2) && gt(y, y2)) || (gt(y2, y1) && gt(y, y1))) result[0] |= YBIT;
  return result.toString("hex");
}

// ── VKey datum (SnarkVerificationKey) ────────────────────────────────────────
export async function buildVkeyDatum() {
  const curve = await ff.getCurveFromName("bls12381");
  const vkAlpha = compressedG1(curve, VKEY_JSON.vk_alpha_1);
  const vkBeta = compressedG2(curve, VKEY_JSON.vk_beta_2);
  const vkGamma = compressedG2(curve, VKEY_JSON.vk_gamma_2);
  const vkDelta = compressedG2(curve, VKEY_JSON.vk_delta_2);
  const vkIC = VKEY_JSON.IC.map((p) => compressedG1(curve, p));
  await curve.terminate();
  return conStr(0, [
    integer(VKEY_JSON.nPublic),
    byteString(vkAlpha),
    byteString(vkBeta),
    byteString(vkGamma),
    byteString(vkDelta),
    list([]), // vkAlphaBeta — unused by groth_verify
    list(vkIC.map((ic) => byteString(ic))),
  ]);
}

// ── commitment (Poseidon255 over BLS12-381), matches the circuit ─────────────
export function computeCommitment(collateralAmountLovelace, secret) {
  return poseidon2([BigInt(collateralAmountLovelace), BigInt(secret)]);
}

// ── proof generation + compression into ak_381 Proof ─────────────────────────
export async function generateProof(commitment, amount, ratio, secret, collateralAmount) {
  const input = {
    commitment: commitment.toString(),
    loan_amount: amount.toString(),
    collateral_ratio: ratio.toString(),
    secret: secret.toString(),
    collateral_amount: collateralAmount.toString(),
  };
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const proofGenMs = Date.now() - t0;
  const okOff = await snarkjs.groth16.verify(VKEY_JSON, publicSignals, proof);
  if (!okOff) throw new Error("off-chain groth16 verify failed — refusing to submit");
  const curve = await ff.getCurveFromName("bls12381");
  const piA = compressedG1(curve, proof.pi_a);
  const piB = compressedG2(curve, proof.pi_b);
  const piC = compressedG1(curve, proof.pi_c);
  await curve.terminate();
  return { publicSignals, proofGenMs, proofData: conStr(0, [byteString(piA), byteString(piB), byteString(piC)]) };
}

// ── Plutus data encoders for types_v5 ────────────────────────────────────────
// Aiken stdlib v2.2.0 OutputReference = conStr 0 [ transaction_id:ByteArray , output_index:Int ]
// (transaction_id is a bare ByteArray in this stdlib — NOT wrapped in a TransactionId constructor;
//  verified against contracts/plutus.json definition cardano/transaction/OutputReference.)
export function outputReference(txHash, index) {
  return conStr(0, [byteString(txHash), integer(index)]);
}
export function depositDatum(ownerKeyHash, collateralAmount, commitment, timestamp) {
  return conStr(0, [
    byteString(ownerKeyHash),
    integer(collateralAmount),
    integer(commitment.toString()),
    integer(timestamp),
  ]);
}
export function poolDatum(d) {
  return conStr(0, [
    integer(d.total_deposited),
    integer(d.total_borrowed),
    integer(d.interest_rate),
    integer(d.collateral_ratio),
    outputReference(d.vkey_ref_tx, d.vkey_ref_idx),
    integer(d.last_updated),
  ]);
}

export function makeTxBuilder(provider, { autoEvaluate = true } = {}) {
  // For heavy script txs (groth_verify) we omit the evaluator and supply explicit
  // ExUnits per redeemer instead — Blockfrost/Ogmios auto-evaluation returns an
  // opaque empty ScriptFailures for these, so we budget manually near the max.
  return new MeshTxBuilder({
    fetcher: provider,
    ...(autoEvaluate ? { evaluator: provider } : {}),
    verbose: false,
  });
}

// ── receipts ────────────────────────────────────────────────────────────────
export function saveReceipt(name, obj) {
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const file = path.join(RECEIPTS, name);
  fs.writeFileSync(file, JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  return file;
}
export function loadReceipt(name) {
  return JSON.parse(fs.readFileSync(path.join(RECEIPTS, name), "utf8"));
}

export function scanLink(txHash) {
  return `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

// Extract the payment key hash from a bech32 address via Mesh CSL serializer.
export { serializePlutusScript, conStr, integer, byteString, list };
