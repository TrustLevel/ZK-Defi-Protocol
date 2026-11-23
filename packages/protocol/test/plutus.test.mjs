// Round trip against the chain: decode each redeemer and datum of the M4
// lender-side Preprod cycle, encode it again with the builders, and require the
// on-chain data hash. A single wrong field, constructor index or integer
// encoding changes the hash. Covers the encodings that cycle shares with the
// current validators: deposit datum, AddLiquidity, WithdrawLiquidity, payout
// tags and the unlock redeemer. The pool datum and the deposit, borrow and repay
// redeemers changed with the asset pools; their golden vectors come from the
// asset-pool Preprod cycle (PENDING), their round trips are in assets.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDataHash, deserializeDatum } from "@meshsdk/core";
import {
  decodePoolRedeemer, decodeDepositDatum, decodeUnlockRedeemer,
  depositDatum, outputReference, loanTag, addressFromData,
  R_AddLiquidity, R_Unlock, R_WithdrawLiquidity,
} from "../src/plutus.mjs";

const cycle = JSON.parse(readFileSync(new URL("./fixtures/m4-lend-cycle.json", import.meta.url), "utf8"));
const hashOf = (data) => resolveDataHash(data, "JSON");

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

  const wd = decodePoolRedeemer(cycle.withdraw.redeemer.cbor);
  assert.equal(wd.type, "WithdrawLiquidity");
  assert.equal(hashOf(R_WithdrawLiquidity(wd.proof, wd.withdrawNullifier, wd.recipient)), cycle.withdraw.redeemer.hash);
});

test("payout tags and the unlock redeemer re-encode to their on-chain hashes", () => {
  // M4 borrow redeemer: [proof, loan_amount, loan_nullifier, recipient].
  const m4BorrowNullifier = BigInt(deserializeDatum(cycle.borrow.redeemer.cbor).fields[2].int);
  assert.equal(hashOf(loanTag(m4BorrowNullifier)), cycle.borrow.datums[1].hash);
  const wd = decodePoolRedeemer(cycle.withdraw.redeemer.cbor);
  assert.equal(hashOf(loanTag(wd.withdrawNullifier)), cycle.withdraw.datums[1].hash);

  const un = decodeUnlockRedeemer(cycle.unlock.redeemer.cbor);
  assert.equal(hashOf(R_Unlock(un.proof, un.poolRef.txHash, un.poolRef.index)), cycle.unlock.redeemer.hash);
  const { txHash, outputIndex } = cycle.depositTx;
  assert.equal(hashOf(outputReference(txHash, outputIndex)), cycle.unlock.datums[0].hash);
});
