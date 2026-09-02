/**
 * Step 2 — Initialize the lending pool with PoolDatumV5 (v6 private model).
 * group_root + repaid_root start as the empty-tree root; next_index = 0;
 * open_loans = []; admin = wallet pkh; vkey_ref -> borrow vkey (#0),
 * settlement_vkey_ref -> settlement vkey (#1), append_vkey_ref -> append vkey (#2).
 * Also seeds receipts/repaid.json = { repaidNullifiers: [] }.
 */
import { deserializeAddress } from "@meshsdk/core";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, merkleRoot, EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER, LOAN_DENOMINATION,
  POOL_ADDRESS, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const POOL_ADA = 100_000_000;
const COLLATERAL_RATIO = 125;
const INTEREST_RATE = 500; // 5% bps

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const { pubKeyHash } = deserializeAddress(addr);
const utxos = await wallet.getUtxos();

const vkey = loadReceipt("vkey.json");
const groupRoot = merkleRoot([]); // empty anonymity set at init
const repaidRoot = merkleRoot([]); // empty repaid-set at init
const now = Date.now();

const state = {
  total_deposited: POOL_ADA,
  total_borrowed: 0,
  interest_rate: INTEREST_RATE,
  collateral_ratio: COLLATERAL_RATIO,
  vkey_ref_tx: vkey.txHash, vkey_ref_idx: vkey.borrowIdx,
  settlement_vkey_ref_tx: vkey.txHash, settlement_vkey_ref_idx: vkey.settlementIdx,
  append_vkey_ref_tx: vkey.txHash, append_vkey_ref_idx: vkey.appendIdx,
  group_root: groupRoot,
  repaid_root: repaidRoot,
  next_index: 0,
  external_nullifier: EXTERNAL_NULLIFIER,
  repay_external_nullifier: REPAY_EXTERNAL_NULLIFIER,
  loan_denomination: LOAN_DENOMINATION,
  open_loans: [],
  admin: pubKeyHash,
  last_updated: now,
};

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(POOL_ADA) }])
  .txOutInlineDatumValue(poolDatum(state), "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = { txHash, outputIndex: 0, poolBalance: POOL_ADA, ...state };
console.log("Pool initialized. txHash:", txHash, "#0 | group_root:", groupRoot.toString().slice(0, 16) + "...");
console.log("receipt:", saveReceipt("pool.json", receipt));
saveReceipt("commitments.json", { commitments: [] });
saveReceipt("repaid.json", { repaidNullifiers: [] });
console.log(scanLink(txHash));
process.exit(0);
