/**
 * Transaction builders for every protocol step. Each takes a MeshTxBuilder, the
 * deployment's scripts (scripts.deriveScripts), the live pool as
 * { utxo, datum } with the datum decoded from the chain (plutus.decodePoolDatum),
 * the proofs already generated, and the paying wallet as
 * { address, utxos, collateral } — the user's wallet for deposit and repay, the
 * relayer for borrow and unlock. Each returns the unsigned transaction (hex).
 *
 * The continuing pool datum is derived from the on-chain datum exactly as the
 * validator checks it (contracts/validators/v5/lending_pool_v5.ak).
 */
import {
  poolDatum, depositDatum, loanTag, outputReference,
  R_AddLiquidity, R_DepositCollateral, R_Borrow, R_Repay, R_Unlock, R_WithdrawLiquidity,
} from "./plutus.mjs";

const lovelaceOf = (utxo) => BigInt(utxo.output.amount.find((a) => a.unit === "lovelace").quantity);

// Value of the continuing pool output: lovelace + the pool NFT.
export function poolAmount(S, lovelace) {
  return [{ unit: "lovelace", quantity: String(lovelace) }, { unit: S.POOL_NFT_UNIT, quantity: "1" }];
}
// A pure-ADA UTxO (>= 5 ADA) to post as script collateral.
export function pickCollateral(utxos, minLovelace = 5_000_000n) {
  const c = utxos.find((u) => u.output.amount.length === 1 && lovelaceOf(u) >= minLovelace);
  if (!c) throw new Error("no pure-ADA UTxO >= 5 ADA for script collateral");
  return c;
}
// A payment to oneself that creates a pure-ADA UTxO for script collateral, for a
// wallet whose outputs all carry tokens. Needs no script and no collateral.
export function buildCollateralSplit(txb, { payer, lovelace = 5_000_000n, network = "preprod" }) {
  return txb
    .setNetwork(network)
    .txOut(payer.address, [{ unit: "lovelace", quantity: String(lovelace) }])
    .changeAddress(payer.address)
    .selectUtxosFrom(payer.utxos)
    .complete();
}
export function hasCollateral(utxos) {
  try {
    pickCollateral(utxos);
    return true;
  } catch {
    return false;
  }
}

// Flat-rate interest (bps), as the validator computes it.
export function repayAmount(datum) {
  const principal = datum.loan_denomination;
  return principal + (principal * datum.interest_rate) / 10000n;
}

// Free liquidity, share value and share prices, as the validator computes them
// from the pool datum and the pool UTxO's lovelace.
export function freeLiquidity(datum, poolLovelace) {
  return BigInt(poolLovelace) - datum.liquidity_reserve;
}
export function shareValue(datum, poolLovelace) {
  return freeLiquidity(datum, poolLovelace) + datum.total_borrowed;
}
// Price of buying one share, rounded up; the start price while no share is out.
export function sharePriceUp(datum, poolLovelace) {
  if (datum.total_shares === 0n) return datum.share_start_price;
  return (shareValue(datum, poolLovelace) + datum.total_shares - 1n) / datum.total_shares;
}
// Payout for one share, rounded down.
export function sharePriceDown(datum, poolLovelace) {
  if (datum.total_shares <= 0n) return 0n;
  return shareValue(datum, poolLovelace) / datum.total_shares;
}
// Shares that can be withdrawn one after another from the free liquidity now
// (each withdrawal pays the same price; rounding only grows the remainder).
export function withdrawableShares(datum, poolLovelace) {
  const price = sharePriceDown(datum, poolLovelace);
  if (price === 0n) return 0n;
  const byLiquidity = freeLiquidity(datum, poolLovelace) / price;
  return byLiquidity < datum.total_shares ? byLiquidity : datum.total_shares;
}

function spendPool(txb, S, pool, redeemer, network) {
  const { input, output } = pool.utxo;
  return txb
    .setNetwork(network)
    .spendingPlutusScriptV3()
    .txIn(input.txHash, input.outputIndex, output.amount, S.POOL_ADDRESS)
    .txInScript(S.POOL_CBOR)
    .txInInlineDatumPresent()
    .txInRedeemerValue(redeemer, "JSON");
}
function payWith(txb, payer) {
  const c = payer.collateral || pickCollateral(payer.utxos);
  return txb
    .txInCollateral(c.input.txHash, c.input.outputIndex, c.output.amount, payer.address)
    .changeAddress(payer.address)
    .selectUtxosFrom(payer.utxos)
    .complete();
}

// Deposit: exactly collateral_denomination to the collateral script under the
// commitment; the append proof moves group_root to newGroupRoot.
export function buildDeposit(txb, { S, deployment, pool, commitment, appendProof, newGroupRoot, unlockTo, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const cont = { ...d, group_root: newGroupRoot, group_next_index: d.group_next_index + 1n, last_updated: now };
  spendPool(txb, S, pool, R_DepositCollateral(commitment, appendProof), network)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.appendIdx)
    .txOut(S.POOL_ADDRESS, poolAmount(S, lovelaceOf(pool.utxo)))
    .txOutInlineDatumValue(poolDatum(cont), "JSON")
    .txOut(S.COLLATERAL_ADDRESS, [{ unit: "lovelace", quantity: String(d.collateral_denomination) }])
    .txOutInlineDatumValue(depositDatum(commitment, now, unlockTo), "JSON");
  return payWith(txb, payer);
}

