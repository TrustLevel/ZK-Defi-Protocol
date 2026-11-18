/**
 * Step 2 — Initialize the lending pool (v6 private model, hardened).
 *
 * Picks a wallet UTxO as the one-shot SEED, derives the parameter chain
 * pool_nft(seed) -> collateral_v5 -> lending_pool_v5, and in one tx spends the
 * seed, mints the single pool NFT and locks it with the liquidity and the
 * initial PoolDatumV5 at the pool address. Because the seed can be spent only
 * once, no second pool NFT can ever exist.
 *
 * Initial state: empty commitment set (group_root = empty root, index 0),
 * empty repaid set, no open / used loan nullifiers. There is no admin.
 *
 * Writes receipts/deployment.json (seed + vkey refs -> every later step derives
 * the same scripts), pool.json, and empty commitments.json / repaid.json.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  poolDatum, merkleRoot, deriveScripts, R_Mint,
  EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER, LOAN_DENOMINATION, COLLATERAL_DENOMINATION,
  POOL_NFT_NAME_HEX, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const POOL_ADA = 100_000_000;
const COLLATERAL_RATIO = 125;
const INTEREST_RATE = 500; // 5% bps

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await wallet.getUtxos();

// Two distinct pure-ADA UTxOs: one is the NFT seed, one is the script collateral.
const pureAda = utxos.filter((u) => u.output.amount.length === 1 && Number(u.output.amount[0].quantity) >= 5_000_000);
if (pureAda.length < 2) throw new Error("need at least two pure-ADA UTxOs (>= 5 ADA): seed + collateral");
const [seedUtxo, collateralUtxo] = pureAda;
const seed = { txHash: seedUtxo.input.txHash, outputIndex: seedUtxo.input.outputIndex };

const vkeys = loadReceipt("vkey.json");
const S = deriveScripts(seed, vkeys);

const emptyRoot = merkleRoot([]);
const now = Date.now();
const state = {
  total_deposited: POOL_ADA,
  total_borrowed: 0,
  interest_rate: INTEREST_RATE,
  collateral_ratio: COLLATERAL_RATIO,
  group_root: emptyRoot,
  group_next_index: 0,
  repaid_root: emptyRoot,
  next_index: 0,
  external_nullifier: EXTERNAL_NULLIFIER,
  repay_external_nullifier: REPAY_EXTERNAL_NULLIFIER,
  collateral_denomination: COLLATERAL_DENOMINATION,
  loan_denomination: LOAN_DENOMINATION,
  open_loans: [],
  used_nullifiers: [],
  last_updated: now,
};
if (COLLATERAL_DENOMINATION * 100n < LOAN_DENOMINATION * BigInt(COLLATERAL_RATIO)) {
  throw new Error("collateral denomination does not cover the loan at the ratio — Borrow would always fail");
}

// keep the seed and the collateral UTxO out of coin selection
const isSame = (u, v) => u.input.txHash === v.input.txHash && u.input.outputIndex === v.input.outputIndex;
const spendable = utxos.filter((u) => !isSame(u, seedUtxo) && !isSame(u, collateralUtxo));

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txIn(seedUtxo.input.txHash, seedUtxo.input.outputIndex, seedUtxo.output.amount, addr)
  .mintPlutusScriptV3()
  .mint("1", S.POLICY_ID, POOL_NFT_NAME_HEX)
  .mintingScript(S.NFT_CBOR)
  .mintRedeemerValue(R_Mint, "JSON")
  .txOut(S.POOL_ADDRESS, [
    { unit: "lovelace", quantity: String(POOL_ADA) },
    { unit: S.POOL_NFT_UNIT, quantity: "1" },
  ])
  .txOutInlineDatumValue(poolDatum(state), "JSON")
  .txInCollateral(collateralUtxo.input.txHash, collateralUtxo.input.outputIndex, collateralUtxo.output.amount, addr)
  .changeAddress(addr)
  .selectUtxosFrom(spendable)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

saveReceipt("deployment.json", {
  seed, vkeys,
  policyId: S.POLICY_ID, poolNftUnit: S.POOL_NFT_UNIT,
  poolHash: S.POOL_HASH, poolAddress: S.POOL_ADDRESS,
  collateralHash: S.COLLATERAL_HASH, collateralAddress: S.COLLATERAL_ADDRESS,
  initTx: txHash,
});
const receipt = { txHash, outputIndex: 0, poolBalance: POOL_ADA, ...state };
console.log("Pool initialized + NFT minted. txHash:", txHash, "#0");
console.log("  policy:", S.POLICY_ID, "| pool:", S.POOL_HASH, "| collateral:", S.COLLATERAL_HASH);
console.log("receipt:", saveReceipt("pool.json", receipt));
saveReceipt("commitments.json", { commitments: [] });
saveReceipt("repaid.json", { repaidNullifiers: [] });
console.log(scanLink(txHash));
process.exit(0);
