/**
 * v6 off-chain shared helpers (Mesh-based, Node ESM) — PRIVATE lending model.
 *
 * Two BLS12-381 circuits:
 *   BORROW/REPAY: collateral_semaphore (Merkle membership + nullifier + sufficiency)
 *     public [group_merkle_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier]
 *   UNLOCK:       unlock_proof (commitment-bound + nullifier)
 *     public [commitment, loan_nullifier, external_nullifier]
 *
 * Aiken encodings (contracts/lib/types_v5.ak):
 *   DepositDatumV5 = conStr 0 [commitment:int, timestamp:int]
 *   OpenLoan       = conStr 0 [nullifier:int, principal:int, start:int]
 *   PoolDatumV5    = conStr 0 [total_deposited, total_borrowed, interest_rate,
 *                    collateral_ratio, vkey_ref:OutRef, unlock_vkey_ref:OutRef,
 *                    group_root:int, external_nullifier:int, open_loans:[OpenLoan],
 *                    admin:bytes, last_updated:int]
 *   OutputReference= conStr 0 [txHash:bytes, index:int]   (stdlib v2.2.0 flat bytes)
 *   PoolRedeemerV5 : Deposit=0[] · SetGroupRoot=1[int] ·
 *                    BorrowAnonymous=2[Proof,int,int] · RepayAnonymous=3[Proof,int,int]
 *   CollateralRedeemerV5 : UnlockDeposit=0[Proof, OutRef, int]
 *   Proof          = conStr 0 [piA, piB, piC]
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
  applyParamsToScript,
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

// circuit artifacts
export const BORROW_WASM = path.join(CIRCUITS, "collateral_semaphore_js/collateral_semaphore.wasm");
export const BORROW_ZKEY = path.join(CIRCUITS, "keys/collateral_semaphore_final.zkey");
export const BORROW_VKEY = JSON.parse(fs.readFileSync(path.join(CIRCUITS, "keys/verification_key_semaphore.json"), "utf8"));
export const UNLOCK_WASM = path.join(CIRCUITS, "unlock_proof_js/unlock_proof.wasm");
export const UNLOCK_ZKEY = path.join(CIRCUITS, "keys/unlock_proof_final.zkey");
export const UNLOCK_VKEY = JSON.parse(fs.readFileSync(path.join(CIRCUITS, "keys/verification_key_unlock.json"), "utf8"));

export const RECEIPTS = path.join(__dirname, "receipts");

// Protocol constants (demo). external_nullifier scopes loan nullifiers; the tree
// depth must match the circuit (CollateralSemaphore(10)).
export const DEPTH = 10;
export const EXTERNAL_NULLIFIER = 7777n;
// Every loan is exactly this size, so loan amounts are uniform (carry no
// per-loan information) and open_loans stores only nullifiers.
export const LOAN_DENOMINATION = 10_000_000n; // 10 ADA

// ── env ──────────────────────────────────────────────────────────────────────
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
    networkId: 0, fetcher: provider, submitter: provider,
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

// ── validators from plutus.json ──────────────────────────────────────────────
const BLUEPRINT = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/plutus.json"), "utf8"));
function validator(title) {
  const v = BLUEPRINT.validators.find((x) => x.title === title);
  if (!v) throw new Error(`validator ${title} not found in plutus.json`);
  return v;
}
// Pool is unparameterized; collateral is parameterized by the pool script hash.
const POOL_V = validator("v5/lending_pool_v5.lending_pool_v5.spend");
const COLL_V = validator("v5/collateral_v5.collateral_v5.spend");
export const POOL_CBOR = applyCborEncoding(POOL_V.compiledCode);
export const POOL_HASH = resolveScriptHash(POOL_CBOR, "V3");
if (POOL_HASH !== POOL_V.hash) throw new Error("pool script hash mismatch vs plutus.json");
// apply pool_script_hash param to collateral
export const COLLATERAL_CBOR = applyParamsToScript(COLL_V.compiledCode, [POOL_HASH], "Mesh");
export const COLLATERAL_HASH = resolveScriptHash(COLLATERAL_CBOR, "V3");
export const POOL_ADDRESS = serializePlutusScript({ code: POOL_CBOR, version: "V3" }, undefined, 0).address;
export const COLLATERAL_ADDRESS = serializePlutusScript({ code: COLLATERAL_CBOR, version: "V3" }, undefined, 0).address;

// always-false park for VKey UTxOs (read-only reference inputs only).
export const ALWAYS_FALSE_ADDRESS =
  "addr_test1wzl94ddu5xplr7p8f55ldtxjvw6cqqsh57jkj4vndwthtkgdw2fq8";

// ── BLS12-381 point compression ──────────────────────────────────────────────
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
  const y1 = F.toObject(F.sqrt(x3b)), y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const y = BigInt(point[1]);
  if ((y1 > y2 && y > y2) || (y1 < y2 && y > y1)) result[0] |= YBIT;
  return result.toString("hex");
}
function compressedG2(curve, point) {
  const result = Buffer.concat([toBufferBE(BigInt(point[0][1]), 48), toBufferBE(BigInt(point[0][0]), 48)]);
  result[0] |= COMPRESSED;
  if (BigInt(point[2][0]) !== 1n) { result[0] |= INFINITY; return result.toString("hex"); }
  const F = curve.G2.F;
  const x = F.fromObject(point[0].map((i) => BigInt(i)));
  const x3b = F.add(F.mul(F.square(x), x), curve.G2.b);
  const y1 = F.toObject(F.sqrt(x3b)), y2 = F.toObject(F.neg(F.sqrt(x3b)));
  const gt = (a, b) => a[1] > b[1] || (a[1] === b[1] && a[0] > b[0]);
  const y = point[1].map((i) => BigInt(i));
  if ((gt(y1, y2) && gt(y, y2)) || (gt(y2, y1) && gt(y, y1))) result[0] |= YBIT;
  return result.toString("hex");
}

// ── VKey datum (SnarkVerificationKey) for either circuit ─────────────────────
export async function buildVkeyDatum(vkeyJson) {
  const curve = await ff.getCurveFromName("bls12381");
  const d = conStr(0, [
    integer(vkeyJson.nPublic),
    byteString(compressedG1(curve, vkeyJson.vk_alpha_1)),
    byteString(compressedG2(curve, vkeyJson.vk_beta_2)),
    byteString(compressedG2(curve, vkeyJson.vk_gamma_2)),
    byteString(compressedG2(curve, vkeyJson.vk_delta_2)),
    list([]),
    list(vkeyJson.IC.map((p) => byteString(compressedG1(curve, p)))),
  ]);
  await curve.terminate();
  return d;
}

// ── Poseidon255 commitment + Merkle tree (matches the circuit) ───────────────
export function computeCommitment(collateralAmountLovelace, secret) {
  return poseidon2([BigInt(collateralAmountLovelace), BigInt(secret)]);
}
export function computeNullifier(secret, externalNullifier = EXTERNAL_NULLIFIER) {
  return poseidon2([BigInt(secret), BigInt(externalNullifier)]);
}
// Build the depth-DEPTH tree over `commitments` (padded with 0) and return the root.
export function merkleRoot(commitments) {
  let level = new Array(1 << DEPTH).fill(0n);
  commitments.forEach((c, i) => { level[i] = BigInt(c); });
  for (let d = 0; d < DEPTH; d++) {
    const next = new Array(level.length >> 1);
    for (let i = 0; i < next.length; i++) next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
    level = next;
  }
  return level[0];
}
// Membership path for the commitment at `index`.
export function merkleProof(commitments, index) {
  let level = new Array(1 << DEPTH).fill(0n);
  commitments.forEach((c, i) => { level[i] = BigInt(c); });
  const siblings = [], pathIndices = [];
  let idx = index;
  for (let d = 0; d < DEPTH; d++) {
    siblings.push(level[idx ^ 1]);
    pathIndices.push(idx & 1);
    const next = new Array(level.length >> 1);
    for (let i = 0; i < next.length; i++) next[i] = poseidon2([level[2 * i], level[2 * i + 1]]);
    level = next; idx >>= 1;
  }
  return { root: level[0], siblings, pathIndices };
}

// ── proof generation ─────────────────────────────────────────────────────────
async function compressProof(proof) {
  const curve = await ff.getCurveFromName("bls12381");
  const piA = compressedG1(curve, proof.pi_a);
  const piB = compressedG2(curve, proof.pi_b);
  const piC = compressedG1(curve, proof.pi_c);
  await curve.terminate();
  return conStr(0, [byteString(piA), byteString(piB), byteString(piC)]);
}

// Borrow/repay membership proof.
export async function generateBorrowProof({ commitments, index, secret, collateralAmount, loanAmount, ratio, externalNullifier = EXTERNAL_NULLIFIER }) {
  const { root, siblings, pathIndices } = merkleProof(commitments, index);
  const nullifier = computeNullifier(secret, externalNullifier);
  const input = {
    group_merkle_root: root.toString(),
    loan_nullifier: nullifier.toString(),
    loan_amount: BigInt(loanAmount).toString(),
    collateral_ratio: BigInt(ratio).toString(),
    external_nullifier: BigInt(externalNullifier).toString(),
    secret: BigInt(secret).toString(),
    collateral_amount: BigInt(collateralAmount).toString(),
    pathIndices: pathIndices.map(String),
    siblings: siblings.map((s) => s.toString()),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, BORROW_WASM, BORROW_ZKEY);
  if (!(await snarkjs.groth16.verify(BORROW_VKEY, publicSignals, proof))) throw new Error("borrow proof off-chain verify failed");
  return { proofData: await compressProof(proof), root, nullifier, publicSignals };
}

// Unlock commitment-bound proof.
export async function generateUnlockProof({ commitment, secret, collateralAmount, externalNullifier = EXTERNAL_NULLIFIER }) {
  const nullifier = computeNullifier(secret, externalNullifier);
  const input = {
    commitment: BigInt(commitment).toString(),
    loan_nullifier: nullifier.toString(),
    external_nullifier: BigInt(externalNullifier).toString(),
    secret: BigInt(secret).toString(),
    collateral_amount: BigInt(collateralAmount).toString(),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, UNLOCK_WASM, UNLOCK_ZKEY);
  if (!(await snarkjs.groth16.verify(UNLOCK_VKEY, publicSignals, proof))) throw new Error("unlock proof off-chain verify failed");
  return { proofData: await compressProof(proof), nullifier, publicSignals };
}

// ── Plutus data encoders ─────────────────────────────────────────────────────
export function outputReference(txHash, index) {
  return conStr(0, [byteString(txHash), integer(index)]);
}
export function depositDatum(commitment, timestamp) {
  return conStr(0, [integer(commitment.toString()), integer(timestamp)]);
}
export function poolDatum(d) {
  return conStr(0, [
    integer(d.total_deposited),
    integer(d.total_borrowed),
    integer(d.interest_rate),
    integer(d.collateral_ratio),
    outputReference(d.vkey_ref_tx, d.vkey_ref_idx),
    outputReference(d.unlock_vkey_ref_tx, d.unlock_vkey_ref_idx),
    integer(d.group_root.toString()),
    integer(d.external_nullifier.toString()),
    integer(d.loan_denomination.toString()),
    list((d.open_loans || []).map((n) => integer(n.toString()))),
    byteString(d.admin),
    integer(d.last_updated),
  ]);
}

// redeemers
export const R_Deposit = conStr(0, []);
export function R_SetGroupRoot(newRoot) { return conStr(1, [integer(newRoot.toString())]); }
export function R_Borrow(proofData, loanAmount, nullifier) {
  return conStr(2, [proofData, integer(loanAmount), integer(nullifier.toString())]);
}
export function R_Repay(proofData, repayAmount, nullifier) {
  return conStr(3, [proofData, integer(repayAmount), integer(nullifier.toString())]);
}
export function R_Unlock(proofData, poolRefTx, poolRefIdx, nullifier) {
  return conStr(0, [proofData, outputReference(poolRefTx, poolRefIdx), integer(nullifier.toString())]);
}

export function makeTxBuilder(provider, { autoEvaluate = true } = {}) {
  return new MeshTxBuilder({
    fetcher: provider,
    ...(autoEvaluate ? { evaluator: provider } : {}),
    verbose: false,
  });
}

// ── receipts ─────────────────────────────────────────────────────────────────
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

export { serializePlutusScript, conStr, integer, byteString, list };
