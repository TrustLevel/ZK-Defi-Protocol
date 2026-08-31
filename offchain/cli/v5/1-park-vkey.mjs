/**
 * Step 1 — Park BOTH verification keys as inline datums on unspendable UTxOs.
 * #0 = borrow/repay membership circuit, #1 = unlock circuit. Read-only refs only.
 * Output: receipts/vkey.json { txHash, borrowIdx, unlockIdx }.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  buildVkeyDatum, BORROW_VKEY, UNLOCK_VKEY, ALWAYS_FALSE_ADDRESS, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await wallet.getUtxos();

const borrowDatum = await buildVkeyDatum(BORROW_VKEY);
const unlockDatum = await buildVkeyDatum(UNLOCK_VKEY);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(borrowDatum, "JSON")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(unlockDatum, "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = { txHash, borrowIdx: 0, unlockIdx: 1, address: ALWAYS_FALSE_ADDRESS };
console.log("Both VKeys parked. txHash:", txHash, "| borrow #0, unlock #1");
console.log("receipt:", saveReceipt("vkey.json", receipt));
console.log(scanLink(txHash));
process.exit(0);
