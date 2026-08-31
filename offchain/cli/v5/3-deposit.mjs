/**
 * Step 3 — Deposit collateral (fixed denomination) with DepositDatumV5
 * { commitment, timestamp }. The secret + amount stay off-chain (private
 * witnesses); only the commitment is on-chain and appended to the anonymity set
 * (commitments.json). Publish the new group root separately with 3b-setgrouproot.
 */
import crypto from "crypto";
import {
  loadEnv, makeProvider, makeWallet, walletAddress, makeTxBuilder,
  depositDatum, computeCommitment, COLLATERAL_ADDRESS, loadReceipt, saveReceipt, scanLink,
} from "./common.mjs";

const COLLATERAL_ADA = 20_000_000;

const env = loadEnv();
const provider = makeProvider(env);
const wallet = await makeWallet(env, provider);
const addr = await walletAddress(wallet);

const secret = BigInt("0x" + crypto.randomBytes(16).toString("hex"));
const commitment = computeCommitment(COLLATERAL_ADA, secret);
const timestamp = Date.now();

const commitmentsRec = loadReceipt("commitments.json");
const index = commitmentsRec.commitments.length;
const commitments = [...commitmentsRec.commitments, commitment.toString()];

const utxos = await provider.fetchAddressUTxOs(addr);
const tx = makeTxBuilder(provider);
const unsigned = await tx
  .setNetwork("preprod")
  .txOut(COLLATERAL_ADDRESS, [{ unit: "lovelace", quantity: String(COLLATERAL_ADA) }])
  .txOutInlineDatumValue(depositDatum(commitment, timestamp), "JSON")
  .changeAddress(addr)
  .selectUtxosFrom(utxos)
  .complete();
const txHash = await wallet.submitTx(await wallet.signTx(unsigned, true));

saveReceipt("deposit.json", {
  txHash, outputIndex: 0, address: COLLATERAL_ADDRESS,
  collateralAmount: COLLATERAL_ADA, secret: secret.toString(),
  commitment: commitment.toString(), index, timestamp,
});
saveReceipt("commitments.json", { commitments });
console.log("Deposit locked. txHash:", txHash, "#0 | index", index, "| commitment", commitment.toString().slice(0, 16) + "...");
console.log("next: node cli/v5/wait.mjs", txHash, "&& node cli/v5/3b-setgrouproot.mjs");
console.log(scanLink(txHash));
process.exit(0);
