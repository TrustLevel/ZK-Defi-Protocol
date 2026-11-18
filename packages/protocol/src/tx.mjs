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
  R_AddLiquidity, R_DepositCollateral, R_Borrow, R_Repay, R_Unlock,
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
// Flat-rate interest (bps), as the validator computes it.
export function repayAmount(datum) {
  const principal = datum.loan_denomination;
  return principal + (principal * datum.interest_rate) / 10000n;
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

// AddLiquidity: a lender adds lovelace; only total_deposited grows.
export function buildAddLiquidity(txb, { S, pool, amount, payer, now = Date.now(), network = "preprod" }) {
  const d = pool.datum;
  const cont = { ...d, total_deposited: d.total_deposited + BigInt(amount), last_updated: now };
  spendPool(txb, S, pool, R_AddLiquidity, network)
    .txOut(S.POOL_ADDRESS, poolAmount(S, lovelaceOf(pool.utxo) + BigInt(amount)))
    .txOutInlineDatumValue(poolDatum(cont), "JSON");
  return payWith(txb, payer);
}
