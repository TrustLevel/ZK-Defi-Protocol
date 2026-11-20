/**
 * End-to-end check of the backend, acting as the web app would: it talks only
 * to the API (no Blockfrost key), builds deposit and repay without a chain
 * fetcher and has them evaluated by POST /api/evaluate, and sends borrow and
 * unlock as proofs to the relayer; then buys one pool share from account A and
 * withdraws it to account B through the relayer. Two Mesh wallets stand in for
 * the browser wallet's accounts A and B.
 *
 *   node --env-file=../.env scripts/e2e-client.mjs http://127.0.0.1:3101
 *
 * Seeds: A = USER1_WALLET_SEED (collateral back to its account 1), B = USER1_FRESH_WALLET_SEED.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BlockfrostProvider, MeshWallet, MeshTxBuilder } from "@meshsdk/core";
import * as snarkjs from "snarkjs";
import * as ff from "ffjavascript";
import {
  computeCommitment, compressProof, appendInput, borrowInput, repayInput, settlementInput,
  computeRepayNullifier, COLLATERAL_DENOMINATION, computeLenderCommitment, lenderWithdrawInput,
} from "@zk-defi/protocol/crypto";
import { paymentKeyHash } from "@zk-defi/protocol/plutus";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { buildDeposit, buildRepay, buildAddLiquidity, buildCollateralSplit, hasCollateral } from "@zk-defi/protocol/tx";

const API = process.argv[2] || "http://127.0.0.1:3101";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const deployment = read(process.env.DEPLOYMENT_FILE || "packages/protocol/deployments/preprod-m4-lend.json");
const S = deriveScripts(read("contracts/plutus.json"), deployment.seed, deployment.vkeys);

// ── API client (what the web app's client does) ──────────────────────────────
async function api(method, p, body) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(API + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body && JSON.stringify(body) });
    if (r.status === 503) { await new Promise((x) => setTimeout(x, 5000)); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`${p} ${r.status} ${j.error}: ${j.message}`);
    return j;
  }
  throw new Error(`${p}: still indexing`);
}
const INT_LISTS = ["open_loans", "used_nullifiers", "lender_nullifiers"];
async function state() {
  const s = await api("GET", "/api/state");
  const datum = Object.fromEntries(Object.entries(s.pool.datum).map(([k, v]) => [k, INT_LISTS.includes(k) ? v.map(BigInt) : BigInt(v)]));
  return {
    pool: { utxo: s.pool.utxo, datum },
    leaves: { commitments: s.leaves.commitments.map(BigInt), repaid: s.leaves.repaid.map(BigInt), lenders: s.leaves.lenders.map(BigInt) },
  };
}
const evaluator = {
  evaluateTx: async (tx) => (await api("POST", "/api/evaluate", { tx })).redeemers.map((r) => ({
    ...r, budget: { mem: Number(r.budget.mem), steps: Number(r.budget.steps) },
  })),
};
// Chain lookups the transaction builder needs (reference inputs), via the API.
const fetcher = {
  fetchUTxOs: (txHash) => api("GET", `/api/utxos/${txHash}`),
  fetchCostModels: () => api("GET", "/api/cost-models"),
};
// Wait until /api/state shows the effect, i.e. the backend indexed the tx.
async function until(pred, what) {
  for (let i = 0; i < 60; i++) {
    const s = await state();
    if (pred(s)) return s;
    await new Promise((x) => setTimeout(x, 5000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ── wallets standing in for the browser wallet ──────────────────────────────
const env = process.env;
const walletBackend = new BlockfrostProvider(env.PREPROD_BLOCKFROST_API_KEY); // only the stand-in wallets use it
async function wallet(seedVar, accountIndex = 0) {
  const w = new MeshWallet({ networkId: 0, fetcher: walletBackend, submitter: walletBackend, accountIndex, key: { type: "mnemonic", words: env[seedVar].split(/\s+/) } });
  await w.init();
  const address = await w.getChangeAddress();
  return { w, address, payer: async () => ({ address, utxos: await w.getUtxos() }) };
}
// Script transactions need a pure-ADA UTxO as collateral; create one if missing.
async function ensureCollateral(acc) {
  const payer = await acc.payer();
  if (hasCollateral(payer.utxos)) return;
  const tx = await buildCollateralSplit(new MeshTxBuilder({}), { payer });
  const { txHash } = await api("POST", "/api/submit", { tx: await acc.w.signTx(tx) });
  log("collateral split", txHash);
  for (let i = 0; i < 60 && !hasCollateral((await acc.payer()).utxos); i++) await new Promise((x) => setTimeout(x, 5000));
}

// ── proving (the web app does this in a Web Worker) ──────────────────────────
const CIRCUIT = { append: "append_proof", borrow: "collateral_semaphore", repay: "repay_proof", settlement: "settlement_proof", lender: "lender_withdraw" };
const prove = (kind, input) => snarkjs.groth16.fullProve(input,
  path.join(ROOT, `circuits/${CIRCUIT[kind]}_js/${CIRCUIT[kind]}.wasm`), path.join(ROOT, `circuits/keys/${CIRCUIT[kind]}_final.zkey`));
const curve = await ff.getCurveFromName("bls12381");

const A = await wallet("USER1_WALLET_SEED");
const A1 = await wallet("USER1_WALLET_SEED", 1);
const B = await wallet("USER1_FRESH_WALLET_SEED");
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// 1. deposit — account A signs; built without a fetcher, evaluated by the API
await ensureCollateral(A);
await ensureCollateral(B);
let s = await state();
const secret = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"));
const commitment = computeCommitment(COLLATERAL_DENOMINATION, secret);
const ap = appendInput({ leavesBefore: s.leaves.commitments, leaf: commitment });
const depTx = await buildDeposit(new MeshTxBuilder({ fetcher, evaluator }), {
  S, deployment, pool: s.pool, commitment, newGroupRoot: ap.newRoot, unlockTo: A1.address, payer: await A.payer(),
  appendProof: compressProof(curve, (await prove("append", ap.input)).proof),
});
const { txHash: depHash } = await api("POST", "/api/submit", { tx: await A.w.signTx(depTx) });
log("deposit", depHash);
s = await until((x) => x.leaves.commitments.includes(commitment), "deposit indexed");

// 2. borrow — proof to the relayer, loan to account B
const b = borrowInput({
  commitments: s.leaves.commitments, index: s.leaves.commitments.indexOf(commitment), secret,
  ratio: s.pool.datum.collateral_ratio, recipientPkh: paymentKeyHash(B.address),
});
const bp = await prove("borrow", b.input);
log("borrow relayed", (await api("POST", "/api/relay/borrow", { ...bp, recipient: B.address })).txHash);
s = await until((x) => x.pool.datum.open_loans.includes(b.nullifier), "borrow indexed");

// 3. repay — account B signs; built without a fetcher
const r = repayInput({ commitments: s.leaves.commitments, index: s.leaves.commitments.indexOf(commitment), secret, ratio: s.pool.datum.collateral_ratio });
const ra = appendInput({ leavesBefore: s.leaves.repaid, leaf: r.R });
const repTx = await buildRepay(new MeshTxBuilder({ fetcher, evaluator }), {
  S, deployment, pool: s.pool, nullifier: r.nullifier, R: r.R, newRepaidRoot: ra.newRoot, payer: await B.payer(),
  proof: compressProof(curve, (await prove("repay", r.input)).proof),
  appendProof: compressProof(curve, (await prove("append", ra.input)).proof),
});
log("repay", (await api("POST", "/api/submit", { tx: await B.w.signTx(repTx) })).txHash);
s = await until((x) => x.leaves.repaid.includes(r.R), "repay indexed");

// 4. unlock — proof to the relayer; collateral to A's unlock_to (account 1)
const R = computeRepayNullifier(secret);
const sp = await prove("settlement", settlementInput({ commitment, secret, repaid: s.leaves.repaid, index: s.leaves.repaid.indexOf(R) }).input);
log("unlock relayed", (await api("POST", "/api/relay/unlock", { ...sp, deposit: { txHash: depHash, outputIndex: 1 } })).txHash);

// 5. lend — account A buys one share; the append proof puts the lender note into lender_root
s = await state();
const lenderSecret = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"));
const lenderLeaf = computeLenderCommitment(lenderSecret);
const la = appendInput({ leavesBefore: s.leaves.lenders, leaf: lenderLeaf });
const lendTx = await buildAddLiquidity(new MeshTxBuilder({ fetcher, evaluator }), {
  S, deployment, pool: s.pool, commitment: lenderLeaf, newLenderRoot: la.newRoot, payer: await A.payer(),
  appendProof: compressProof(curve, (await prove("append", la.input)).proof),
});
log("share bought", (await api("POST", "/api/submit", { tx: await A.w.signTx(lendTx) })).txHash);
s = await until((x) => x.leaves.lenders.includes(lenderLeaf), "share indexed");

// 6. withdraw — proof to the relayer; one share's value to account B
const lw = lenderWithdrawInput({
  notes: s.leaves.lenders, index: s.leaves.lenders.indexOf(lenderLeaf), secret: lenderSecret,
  recipientPkh: paymentKeyHash(B.address), lenderExternalNullifier: s.pool.datum.lender_external_nullifier,
});
const wp = await prove("lender", lw.input);
log("withdraw relayed", (await api("POST", "/api/relay/withdraw", { ...wp, recipient: B.address })).txHash);
await until((x) => x.pool.datum.lender_nullifiers.includes(lw.nullifier), "withdraw indexed");

await curve.terminate();
await globalThis.curve_bls12381?.terminate();
process.exit(0);
