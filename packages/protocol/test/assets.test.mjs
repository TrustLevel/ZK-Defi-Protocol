// Asset handling of the protocol module, as the validators check it
// (contracts/validators/tests/asset_test.ak): the pool value moves only in the
// loan asset, token outputs carry min ADA, and the pool datum with its assets and
// the deposit, borrow and repay redeemers survive an encode/decode round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeData, list, conStr, integer, byteString } from "@meshsdk/core";
import {
  poolDatum, decodePoolDatum, decodePoolRedeemer, R_DepositCollateral, R_Borrow, R_Repay,
} from "../src/plutus.mjs";
import {
  ADA, MIN_ADA_TOKEN_OUTPUT, unitOf, quantityOf, moveAsset, poolBalance, poolValueMoved, assetValue,
} from "../src/tx.mjs";

const TOKEN = { policy_id: "e1".repeat(28), asset_name: "555344" };
const NFT_UNIT = "d0".repeat(28) + "504f4f4c";
const cbor = (data) => serializeData(data, "JSON");

const tokenPool = (tokens) => ({
  utxo: { output: { amount: [
    { unit: "lovelace", quantity: "3000000" }, { unit: NFT_UNIT, quantity: "1" },
    { unit: unitOf(TOKEN), quantity: String(tokens) },
  ] } },
  datum: { loan_asset: TOKEN },
});

test("units: ADA is lovelace, a token is policy id + asset name", () => {
  assert.equal(unitOf(ADA), "lovelace");
  assert.equal(unitOf(TOKEN), "e1".repeat(28) + "555344");
});

test("a token pool's balance is its loan token, not its ADA", () => {
  assert.equal(poolBalance(tokenPool(100n)), 100n);
});

test("the continuing pool value moves only the loan asset", () => {
  const moved = poolValueMoved(tokenPool(100n), -10n);
  assert.equal(quantityOf(moved, TOKEN), 90n);
  assert.equal(quantityOf(moved, ADA), 3_000_000n);
  assert.ok(moved.some((a) => a.unit === NFT_UNIT && a.quantity === "1"));
  assert.equal(moved.length, 3);
});

test("an ADA pool moves its lovelace", () => {
  const pool = {
    utxo: { output: { amount: [{ unit: "lovelace", quantity: "100" }, { unit: NFT_UNIT, quantity: "1" }] } },
    datum: { loan_asset: ADA },
  };
  assert.equal(quantityOf(poolValueMoved(pool, 5n), ADA), 105n);
});

test("moving a token to zero drops it; below zero is refused", () => {
  assert.deepEqual(moveAsset([{ unit: unitOf(TOKEN), quantity: "5" }], TOKEN, -5n), []);
  assert.throws(() => moveAsset([], TOKEN, -1n));
});

test("token outputs carry min ADA, ADA outputs only their amount", () => {
  assert.deepEqual(assetValue(ADA, 20n), [{ unit: "lovelace", quantity: "20" }]);
  assert.deepEqual(assetValue(TOKEN, 500n), [
    { unit: "lovelace", quantity: String(MIN_ADA_TOKEN_OUTPUT) }, { unit: unitOf(TOKEN), quantity: "500" },
  ]);
});

const datum = {
  total_deposited: 0n, total_borrowed: 0n, interest_rate: 500n,
  group_root: 11n, group_next_index: 0n, repaid_root: 12n, next_index: 0n, external_nullifier: 7777n,
  repay_external_nullifier: 8888n, loan_asset: TOKEN,
  collateral_assets: [
    { policy_id: "", asset_name: "", denomination: 20_000_000n },
    { policy_id: "e2".repeat(28), asset_name: "544f4b", denomination: 500n },
  ],
  loan_denomination: 10_000_000n, loans: "00".repeat(32), last_updated: 0n,
  lender_root: 14n, lender_next_index: 0n, total_shares: 0n, withdrawn: "00".repeat(32),
  lender_external_nullifier: 9999n, share_start_price: 10_000_000n, liquidity_reserve: 0n,
};
const proof = { piA: "a1".repeat(48), piB: "b2".repeat(96), piC: "c3".repeat(48) };

test("the pool datum with a loan token and two collateral assets round-trips", () => {
  assert.deepEqual(decodePoolDatum(cbor(poolDatum(datum))), datum);
});

test("deposit, borrow and repay redeemers round-trip with their fields", () => {
  assert.deepEqual(decodePoolRedeemer(cbor(R_DepositCollateral(16n, 1n, proof))),
    { type: "DepositCollateral", commitment: 16n, assetIndex: 1n, appendProof: proof });
  const mpfProof = list([conStr(1, [integer("2"), conStr(0, [integer("3"), byteString("ab"), byteString("cd".repeat(32))])])]);
  assert.deepEqual(decodePoolRedeemer(cbor(R_Borrow(proof, 17n, "be".repeat(28), mpfProof))),
    { type: "BorrowAnonymous", proof, loanNullifier: 17n, recipient: "be".repeat(28), loansProof: mpfProof });
  assert.deepEqual(decodePoolRedeemer(cbor(R_Repay(proof, 17n, 18n, proof, mpfProof))),
    { type: "RepayAnonymous", proof, loanNullifier: 17n, repayNullifier: 18n, appendProof: proof, loansProof: mpfProof });
});
