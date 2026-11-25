/**
 * M4 command line client on the shared protocol module (packages/protocol).
 * Reads the pool and both trees from the chain; keeps only the user's note
 * (secret + deposit reference) locally, as the web app does in the browser.
 *
 *   node run.mjs deposit   --note <name> [--asset <i>] signer: account A; collateral asset i (default 0)
 *   node run.mjs borrow    --note <name> --to <addr>   signer: relayer; loan to <addr>
 *   node run.mjs repay     --note <name>               signer: account B
 *   node run.mjs unlock    --note <name>               signer: relayer
 *   node run.mjs lend      --note <name>               signer: lender (account A); buys one share
 *   node run.mjs withdraw  --note <name> --to <addr>   signer: relayer; one share to <addr>
 *   node run.mjs status   [--note <name>]
 *   node run.mjs deploy    [--loan ada|<unit>] [--collateral ada:20,<unit>:500]
 *                          [--loan-denomination <n>] [--reserve <n>]
 *                          [--vkeys-from <deployment.json> | --vkeys-tx <park tx hash>]
 *                                                       signer: deployer; parks the five keys, new pool,
 *                                                       its scripts published as reference scripts
 *   node run.mjs mint-token --name <ascii> --amount <n> signer: deployer; a test token (one-signature policy)
 *   node run.mjs send      --to <addr> --unit <lovelace|unit> --amount <n>   test funding
 *   node run.mjs address                              the signer's address
 *
 * The pool is the one in DEPLOYMENT (default packages/protocol/deployments/preprod-m3-ada.json);
 * deploy writes that file. Amounts are in the asset's base unit (lovelace for ADA),
 * except `ada:<n>` in --collateral, which is in ADA.
 *
 * Signer: WALLET_SEED names the seed variable in the repo .env (default
 * ADMIN_WALLET_SEED), WALLET_ACCOUNT its account index. Deposit pays the
 * collateral back to UNLOCK_TO_ADDRESS if set, else to the signer.
 * Notes live in ./notes/ (gitignored): whoever holds a note can unlock its deposit.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BlockfrostProvider, MeshWallet, MeshTxBuilder, ForgeScript, resolveScriptHash, serializeData } from "@meshsdk/core";
import * as snarkjs from "snarkjs";
import * as ff from "ffjavascript";
import {
  computeCommitment, computeNullifier, computeRepayNullifier, compressProof,
  borrowInput, repayInput, settlementInput, appendInput, lenderWithdrawInput, merkleRoot,
  computeLenderCommitment, computeLenderNullifier, LOAN_DENOMINATION,
  EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER, LENDER_EXTERNAL_NULLIFIER, POOL_NFT_NAME_HEX,
} from "@zk-defi/protocol/crypto";
import { paymentKeyHash, poolDatum, vkeyDatum, R_Mint } from "@zk-defi/protocol/plutus";
import { buildSets, EMPTY_ROOT } from "@zk-defi/protocol/mpf";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { fetchPool, fetchLeaves, verifyPool } from "@zk-defi/protocol/chain";
import {
  buildDeposit, buildBorrow, buildRepay, buildUnlock, buildAddLiquidity, buildWithdrawLiquidity, repayAmount,
  sharePriceUp, sharePriceDown, withdrawableShares, poolBalance, initialPoolValue, isAda, ADA,
  buildCollateralSplit, hasCollateral,
} from "@zk-defi/protocol/tx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const NOTES = path.join(HERE, "notes");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const DEPLOYMENT_PATH = process.env.DEPLOYMENT
  || path.join(ROOT, "packages/protocol/deployments/preprod-m3-ada.json");
const BLUEPRINT = read(path.join(ROOT, "contracts/plutus.json"));
// The deployment exists once `deploy` has run; every other step needs it.
const DEPLOYMENT = fs.existsSync(DEPLOYMENT_PATH) ? read(DEPLOYMENT_PATH) : null;
const S = DEPLOYMENT && deriveScripts(BLUEPRINT, DEPLOYMENT.seed, DEPLOYMENT.vkeys);

// ── env, chain, wallet ───────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const KEY = env.PREPROD_BLOCKFROST_API_KEY;
const provider = new BlockfrostProvider(KEY);
const bf = async (p) => {
  const r = await fetch("https://cardano-preprod.blockfrost.io/api/v0" + p, { headers: { project_id: KEY } });
  if (!r.ok) throw new Error(`Blockfrost ${r.status} ${p}`);
  return r.json();
};
async function signer() {
  const seedVar = process.env.WALLET_SEED || "ADMIN_WALLET_SEED";
  if (!env[seedVar]) throw new Error(`Missing seed variable ${seedVar} in .env`);
  const wallet = new MeshWallet({
    networkId: 0, fetcher: provider, submitter: provider,
    accountIndex: Number(process.env.WALLET_ACCOUNT || 0),
    key: { type: "mnemonic", words: env[seedVar].split(/\s+/) },
  });
  await wallet.init();
  const address = await wallet.getChangeAddress();
  let utxos = await provider.fetchAddressUTxOs(address);
  // Script transactions need a pure-ADA UTxO as collateral; a wallet whose
  // outputs all carry tokens first pays itself one.
  if (utxos.length && !hasCollateral(utxos)) {
    console.log("creating a pure-ADA UTxO for script collateral");
    await submit(wallet, await buildCollateralSplit(new MeshTxBuilder({ fetcher: provider }), { payer: { address, utxos } }));
    utxos = await provider.fetchAddressUTxOs(address);
  }
  return { wallet, payer: { address, utxos } };
}
// The verification keys in circuits/keys as the datums they are parked with.
async function localVkeyDatums() {
  const curve = await ff.getCurveFromName("bls12381");
  try {
    const cbor = (name) => serializeData(vkeyDatum(curve, read(path.join(ROOT, `circuits/keys/verification_key_${name}.json`))), "JSON");
    return { borrow: cbor("semaphore"), settlement: cbor("settlement"), append: cbor("append"), repay: cbor("repay"), lender: cbor("lender_withdraw") };
  } finally {
    await curve.terminate();
  }
}
// The live pool, the leaves of its trees and its nullifier sets, after checking
// that the pool was initialised honestly and its datum matches its history.
async function state() {
  const pool = await fetchPool(provider, S);
  const leaves = await fetchLeaves(bf, S);
  const sets = await buildSets(leaves.events);
  await verifyPool(bf, S, DEPLOYMENT, { pool, leaves, sets, expectedVkeys: await localVkeyDatums(), emptyRoot: EMPTY_ROOT });
  return { pool, leaves, sets };
}
async function submit(wallet, unsigned) {
  const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));
  console.log("submitted", txHash, `https://preprod.cardanoscan.io/transaction/${txHash}`);
  // wait until the outputs are indexed, then let Blockfrost's evaluator catch up
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      if ((await provider.fetchTxInfo(txHash))?.block && (await provider.fetchUTxOs(txHash)).length) {
        console.log("confirmed; settling 30s");
        await new Promise((r) => setTimeout(r, 30_000));
        return txHash;
      }
    } catch { /* not indexed yet */ }
  }
  throw new Error(`timed out waiting for ${txHash}`);
}

