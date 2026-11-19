// Round trip against the chain: decode each redeemer and datum of the M4
// lender-side Preprod cycle, encode it again with the builders, and require the
// on-chain data hash. A single wrong field, constructor index or integer
// encoding changes the hash. The share prices the module computes must match
// what the pool actually took and paid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDataHash } from "@meshsdk/core";
import {
  decodePoolDatum, decodePoolRedeemer, decodeDepositDatum, decodeUnlockRedeemer,
  poolDatum, depositDatum, outputReference, loanTag, addressFromData,
  R_AddLiquidity, R_DepositCollateral, R_Borrow, R_Repay, R_Unlock, R_WithdrawLiquidity,
} from "../src/plutus.mjs";
import { sharePriceUp, sharePriceDown } from "../src/tx.mjs";

const cycle = JSON.parse(readFileSync(new URL("./fixtures/m4-lend-cycle.json", import.meta.url), "utf8"));
const hashOf = (data) => resolveDataHash(data, "JSON");
const POOL_STEPS = ["lendFirst", "deposit", "borrow", "repay", "lendGrown", "withdraw"];

test("pool datum after every step re-encodes to its on-chain hash", () => {
  for (const step of POOL_STEPS) {
    const { hash, cbor } = cycle[step].datums[0];
    assert.equal(hashOf(poolDatum(decodePoolDatum(cbor))), hash, step);
  }
});

test("the pool datum decodes to the expected state after the withdraw", () => {
  const d = decodePoolDatum(cycle.withdraw.datums[0].cbor);
  assert.equal(d.group_next_index, 1n);
  assert.equal(d.next_index, 1n);
  assert.equal(d.lender_next_index, 3n);
  assert.equal(d.total_shares, 2n);
  assert.equal(d.lender_nullifiers.length, 1);
  assert.equal(d.liquidity_reserve, 10_000_000n);
  assert.deepEqual(d.open_loans, []);
});

test("deposit datum re-encodes to its on-chain hash", () => {
  const { hash, cbor } = cycle.deposit.datums[1];
  const d = decodeDepositDatum(cbor);
  assert.equal(hashOf(depositDatum(d.commitment, d.timestamp, cycle.unlockTo)), hash);
  assert.equal(addressFromData(d.unlockTo), cycle.unlockTo);
});

test("pool redeemers re-encode to their on-chain hashes", () => {
  const add = decodePoolRedeemer(cycle.lendFirst.redeemer.cbor);
  assert.equal(add.type, "AddLiquidity");
  assert.equal(hashOf(R_AddLiquidity(add.commitment, add.appendProof)), cycle.lendFirst.redeemer.hash);

  const dep = decodePoolRedeemer(cycle.deposit.redeemer.cbor);
  assert.equal(dep.type, "DepositCollateral");
  assert.equal(hashOf(R_DepositCollateral(dep.commitment, dep.appendProof)), cycle.deposit.redeemer.hash);

  const bor = decodePoolRedeemer(cycle.borrow.redeemer.cbor);
  assert.equal(bor.type, "BorrowAnonymous");
  assert.equal(hashOf(R_Borrow(bor.proof, bor.loanAmount, bor.loanNullifier, bor.recipient)), cycle.borrow.redeemer.hash);

  const rep = decodePoolRedeemer(cycle.repay.redeemer.cbor);
  assert.equal(rep.type, "RepayAnonymous");
  assert.equal(
    hashOf(R_Repay(rep.proof, rep.repayAmount, rep.loanNullifier, rep.repayNullifier, rep.appendProof)),
    cycle.repay.redeemer.hash);

  const wd = decodePoolRedeemer(cycle.withdraw.redeemer.cbor);
  assert.equal(wd.type, "WithdrawLiquidity");
  assert.equal(hashOf(R_WithdrawLiquidity(wd.proof, wd.withdrawNullifier, wd.recipient)), cycle.withdraw.redeemer.hash);
});

test("payout tags and the unlock redeemer re-encode to their on-chain hashes", () => {
  const bor = decodePoolRedeemer(cycle.borrow.redeemer.cbor);
  assert.equal(hashOf(loanTag(bor.loanNullifier)), cycle.borrow.datums[1].hash);
  const wd = decodePoolRedeemer(cycle.withdraw.redeemer.cbor);
  assert.equal(hashOf(loanTag(wd.withdrawNullifier)), cycle.withdraw.datums[1].hash);

  const un = decodeUnlockRedeemer(cycle.unlock.redeemer.cbor);
  assert.equal(hashOf(R_Unlock(un.proof, un.poolRef.txHash, un.poolRef.index)), cycle.unlock.redeemer.hash);
  const { txHash, outputIndex } = cycle.depositTx;
  assert.equal(hashOf(outputReference(txHash, outputIndex)), cycle.unlock.datums[0].hash);
});

test("share prices match what the pool took and paid on-chain", () => {
  // Before the third share: two shares, 0.5 ADA interest in the pool.
  const before = decodePoolDatum(cycle.repay.datums[0].cbor);
  const balBefore = BigInt(cycle.lendGrown.poolLovelaceIn);
  assert.equal(sharePriceUp(before, balBefore), 10_250_000n);
  const after = decodePoolDatum(cycle.lendGrown.datums[0].cbor);
  assert.equal(after.total_deposited - before.total_deposited, 10_250_000n);

  const beforeWithdraw = decodePoolDatum(cycle.lendGrown.datums[0].cbor);
  assert.equal(sharePriceDown(beforeWithdraw, BigInt(cycle.withdraw.poolLovelaceIn)), 10_250_000n);
});
