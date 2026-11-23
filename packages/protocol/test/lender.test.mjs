// Lender side of the protocol module: share prices as the validator computes
// them (same cases as contracts/validators/tests/lender_test.ak), and the new
// datum fields and redeemers surviving an encode/decode round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeData, list, conStr, integer, byteString } from "@meshsdk/core";
import {
  poolDatum, decodePoolDatum, decodePoolRedeemer, R_AddLiquidity, R_WithdrawLiquidity,
  R_DepositCollateral, R_Borrow, R_Repay,
} from "../src/plutus.mjs";
import { freeLiquidity, sharePriceUp, sharePriceDown, withdrawableShares } from "../src/tx.mjs";

const reserve = 2_000_000n;
const pool = (shares, borrowed) => ({
  total_shares: shares, total_borrowed: borrowed, liquidity_reserve: reserve, share_start_price: 10_000_000n,
});

test("the first share costs the start price", () => {
  assert.equal(sharePriceUp(pool(0n, 0n), reserve), 10_000_000n);
  assert.equal(sharePriceDown(pool(0n, 0n), reserve), 0n);
});

test("interest raises the price of every share", () => {
  assert.equal(sharePriceUp(pool(1n, 0n), reserve + 10_500_000n), 10_500_000n);
  assert.equal(sharePriceDown(pool(2n, 0n), reserve + 21_000_000n), 10_500_000n);
});

test("outstanding loans count towards the share value but not the free liquidity", () => {
  const d = pool(2n, 10_000_000n);
  assert.equal(sharePriceDown(d, reserve + 11_000_000n), 10_500_000n);
  assert.equal(freeLiquidity(d, reserve + 11_000_000n), 11_000_000n);
  assert.equal(withdrawableShares(d, reserve + 11_000_000n), 1n);
  assert.equal(withdrawableShares(pool(2n, 20_000_000n), reserve + 1_000_000n), 0n);
});

test("buying rounds up and withdrawing rounds down, in the pool's favour", () => {
  const d = pool(3n, 0n);
  assert.equal(sharePriceUp(d, reserve + 31_000_000n), 10_333_334n);
  assert.equal(sharePriceDown(d, reserve + 31_000_000n), 10_333_333n);
});

test("withdrawable shares never exceed the shares outstanding", () => {
  assert.equal(withdrawableShares(pool(2n, 0n), reserve + 21_000_000n), 2n);
});

const datum = {
  total_deposited: 20_500_000n, total_borrowed: 0n, interest_rate: 500n,
  group_root: 11n, group_next_index: 1n, repaid_root: 12n, next_index: 1n, external_nullifier: 7777n,
  repay_external_nullifier: 8888n, loan_asset: { policy_id: "", asset_name: "" },
  collateral_assets: [{ policy_id: "", asset_name: "", denomination: 20_000_000n }],
  loan_denomination: 10_000_000n, loans: "ab".repeat(32), last_updated: 1700000000000n,
  lender_root: 14n, lender_next_index: 2n, total_shares: 1n, withdrawn: "cd".repeat(32),
  lender_external_nullifier: 9999n, share_start_price: 10_000_000n, liquidity_reserve: reserve,
};
const proof = { piA: "a1".repeat(48), piB: "b2".repeat(96), piC: "c3".repeat(48) };
const mpfProof = list([conStr(0, [integer("0"), byteString("ee".repeat(128))])]);
const cbor = (data) => serializeData(data, "JSON");

test("the pool datum with lender fields round-trips", () => {
  assert.deepEqual(decodePoolDatum(cbor(poolDatum(datum))), datum);
});

test("lender redeemers round-trip and borrower redeemers keep their constructors", () => {
  assert.deepEqual(decodePoolRedeemer(cbor(R_AddLiquidity(16n, proof))),
    { type: "AddLiquidity", commitment: 16n, appendProof: proof });
  assert.deepEqual(decodePoolRedeemer(cbor(R_WithdrawLiquidity(proof, 17n, "cd".repeat(28), mpfProof))),
    { type: "WithdrawLiquidity", proof, withdrawNullifier: 17n, recipient: "cd".repeat(28), withdrawnProof: mpfProof });
  assert.equal(decodePoolRedeemer(cbor(R_DepositCollateral(1n, 0n, proof))).type, "DepositCollateral");
  assert.equal(decodePoolRedeemer(cbor(R_Borrow(proof, 2n, "be".repeat(28), mpfProof))).type, "BorrowAnonymous");
  assert.equal(decodePoolRedeemer(cbor(R_Repay(proof, 2n, 3n, proof, mpfProof))).type, "RepayAnonymous");
});