// ── proving (Node; the web app proves in a Web Worker) ──────────────────────
const CIRCUIT = {
  append: ["append_proof", "append_proof_final", "verification_key_append"],
  borrow: ["collateral_semaphore", "collateral_semaphore_final", "verification_key_semaphore"],
  repay: ["repay_proof", "repay_proof_final", "verification_key_repay"],
  settlement: ["settlement_proof", "settlement_proof_final", "verification_key_settlement"],
  lender: ["lender_withdraw", "lender_withdraw_final", "verification_key_lender_withdraw"],
};
async function prove(kind, input) {
  const [c, zkey, vkey] = CIRCUIT[kind];
  const t = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, path.join(ROOT, `circuits/${c}_js/${c}.wasm`), path.join(ROOT, `circuits/keys/${zkey}.zkey`));
  if (!(await snarkjs.groth16.verify(read(path.join(ROOT, `circuits/keys/${vkey}.json`)), publicSignals, proof))) {
    throw new Error(`${kind} proof failed local verification`);
  }
  const curve = await ff.getCurveFromName("bls12381");
  try {
    console.log(`${kind} proof ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    return compressProof(curve, proof);
  } finally {
    await curve.terminate();
  }
}

// ── notes ────────────────────────────────────────────────────────────────────
const notePath = (name) => path.join(NOTES, `${name}.json`);
function loadNote(name) {
  const n = read(notePath(name));
  return { ...n, secret: BigInt(n.secret), commitment: BigInt(n.commitment) };
}
const ada = (lovelaceAmount) => (Number(lovelaceAmount) / 1e6).toFixed(6).replace(/\.?0+$/, "");
// An amount of an asset for display: ADA in ADA, a token in base units with its name.
function fmt(amount, asset) {
  if (isAda(asset)) return `${ada(amount)} ADA`;
  return `${amount} ${Buffer.from(asset.asset_name, "hex").toString("utf8") || asset.policy_id.slice(0, 8)}`;
}
const randomSecret = () => BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"));
function saveNote(name, note) {
  fs.mkdirSync(NOTES, { recursive: true });
  if (fs.existsSync(notePath(name))) throw new Error(`note ${name} exists`);
  fs.writeFileSync(notePath(name), JSON.stringify(note, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
function leafIndex(leaves, leaf, what) {
  const i = leaves.findIndex((x) => x === leaf);
  if (i < 0) throw new Error(`${what} not found on-chain`);
  return i;
}

// ── steps ────────────────────────────────────────────────────────────────────
const step = {
  async deposit({ note, asset = "0" }) {
    const { wallet, payer } = await signer();
    const { pool, leaves } = await state();
    const assetIndex = BigInt(asset);
    const collateral = pool.datum.collateral_assets[Number(assetIndex)];
    if (!collateral) throw new Error(`the pool accepts collateral assets 0..${pool.datum.collateral_assets.length - 1}`);
    console.log(`depositing ${fmt(collateral.denomination, collateral)}`);
    const secret = randomSecret();
    const commitment = computeCommitment(secret);
    const a = appendInput({ leavesBefore: leaves.commitments, leaf: commitment });
    const appendProof = await prove("append", a.input);
    const unlockTo = process.env.UNLOCK_TO_ADDRESS || payer.address;
    if (!process.env.UNLOCK_TO_ADDRESS) {
      console.log("note: the collateral returns to the depositing wallet; set UNLOCK_TO_ADDRESS to a fresh address to keep the unlock apart from it");
    }
    const unsigned = await buildDeposit(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, commitment, assetIndex, appendProof, newGroupRoot: a.newRoot, unlockTo, payer,
    });
    const txHash = await submit(wallet, unsigned);
    // outputs: 0 = pool, 1 = collateral
    saveNote(note, { secret, commitment, assetIndex, deposit: { txHash, outputIndex: 1 }, unlockTo });
    console.log(`note saved: ${notePath(note)}`);
  },

  async borrow({ note, to }) {
    if (!to) throw new Error("--to <address> (the loan recipient, account B)");
    const n = loadNote(note);
    const { wallet, payer } = await signer();
    const { pool, leaves, sets } = await state();
    const recipientPkh = paymentKeyHash(to);
    const b = borrowInput({
      commitments: leaves.commitments, index: leafIndex(leaves.commitments, n.commitment, "deposit commitment"),
      secret: n.secret, recipientPkh,
    });
    const loans = await sets.borrow(b.nullifier); // refuses a nullifier that already borrowed
    const proof = await prove("borrow", b.input);
    const unsigned = await buildBorrow(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, proof, nullifier: b.nullifier, recipient: to, recipientPkh,
      loansProof: loans.proof, newLoansRoot: loans.newRoot, payer,
    });
    await submit(wallet, unsigned);
  },

  async repay({ note }) {
    const n = loadNote(note);
    const { wallet, payer } = await signer();
    const { pool, leaves, sets } = await state();
    const r = repayInput({
      commitments: leaves.commitments, index: leafIndex(leaves.commitments, n.commitment, "deposit commitment"),
      secret: n.secret,
    });
    const loans = await sets.repay(r.nullifier); // refuses when no loan is open for this note
    const a = appendInput({ leavesBefore: leaves.repaid, leaf: r.R });
    const proof = await prove("repay", r.input);
    const appendProof = await prove("append", a.input);
    console.log(`repaying ${fmt(repayAmount(pool.datum), pool.datum.loan_asset)}`);
    const unsigned = await buildRepay(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, proof, nullifier: r.nullifier, R: r.R, appendProof, newRepaidRoot: a.newRoot,
      loansProof: loans.proof, newLoansRoot: loans.newRoot, payer,
    });
    await submit(wallet, unsigned);
  },

  async unlock({ note }) {
    const n = loadNote(note);
    const { wallet, payer } = await signer();
    const { pool, leaves } = await state();
    const R = computeRepayNullifier(n.secret);
    const s = settlementInput({
      commitment: n.commitment, secret: n.secret, repaid: leaves.repaid, index: leafIndex(leaves.repaid, R, "repayment"),
    });
    const deposit = (await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS)).find(
      (u) => u.input.txHash === n.deposit.txHash && u.input.outputIndex === n.deposit.outputIndex);
    if (!deposit) throw new Error("deposit UTxO not found (already unlocked?)");
    const proof = await prove("settlement", s.input);
    const unsigned = await buildUnlock(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, deposit, unlockTo: n.unlockTo, proof, payer,
    });
    await submit(wallet, unsigned);
  },

  // Buy one pool share: the lender note's leaf goes into lender_root.
  async lend({ note }) {
    const { wallet, payer } = await signer();
    const { pool, leaves } = await state();
    const secret = randomSecret();
    const commitment = computeLenderCommitment(secret);
    const a = appendInput({ leavesBefore: leaves.lenders, leaf: commitment });
    const appendProof = await prove("append", a.input);
    console.log(`buying one share for ${fmt(sharePriceUp(pool.datum, poolBalance(pool)), pool.datum.loan_asset)}`);
    const unsigned = await buildAddLiquidity(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, commitment, appendProof, newLenderRoot: a.newRoot, payer,
    });
    const txHash = await submit(wallet, unsigned);
    saveNote(note, { kind: "lender", secret, commitment, added: txHash });
    console.log(`note saved: ${notePath(note)}`);
  },

  // Withdraw one share to <addr> (account B); the relayer signs and pays the fee.
  async withdraw({ note, to }) {
    if (!to) throw new Error("--to <address> (the payout account B)");
    const n = loadNote(note);
    const { wallet, payer } = await signer();
    const { pool, leaves, sets } = await state();
    const recipientPkh = paymentKeyHash(to);
    const w = lenderWithdrawInput({
      notes: leaves.lenders, index: leafIndex(leaves.lenders, n.commitment, "lender note"), secret: n.secret, recipientPkh,
    });
    const withdrawn = await sets.withdraw(w.nullifier); // refuses a share already withdrawn
    const proof = await prove("lender", w.input);
    console.log(`withdrawing one share for ${fmt(sharePriceDown(pool.datum, poolBalance(pool)), pool.datum.loan_asset)}`);
    const unsigned = await buildWithdrawLiquidity(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), {
      S, deployment: DEPLOYMENT, pool, proof, nullifier: w.nullifier, recipient: to, recipientPkh,
      withdrawnProof: withdrawn.proof, newWithdrawnRoot: withdrawn.newRoot, payer,
    });
    await submit(wallet, unsigned);
  },

  async status({ note }) {
    const { pool, leaves, sets } = await state();
    const d = pool.datum, bal = poolBalance(pool), L = d.loan_asset;
    console.log(`pool ${fmt(bal, L)} (reserve ${fmt(d.liquidity_reserve, L)}), ${fmt(d.total_borrowed, L)} borrowed`
      + ` | collateral ${leaves.commitments.length} | open loans ${sets.openLoans.length} | repaid ${leaves.repaid.length}`
      + ` | shares ${d.total_shares}, buy ${fmt(sharePriceUp(d, bal), L)}, payout ${fmt(sharePriceDown(d, bal), L)},`
      + ` withdrawable now ${withdrawableShares(d, bal)}`);
    console.log(`accepted collateral: ${d.collateral_assets.map((c, i) => `[${i}] ${fmt(c.denomination, c)}`).join(", ")}`
      + ` | loan ${fmt(d.loan_denomination, L)}, interest ${Number(d.interest_rate) / 100} %`);
    if (!note) return;
    const n = loadNote(note);
    if (n.kind === "lender") {
      const added = leaves.lenders.includes(n.commitment);
      const out = sets.withdrawnNotes.includes(computeLenderNullifier(n.secret));
      console.log(`note ${note}: ${out ? "Withdrawn" : added ? "Share held" : "unknown"}`);
      return;
    }
    const N = computeNullifier(n.secret), R = computeRepayNullifier(n.secret);
    const deposited = leaves.commitments.includes(n.commitment);
    const borrowed = sets.usedLoans.includes(N);
    const repaid = leaves.repaid.includes(R);
    const unlocked = repaid && !(await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS))
      .some((u) => u.input.txHash === n.deposit.txHash && u.input.outputIndex === n.deposit.outputIndex);
    console.log(`note ${note}: ${unlocked ? "Unlocked" : repaid ? "Repaid" : borrowed ? "Borrowed" : deposited ? "Deposited" : "unknown"}`);
  },
};

// ── deploy: park the five verification keys, then a new pool ──────────────
// The keys go to the unspendable (always-false) address the earlier
// deployments use. --vkeys-from reuses the keys of another deployment.
const PARK_ADDRESS = read(path.join(ROOT, "packages/protocol/deployments/preprod-m4.json")).vkeyParkAddress;
const VKEY_FILES = ["semaphore", "settlement", "append", "repay", "lender_withdraw"]; // output order 0..4

// "ada" or a Mesh unit (policy id + asset name hex) -> { policy_id, asset_name }
function parseAsset(spec) {
  if (spec === "ada") return ADA;
  if (!/^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(spec)) throw new Error(`bad asset ${spec}`);
  return { policy_id: spec.slice(0, 56), asset_name: spec.slice(56) };
}
// "ada:20,<unit>:500" -> accepted collateral assets (ada in ADA, tokens in base units)
function parseCollateral(spec) {
  return spec.split(",").map((part) => {
    const [a, n] = part.split(":");
    const asset = parseAsset(a);
    const denomination = isAda(asset) ? BigInt(Math.round(Number(n) * 1e6)) : BigInt(n);
    return { ...asset, denomination };
  });
}

async function parkVkeys(wallet, payer) {
  const curve = await ff.getCurveFromName("bls12381");
  let txb = new MeshTxBuilder({ fetcher: provider, evaluator: provider }).setNetwork("preprod");
  try {
    for (const name of VKEY_FILES) {
      txb = txb.txOut(PARK_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
        .txOutInlineDatumValue(vkeyDatum(curve, read(path.join(ROOT, `circuits/keys/verification_key_${name}.json`))), "JSON");
    }
  } finally {
    await curve.terminate();
  }
  const parkTx = await submit(wallet, await txb.changeAddress(payer.address).selectUtxosFrom(payer.utxos).complete());
  return parkedVkeys(parkTx);
}
// The vkey references of a park transaction (outputs in VKEY_FILES order).
const parkedVkeys = (parkTx) =>
  ({ txHash: parkTx, borrowIdx: 0, settlementIdx: 1, appendIdx: 2, repayIdx: 3, lender: { txHash: parkTx, index: 4 } });

// Two pure-ADA UTxOs (>= 5 ADA): the seed of the one-shot NFT and the script
// collateral. Creates them with a payment to oneself when the wallet lacks them.
async function seedAndCollateral(wallet, payer) {
  const pureOf = (utxos) => utxos.filter((u) => u.output.amount.length === 1 && BigInt(u.output.amount[0].quantity) >= 5_000_000n);
  let utxos = await provider.fetchAddressUTxOs(payer.address);
  if (pureOf(utxos).length < 2) {
    const split = await new MeshTxBuilder({ fetcher: provider })
      .setNetwork("preprod")
      .txOut(payer.address, [{ unit: "lovelace", quantity: "10000000" }])
      .txOut(payer.address, [{ unit: "lovelace", quantity: "10000000" }])
      .changeAddress(payer.address)
      .selectUtxosFrom(utxos)
      .complete();
    await submit(wallet, split);
    utxos = await provider.fetchAddressUTxOs(payer.address);
  }
  const [seedUtxo, collUtxo] = pureOf(utxos);
  return { utxos, seedUtxo, collUtxo };
}

step.deploy = async ({
  loan = "ada", collateral = "ada:20", "loan-denomination": loanDenomination = String(LOAN_DENOMINATION),
  reserve, "vkeys-from": vkeysFrom, "vkeys-tx": vkeysTx,
}) => {
  if (DEPLOYMENT) throw new Error(`${DEPLOYMENT_PATH} exists; set DEPLOYMENT to a new path`);
  const loanAsset = parseAsset(loan);
  const collateralAssets = parseCollateral(collateral);
  const loanDenom = BigInt(loanDenomination);
  // An ADA pool keeps 10 ADA as reserve (its min UTxO); a token pool's ADA is not
  // the loan asset and never moves, so its reserve is 0.
  const reserveAmount = BigInt(reserve ?? (isAda(loanAsset) ? "10000000" : "0"));
  const { wallet, payer } = await signer();
  const vkeys = vkeysFrom ? read(path.resolve(vkeysFrom)).vkeys
    : vkeysTx ? parkedVkeys(vkeysTx)
      : await parkVkeys(wallet, payer);
  console.log(`verification keys: ${vkeys.txHash}`);

  const { utxos, seedUtxo, collUtxo } = await seedAndCollateral(wallet, payer);
  const seed = { txHash: seedUtxo.input.txHash, outputIndex: seedUtxo.input.outputIndex };
  const scripts = deriveScripts(BLUEPRINT, seed, vkeys);
  const empty = merkleRoot([]);
  const state0 = {
    total_deposited: 0n, total_borrowed: 0n, interest_rate: 500n,
    group_root: empty, group_next_index: 0n, repaid_root: empty, next_index: 0n,
    external_nullifier: EXTERNAL_NULLIFIER, repay_external_nullifier: REPAY_EXTERNAL_NULLIFIER,
    loan_asset: loanAsset, collateral_assets: collateralAssets, loan_denomination: loanDenom,
    loans: EMPTY_ROOT, last_updated: BigInt(Date.now()),
    lender_root: empty, lender_next_index: 0n, total_shares: 0n, withdrawn: EMPTY_ROOT,
    lender_external_nullifier: LENDER_EXTERNAL_NULLIFIER, share_start_price: loanDenom,
    liquidity_reserve: reserveAmount,
  };
  const same = (u, v) => u.input.txHash === v.input.txHash && u.input.outputIndex === v.input.outputIndex;
  const init = await new MeshTxBuilder({ fetcher: provider, evaluator: provider })
    .setNetwork("preprod")
    .txIn(seedUtxo.input.txHash, seedUtxo.input.outputIndex, seedUtxo.output.amount, payer.address)
    .mintPlutusScriptV3()
    .mint("1", scripts.POLICY_ID, POOL_NFT_NAME_HEX)
    .mintingScript(scripts.NFT_CBOR)
    .mintRedeemerValue(R_Mint, "JSON")
    .txOut(scripts.POOL_ADDRESS, initialPoolValue(scripts, loanAsset, reserveAmount))
    .txOutInlineDatumValue(poolDatum(state0), "JSON")
    .txInCollateral(collUtxo.input.txHash, collUtxo.input.outputIndex, collUtxo.output.amount, payer.address)
    .changeAddress(payer.address)
    .selectUtxosFrom(utxos.filter((u) => !same(u, seedUtxo) && !same(u, collUtxo)))
    .complete();
  const initTx = await submit(wallet, init);

  // Publish the pool and collateral scripts as reference scripts on the
  // unspendable address, so transactions reference them instead of carrying them.
  const refLovelace = (cbor) => String(Math.ceil((cbor.length / 2 + 300) * 4310));
  const refTx = await submit(wallet, await new MeshTxBuilder({ fetcher: provider })
    .setNetwork("preprod")
    .txOut(PARK_ADDRESS, [{ unit: "lovelace", quantity: refLovelace(scripts.POOL_CBOR) }])
    .txOutReferenceScript(scripts.POOL_CBOR, "V3")
    .txOut(PARK_ADDRESS, [{ unit: "lovelace", quantity: refLovelace(scripts.COLLATERAL_CBOR) }])
    .txOutReferenceScript(scripts.COLLATERAL_CBOR, "V3")
    .changeAddress(payer.address)
    .selectUtxosFrom(await provider.fetchAddressUTxOs(payer.address))
    .complete());
  const refScripts = { pool: { txHash: refTx, index: 0 }, collateral: { txHash: refTx, index: 1 } };

  const deployment = {
    network: "preprod",
    description: `Pool lending ${loan}, collateral ${collateral}. Created by offchain/cli/m4/run.mjs deploy on ${new Date().toISOString().slice(0, 10)}.`,
    seed, vkeys, vkeyParkAddress: PARK_ADDRESS, initTx, refScripts,
    loanAsset, collateralAssets: collateralAssets.map((c) => ({ ...c, denomination: String(c.denomination) })),
    policyId: scripts.POLICY_ID, poolHash: scripts.POOL_HASH, poolAddress: scripts.POOL_ADDRESS,
    collateralHash: scripts.COLLATERAL_HASH, collateralAddress: scripts.COLLATERAL_ADDRESS,
  };
  fs.writeFileSync(DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`deployment written: ${DEPLOYMENT_PATH}`);
};

// ── address: the signer's address (WALLET_SEED / WALLET_ACCOUNT) ────────────
step.address = async () => {
  const { payer } = await signer();
  console.log(payer.address);
};

// ── send: pay a token (with min ADA) or ADA to an address, e.g. test funding ─
step.send = async ({ to, unit, amount }) => {
  if (!to || !unit || !amount) throw new Error("--to <addr> --unit <lovelace|unit> --amount <n>");
  const { wallet, payer } = await signer();
  const value = unit === "lovelace" ? [{ unit, quantity: String(amount) }]
    : [{ unit: "lovelace", quantity: "2000000" }, { unit, quantity: String(amount) }];
  const unsigned = await new MeshTxBuilder({ fetcher: provider })
    .setNetwork("preprod").txOut(to, value).changeAddress(payer.address).selectUtxosFrom(payer.utxos).complete();
  await submit(wallet, unsigned);
};

// ── mint-token: a test token under a one-signature policy of the signer ─────
step["mint-token"] = async ({ name, amount }) => {
  if (!name || !amount) throw new Error("--name <ascii> --amount <n>");
  const { wallet, payer } = await signer();
  const forgingScript = ForgeScript.withOneSignature(payer.address);
  const policyId = resolveScriptHash(forgingScript);
  const nameHex = Buffer.from(name, "utf8").toString("hex");
  const unsigned = await new MeshTxBuilder({ fetcher: provider })
    .setNetwork("preprod")
    .mint(String(amount), policyId, nameHex)
    .mintingScript(forgingScript)
    .txOut(payer.address, [{ unit: "lovelace", quantity: "2000000" }, { unit: policyId + nameHex, quantity: String(amount) }])
    .changeAddress(payer.address)
    .selectUtxosFrom(payer.utxos)
    .complete();
  await submit(wallet, unsigned);
  console.log(`minted ${amount} ${name}: unit ${policyId + nameHex}`);
};

// ── main ─────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, "")] = rest[i + 1];
if (!step[cmd]) {
  console.error("usage: node run.mjs <deposit|borrow|repay|unlock|lend|withdraw|status|deploy|mint-token> [--note name] [--to addr] [--asset i] (see the header for deploy and mint-token)");
  process.exit(1);
}
if (!["deploy", "mint-token", "send", "address"].includes(cmd) && !DEPLOYMENT) throw new Error(`no deployment at ${DEPLOYMENT_PATH}; run deploy first`);
await step[cmd](args);
process.exit(0);
