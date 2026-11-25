// Golden tests against the M3 asset-pool cycles on Preprod (fixtures fetched by
// scripts/fetch-cycle.mjs): every transaction was accepted, the protocol module
// re-encodes every pool datum, deposit datum and redeemer to its on-chain hash,
// the scripts derive to the deployed addresses, each pool spend moved only the
// loan asset, by exactly the action's amount, the nullifier sets rebuilt from the
// history match every pool datum, and the pool datum kept its size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolveDataHash } from "@meshsdk/core";
import {
  decodePoolDatum, decodePoolRedeemer, decodeDepositDatum, decodeUnlockRedeemer,
  poolDatum, depositDatum, outputReference, loanTag, addressFromData,
  R_AddLiquidity, R_DepositCollateral, R_Borrow, R_Repay, R_Unlock, R_WithdrawLiquidity,
} from "../src/plutus.mjs";
import { deriveScripts } from "../src/scripts.mjs";
import { quantityOf, unitOf, repayAmount, sharePriceUp, sharePriceDown } from "../src/tx.mjs";
import { buildSets } from "../src/mpf.mjs";

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const blueprint = read("../../../contracts/plutus.json");
const hashOf = (data) => resolveDataHash(data, "JSON");

const CYCLES = [
  { name: "ADA pool", fixture: "./fixtures/m3-ada-cycle.json", deployment: "../deployments/preprod-m3-ada.json" },
  { name: "USD pool", fixture: "./fixtures/m3-usd-cycle.json", deployment: "../deployments/preprod-m3-usd.json" },
].filter((c) => existsSync(new URL(c.fixture, import.meta.url)));

function redeemerOf(R) {
  switch (R.type) {
    case "AddLiquidity": return R_AddLiquidity(R.commitment, R.appendProof);
    case "DepositCollateral": return R_DepositCollateral(R.commitment, R.assetIndex, R.appendProof);
    case "BorrowAnonymous": return R_Borrow(R.proof, R.loanNullifier, R.recipient, R.loansProof);
    case "RepayAnonymous": return R_Repay(R.proof, R.loanNullifier, R.repayNullifier, R.appendProof, R.loansProof);
    case "WithdrawLiquidity": return R_WithdrawLiquidity(R.proof, R.withdrawNullifier, R.recipient, R.withdrawnProof);
    default: throw new Error(R.type);
  }
}

