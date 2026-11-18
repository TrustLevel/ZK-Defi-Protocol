// Round trip against the chain: decode each redeemer and datum of the M4 Preprod
// cycle, encode it again with the builders, and require the on-chain data hash.
// A single wrong field, constructor index or integer encoding changes the hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDataHash } from "@meshsdk/core";
import {
  decodePoolDatum, decodePoolRedeemer, decodeDepositDatum, decodeUnlockRedeemer,
  poolDatum, depositDatum, outputReference, loanTag, addressFromData,
  R_DepositCollateral, R_Borrow, R_Repay, R_Unlock,
} from "../src/plutus.mjs";

const cycle = JSON.parse(readFileSync(new URL("./fixtures/m4-cycle.json", import.meta.url), "utf8"));
const hashOf = (data) => resolveDataHash(data, "JSON");

test("pool datum after every step re-encodes to its on-chain hash", () => {
  for (const step of ["deposit", "borrow", "repay"]) {
    const { hash, cbor } = cycle[step].datums[0];
    assert.equal(hashOf(poolDatum(decodePoolDatum(cbor))), hash, step);
  }
});

test("the pool datum decodes to the expected state after the repay", () => {
  const d = decodePoolDatum(cycle.repay.datums[0].cbor);
  assert.equal(d.group_next_index, 1n);
  assert.equal(d.next_index, 1n);
  assert.equal(d.loan_denomination, 10_000_000n);
  assert.deepEqual(d.open_loans, []);
  assert.equal(d.used_nullifiers.length, 1);
});

test("deposit datum re-encodes to its on-chain hash", () => {
  const { hash, cbor } = cycle.deposit.datums[1];
  const d = decodeDepositDatum(cbor);
  assert.equal(hashOf(depositDatum(d.commitment, d.timestamp, cycle.unlockTo)), hash);
});

test("the deposit datum's unlock_to decodes to its bech32 address", () => {
  const d = decodeDepositDatum(cycle.deposit.datums[1].cbor);
  assert.equal(addressFromData(d.unlockTo), cycle.unlockTo);
});

test("pool redeemers re-encode to their on-chain hashes", () => {
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
  assert.equal(rep.repayAmount, 10_500_000n);
});

test("loan payout tag and unlock redeemer + tag re-encode to their on-chain hashes", () => {
  const bor = decodePoolRedeemer(cycle.borrow.redeemer.cbor);
  assert.equal(hashOf(loanTag(bor.loanNullifier)), cycle.borrow.datums[1].hash);

  const un = decodeUnlockRedeemer(cycle.unlock.redeemer.cbor);
  assert.equal(hashOf(R_Unlock(un.proof, un.poolRef.txHash, un.poolRef.index)), cycle.unlock.redeemer.hash);
  const { txHash, outputIndex } = cycle.depositTx;
  assert.equal(hashOf(outputReference(txHash, outputIndex)), cycle.unlock.datums[0].hash);
});
