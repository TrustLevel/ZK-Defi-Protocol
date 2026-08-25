/**
 * Step 2 — Initialize the lending pool with PoolDatumV5.
 *
 * Locks ~100 ADA at the pool validator address with an inline PoolDatumV5 whose
 * vkey_ref points at the parked VKey UTxO (from receipts/vkey.json).
 *
 * Output: receipts/pool.json with { txHash, outputIndex } identifying the pool UTxO.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, POOL_ADDRESS, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const POOL_ADA = 100_000_000;      // 100 ADA liquidity
const COLLATERAL_RATIO = 125;      // protocol LTV public signal
const INTEREST_RATE = 500;         // 5% bps (informational)

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await wallet.getUtxos();

const vkey = loadReceipt("vkey.json");
console.log("pool addr:", POOL_ADDRESS);
console.log("vkey ref:", `${vkey.txHash}#${vkey.outputIndex}`);

const datum = poolDatum({
  total_deposited: POOL_ADA,
  total_borrowed: 0,
  interest_rate: INTEREST_RATE,
  collateral_ratio: COLLATERAL_RATIO,
  vkey_ref_tx: vkey.txHash,
  vkey_ref_idx: vkey.outputIndex,
  last_updated: Date.now(),
});

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(POOL_ADDRESS, [{ unit: "lovelace", quantity: String(POOL_ADA) }])
  .txOutInlineDatumValue(datum, "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = {
  txHash, outputIndex: 0, address: POOL_ADDRESS,
  poolAda: POOL_ADA, collateralRatio: COLLATERAL_RATIO, interestRate: INTEREST_RATE,
  totalBorrowed: 0, vkeyRefTx: vkey.txHash, vkeyRefIdx: vkey.outputIndex,
  lastUpdated: datum.fields[5].int,
};
const file = saveReceipt("pool.json", receipt);
console.log("Pool initialized. txHash:", txHash, "#0");
console.log("receipt:", file);
console.log(scanLink(txHash));
process.exit(0);