for (const { name, fixture, deployment } of CYCLES) {
  const cycle = read(fixture);
  const D = read(deployment);
  const S = deriveScripts(blueprint, D.seed, D.vkeys);
  const txs = cycle.txs.map((label) => ({ label, ...cycle[label] }));
  const poolIn = (tx) => tx.inputs.find((i) => !i.reference && i.address === S.POOL_ADDRESS);
  const poolOut = (tx) => tx.outputs.find((o) => o.address === S.POOL_ADDRESS);
  const poolSpends = txs.filter(poolIn);
  const unlocks = txs.filter((tx) => tx.label.startsWith("unlock"));

  test(`${name}: every transaction of the cycle was accepted`, () => {
    for (const tx of txs) assert.equal(tx.validContract, true, tx.label);
  });

  test(`${name}: the scripts derive to the deployed policy, hashes and addresses`, () => {
    assert.equal(S.POLICY_ID, D.policyId);
    assert.equal(S.POOL_HASH, D.poolHash);
    assert.equal(S.POOL_ADDRESS, D.poolAddress);
    assert.equal(S.COLLATERAL_HASH, D.collateralHash);
    assert.equal(S.COLLATERAL_ADDRESS, D.collateralAddress);
  });

  test(`${name}: every pool datum re-encodes to its on-chain hash`, () => {
    for (const tx of txs.filter(poolOut)) {
      const o = poolOut(tx);
      assert.equal(hashOf(poolDatum(decodePoolDatum(o.cbor))), o.datumHash, tx.label);
    }
  });

  test(`${name}: every pool redeemer re-encodes to its on-chain hash`, () => {
    for (const tx of poolSpends) {
      const r = tx.redeemers.find((x) => decodeSafe(x.cbor));
      assert.equal(hashOf(redeemerOf(decodePoolRedeemer(r.cbor))), r.hash, tx.label);
    }
  });

  test(`${name}: each pool spend moves only the loan asset, by exactly its amount`, () => {
    for (const tx of poolSpends) {
      const before = decodePoolDatum(priorPoolDatum(tx));
      const L = before.loan_asset;
      const vin = poolIn(tx).amount, vout = poolOut(tx).amount;
      const bal = quantityOf(vin, L);
      const delta = quantityOf(vout, L) - quantityOf(vin, L);
      const R = decodePoolRedeemer(tx.redeemers.find((x) => decodeSafe(x.cbor)).cbor);
      const expected = {
        DepositCollateral: 0n,
        BorrowAnonymous: -before.loan_denomination,
        RepayAnonymous: repayAmount(before),
        AddLiquidity: sharePriceUp(before, bal),
        WithdrawLiquidity: -sharePriceDown(before, bal),
      }[R.type];
      assert.equal(delta, expected, tx.label);
      const others = (v) => v.filter((a) => a.unit !== unitOf(L)).map((a) => `${a.unit}:${a.quantity}`).sort();
      assert.deepEqual(others(vout), others(vin), `${tx.label}: nothing but the loan asset moved`);
    }
  });

  test(`${name}: the nullifier sets rebuilt from the history match every pool datum`, async () => {
    const events = [];
    for (const tx of poolSpends) {
      const R = decodePoolRedeemer(tx.redeemers.find((x) => decodeSafe(x.cbor)).cbor);
      if (R.type === "BorrowAnonymous") events.push({ type: "borrow", nullifier: R.loanNullifier });
      if (R.type === "RepayAnonymous") events.push({ type: "repay", nullifier: R.loanNullifier });
      if (R.type === "WithdrawLiquidity") events.push({ type: "withdraw", nullifier: R.withdrawNullifier });
      const d = decodePoolDatum(poolOut(tx).cbor);
      const sets = await buildSets(events);
      assert.equal(d.loans, sets.loansRoot, tx.label);
      assert.equal(d.withdrawn, sets.withdrawnRoot, tx.label);
    }
  });

  test(`${name}: the pool datum kept its size through the cycle`, () => {
    const sizes = txs.filter(poolOut).map((tx) => poolOut(tx).cbor.length);
    // Integers may gain a few bytes as totals grow; a list entry would add 38 bytes.
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 32, `datum sizes (hex chars) ${sizes}`);
  });

  test(`${name}: pool and collateral scripts are spent by reference`, () => {
    assert.ok(unlocks.length > 0, "the cycle has unlocks");
    for (const tx of [...poolSpends, ...unlocks]) {
      assert.ok(tx.inputs.some((i) => i.reference && i.txHash === D.refScripts.pool.txHash), tx.label);
    }
  });

  test(`${name}: deposits name their collateral asset and lock exactly its denomination`, () => {
    for (const tx of poolSpends) {
      const R = decodePoolRedeemer(tx.redeemers.find((x) => decodeSafe(x.cbor)).cbor);
      if (R.type !== "DepositCollateral") continue;
      const asset = decodePoolDatum(poolOut(tx).cbor).collateral_assets[Number(R.assetIndex)];
      const coll = tx.outputs.find((o) => o.address === S.COLLATERAL_ADDRESS);
      assert.equal(quantityOf(coll.amount, asset), asset.denomination, tx.label);
      const d = decodeDepositDatum(coll.cbor);
      assert.equal(d.commitment, R.commitment);
      assert.equal(hashOf(depositDatum(d.commitment, d.timestamp, addressFromData(d.unlockTo))), coll.datumHash);
    }
  });

  test(`${name}: every unlock returns the full deposit, and its redeemer and tag re-encode`, () => {
    for (const un of unlocks) {
      const r = un.redeemers[0];
      const U = decodeUnlockRedeemer(r.cbor);
      assert.equal(hashOf(R_Unlock(U.proof, U.poolRef.txHash, U.poolRef.index)), r.hash);
      const spent = un.inputs.find((i) => !i.reference && i.address === S.COLLATERAL_ADDRESS);
      const payout = un.outputs.find((o) => o.datumHash === hashOf(outputReference(spent.txHash, spent.outputIndex)));
      for (const a of spent.amount) assert.ok(BigInt(payout.amount.find((b) => b.unit === a.unit)?.quantity ?? 0) >= BigInt(a.quantity), `${un.label} ${a.unit}`);
    }
  });

  test(`${name}: loan and share payouts carry the loan asset and their nullifier tag`, () => {
    for (const tx of poolSpends) {
      const R = decodePoolRedeemer(tx.redeemers.find((x) => decodeSafe(x.cbor)).cbor);
      if (R.type !== "BorrowAnonymous" && R.type !== "WithdrawLiquidity") continue;
      const n = R.type === "BorrowAnonymous" ? R.loanNullifier : R.withdrawNullifier;
      const payout = tx.outputs.find((o) => o.datumHash === hashOf(loanTag(n)));
      assert.ok(payout, tx.label);
      assert.ok(quantityOf(payout.amount, decodePoolDatum(poolOut(tx).cbor).loan_asset) > 0n, tx.label);
    }
  });

  // The pool datum this spend consumed: the pool output of the previous pool transaction.
  function priorPoolDatum(tx) {
    const i = txs.indexOf(tx);
    for (let j = i - 1; j >= 0; j--) if (poolOut(txs[j])) return poolOut(txs[j]).cbor;
    throw new Error(`no pool datum before ${tx.label}`);
  }
}

function decodeSafe(cbor) {
  try {
    decodePoolRedeemer(cbor);
    return true;
  } catch {
    return false;
  }
}
