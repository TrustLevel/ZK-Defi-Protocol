/**
 * Step 1 — Park the SnarkVerificationKey as an inline datum on an unspendable UTxO.
 *
 * The v5 validators read this VKey UTxO as a read-only reference input (never
 * spent) via the OutputReference stored in the pool datum / passed in the
 * collateral UnlockDeposit redeemer. We park it at the always-false script
 * address so it can never be consumed.
 *
 * Output: writes receipts/vkey.json with { txHash, outputIndex } for later steps.
 */
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  buildVkeyDatum, ALWAYS_FALSE_ADDRESS, saveReceipt, scanLink,
} from "./common.mjs";

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const utxos = await wallet.getUtxos();
console.log("admin:", addr, "| utxos:", utxos.length);

const vkeyDatum = await buildVkeyDatum();

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(ALWAYS_FALSE_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }])
  .txOutInlineDatumValue(vkeyDatum, "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = { txHash, outputIndex: 0, address: ALWAYS_FALSE_ADDRESS, ada: 5 };
const file = saveReceipt("vkey.json", receipt);
console.log("VKey parked. txHash:", txHash);
console.log("outputIndex: 0");
console.log("receipt:", file);
console.log(scanLink(txHash));
process.exit(0);
