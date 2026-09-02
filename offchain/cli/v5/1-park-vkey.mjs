/**
 * Step 1 — Park ALL THREE verification keys as inline datums on unspendable UTxOs.
 * #0 = borrow/repay membership circuit, #1 = settlement (unlock) circuit,
 * #2 = append circuit (repay-time R insertion). Read-only refs only.
 * Output: receipts/vkey.json { txHash, borrowIdx, settlementIdx, appendIdx }.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  buildVkeyDatum, BORROW_VKEY, SETTLEMENT_VKEY, APPEND_VKEY, ALWAYS_FALSE_ADDRESS, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await wallet.getUtxos();

const borrowDatum = await buildVkeyDatum(BORROW_VKEY);
const settlementDatum = await buildVkeyDatum(SETTLEMENT_VKEY);
const appendDatum = await buildVkeyDatum(APPEND_VKEY);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(borrowDatum, "JSON")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(settlementDatum, "JSON")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(appendDatum, "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = { txHash, borrowIdx: 0, settlementIdx: 1, appendIdx: 2, address: ALWAYS_FALSE_ADDRESS };
console.log("Three VKeys parked. txHash:", txHash, "| borrow #0, settlement #1, append #2");
console.log("receipt:", saveReceipt("vkey.json", receipt));
console.log(scanLink(txHash));
process.exit(0);
