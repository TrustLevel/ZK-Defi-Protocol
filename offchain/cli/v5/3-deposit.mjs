/**
 * Step 3 — Deposit collateral with a Poseidon255 commitment (DepositDatumV5).
 *
 * Generates a random secret, computes commitment = poseidon2([collateral_amount, secret]),
 * and locks ~20 ADA at the collateral validator address with the inline datum.
 * SAVES the secret in receipts/deposit.json — it is required to generate the
 * borrow/repay/unlock proofs later.
 */
import crypto from "crypto";
import { deserializeAddress } from "@meshsdk/core";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  depositDatum, computeCommitment, COLLATERAL_ADDRESS, saveReceipt, scanLink,
} from "./common.mjs";

const COLLATERAL_ADA = 20_000_000; // 20 ADA collateral

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);
const { pubKeyHash } = deserializeAddress(addr);
const utxos = await wallet.getUtxos();

// random secret < BLS12-381 scalar field r (use 128 bits, well below r)
const secret = BigInt("0x" + crypto.randomBytes(16).toString("hex"));
const commitment = computeCommitment(COLLATERAL_ADA, secret);
const timestamp = Date.now();

console.log("collateral addr:", COLLATERAL_ADDRESS);
console.log("owner keyhash:", pubKeyHash);
console.log("commitment:", commitment.toString());

const datum = depositDatum(pubKeyHash, COLLATERAL_ADA, commitment, timestamp);

const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(COLLATERAL_ADDRESS, [{ unit: "lovelace", quantity: String(COLLATERAL_ADA) }])
  .txOutInlineDatumValue(datum, "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();

const signed = await wallet.signTx(unsigned, true);
const txHash = await wallet.submitTx(signed);

const receipt = {
  txHash, outputIndex: 0, address: COLLATERAL_ADDRESS,
  owner: pubKeyHash, collateralAmount: COLLATERAL_ADA,
  secret: secret.toString(), commitment: commitment.toString(), timestamp,
};
const file = saveReceipt("deposit.json", receipt);
console.log("Deposit locked. txHash:", txHash, "#0");
console.log("SECRET SAVED in receipt (needed for borrow/repay):", file);
console.log(scanLink(txHash));
process.exit(0);