// Borrow: loan_denomination to the recipient key the proof is bound to, tagged
// with the loan nullifier; the nullifier enters open_loans and used_nullifiers.
export function buildBorrow(txb, { S, deployment, pool, proof, nullifier, recipient, recipientPkh, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const loan = d.loan_denomination;
  const cont = {
    ...d, total_borrowed: d.total_borrowed + loan,
    open_loans: [nullifier, ...d.open_loans], used_nullifiers: [nullifier, ...d.used_nullifiers], last_updated: now,
  };
  spendPool(txb, S, pool, R_Borrow(proof, loan, nullifier, recipientPkh), network)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.borrowIdx)
    .txOut(S.POOL_ADDRESS, poolAmount(S, lovelaceOf(pool.utxo) - loan))
    .txOutInlineDatumValue(poolDatum(cont), "JSON")
    .txOut(recipient, [{ unit: "lovelace", quantity: String(loan) }])
    .txOutInlineDatumValue(loanTag(nullifier), "JSON");
  return payWith(txb, payer);
}

// Repay: principal + interest into the pool, the loan leaves open_loans, and
// the append proof inserts R into repaid_root (newRepaidRoot).
export function buildRepay(txb, { S, deployment, pool, proof, nullifier, R, appendProof, newRepaidRoot, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const due = repayAmount(d);
  const cont = {
    ...d, total_borrowed: d.total_borrowed - d.loan_denomination,
    open_loans: d.open_loans.filter((n) => n !== BigInt(nullifier)),
    repaid_root: newRepaidRoot, next_index: d.next_index + 1n, last_updated: now,
  };
  spendPool(txb, S, pool, R_Repay(proof, due, nullifier, R, appendProof), network)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.repayIdx)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.appendIdx)
    .txOut(S.POOL_ADDRESS, poolAmount(S, lovelaceOf(pool.utxo) + due))
    .txOutInlineDatumValue(poolDatum(cont), "JSON");
  return payWith(txb, payer);
}

// Unlock: spend the deposit with the settlement proof against the pool (as a
// reference input); the full collateral goes to the deposit's unlock_to, tagged
// with the spent deposit's reference.
export function buildUnlock(txb, { S, deployment, pool, deposit, unlockTo, proof, payer, network = "preprod" }) {
  const { input, output } = deposit;
  txb
    .setNetwork(network)
    .spendingPlutusScriptV3()
    .txIn(input.txHash, input.outputIndex, output.amount, S.COLLATERAL_ADDRESS)
    .txInScript(S.COLLATERAL_CBOR)
    .txInInlineDatumPresent()
    .txInRedeemerValue(R_Unlock(proof, pool.utxo.input.txHash, pool.utxo.input.outputIndex), "JSON")
    .readOnlyTxInReference(pool.utxo.input.txHash, pool.utxo.input.outputIndex)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.settlementIdx)
    .txOut(unlockTo, [{ unit: "lovelace", quantity: String(lovelaceOf(deposit)) }])
    .txOutInlineDatumValue(outputReference(input.txHash, input.outputIndex), "JSON");
  return payWith(txb, payer);
}

// AddLiquidity: buy one share at the current price (rounded up); the append
// proof inserts the lender note's leaf into lender_root (newLenderRoot).
export function buildAddLiquidity(txb, { S, deployment, pool, commitment, appendProof, newLenderRoot, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const price = sharePriceUp(d, lovelaceOf(pool.utxo));
  const cont = {
    ...d, total_deposited: d.total_deposited + price, total_shares: d.total_shares + 1n,
    lender_root: newLenderRoot, lender_next_index: d.lender_next_index + 1n, last_updated: now,
  };
  spendPool(txb, S, pool, R_AddLiquidity(commitment, appendProof), network)
    .readOnlyTxInReference(deployment.vkeys.txHash, deployment.vkeys.appendIdx)
    .txOut(S.POOL_ADDRESS, poolAmount(S, lovelaceOf(pool.utxo) + price))
    .txOutInlineDatumValue(poolDatum(cont), "JSON");
  return payWith(txb, payer);
}

// WithdrawLiquidity: one share out at the current price (rounded down) to the
// recipient key the proof is bound to, tagged with the withdraw nullifier W,
// which enters lender_nullifiers. Submitted by the relayer.
export function buildWithdrawLiquidity(txb, { S, deployment, pool, proof, nullifier, recipient, recipientPkh, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const bal = lovelaceOf(pool.utxo);
  const price = sharePriceDown(d, bal);
  if (price === 0n || price > freeLiquidity(d, bal)) throw new Error("not enough free liquidity for a share");
  const cont = {
    ...d, total_shares: d.total_shares - 1n,
    lender_nullifiers: [BigInt(nullifier), ...d.lender_nullifiers], last_updated: now,
  };
  spendPool(txb, S, pool, R_WithdrawLiquidity(proof, nullifier, recipientPkh), network)
    .readOnlyTxInReference(deployment.vkeys.lender.txHash, deployment.vkeys.lender.index)
    .txOut(S.POOL_ADDRESS, poolAmount(S, bal - price))
    .txOutInlineDatumValue(poolDatum(cont), "JSON")
    .txOut(recipient, [{ unit: "lovelace", quantity: String(price) }])
    .txOutInlineDatumValue(loanTag(nullifier), "JSON");
  return payWith(txb, payer);
}
