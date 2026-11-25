// verifyPool must refuse a pool whose initial state the honest client cannot use.
// Reported in the 2026-11-25 tester run (runbook 4, case 13c): a pool initialized
// with another repay_external_nullifier passed the client check, but no honest
// repay proof would ever verify there, so its collateral could not be unlocked.
// Each test starts from the honest initial state and changes one parameter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serializeData } from "@meshsdk/core";
import { verifyPool } from "../src/chain.mjs";
import { deriveScripts } from "../src/scripts.mjs";
import { poolDatum } from "../src/plutus.mjs";
import { initialPoolValue } from "../src/tx.mjs";
import {
  merkleRoot, EXTERNAL_NULLIFIER, REPAY_EXTERNAL_NULLIFIER, LENDER_EXTERNAL_NULLIFIER, LOAN_DENOMINATION,
} from "../src/crypto.mjs";
import { EMPTY_ROOT } from "../src/mpf.mjs";

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const blueprint = json("../../../contracts/plutus.json");
const D = json("../deployments/preprod-m3-ada.json");
const S = deriveScripts(blueprint, D.seed, D.vkeys);
const RESERVE = 10_000_000n;
const ADA = { policy_id: "", asset_name: "" };

function honestState() {
  const empty = merkleRoot([]);
  return {
    total_deposited: 0n, total_borrowed: 0n, interest_rate: 500n,
    group_root: empty, group_next_index: 0n, repaid_root: empty, next_index: 0n,
    external_nullifier: EXTERNAL_NULLIFIER, repay_external_nullifier: REPAY_EXTERNAL_NULLIFIER,
    loan_asset: ADA, collateral_assets: [{ ...ADA, denomination: 20_000_000n }],
    loan_denomination: LOAN_DENOMINATION, loans: EMPTY_ROOT, last_updated: 0n,
    lender_root: empty, lender_next_index: 0n, total_shares: 0n, withdrawn: EMPTY_ROOT,
    lender_external_nullifier: LENDER_EXTERNAL_NULLIFIER, share_start_price: LOAN_DENOMINATION,
    liquidity_reserve: RESERVE,
  };
}

// A Blockfrost stub: the init transaction puts the NFT and `liquidity` of the loan
// asset into the pool address with `state` as its datum; the parked keys match.
function chain(state, liquidity = RESERVE) {
  const vkeyCbor = "d87980"; // any datum; expectedVkeys below uses the same
  return async (path) => {
    if (path === `/txs/${D.initTx}/utxos`) {
      return { outputs: [{
        address: S.POOL_ADDRESS,
        amount: initialPoolValue(S, ADA, liquidity),
        inline_datum: serializeData(poolDatum(state), "JSON"),
      }] };
    }
    return { outputs: [0, 1, 2, 3, 4].map((i) => ({ output_index: i, inline_datum: vkeyCbor })) };
  };
}
const expectedVkeys = { borrow: "d87980", settlement: "d87980", append: "d87980", repay: "d87980", lender: "d87980" };
const sets = { loansRoot: EMPTY_ROOT, withdrawnRoot: EMPTY_ROOT, openLoans: [], withdrawnNotes: [] };
const leaves = { commitments: [], repaid: [], lenders: [] };

const verify = (state, liquidity) => verifyPool(chain(state, liquidity), S, D, {
  pool: { datum: state }, leaves, sets, expectedVkeys, emptyRoot: EMPTY_ROOT,
});

test("an honestly initialized pool passes", async () => {
  await verify(honestState());
});

for (const [field, value] of [
  ["external_nullifier", EXTERNAL_NULLIFIER + 1n],
  ["repay_external_nullifier", REPAY_EXTERNAL_NULLIFIER + 1n],
  ["lender_external_nullifier", LENDER_EXTERNAL_NULLIFIER + 1n],
]) {
  test(`a pool with another ${field} is refused (no honest proof would verify)`, async () => {
    await assert.rejects(verify({ ...honestState(), [field]: value }), /pool verification/);
  });
}

test("a pool with an interest rate above 100 % is refused", async () => {
  await assert.rejects(verify({ ...honestState(), interest_rate: 10_001n }), /pool verification/);
});

test("a pool with a zero loan denomination or share price is refused", async () => {
  await assert.rejects(verify({ ...honestState(), loan_denomination: 0n }), /pool verification/);
  await assert.rejects(verify({ ...honestState(), share_start_price: 0n }), /pool verification/);
});

test("a pool whose reserve was not paid in at init is refused (lender funds would fill it)", async () => {
  await assert.rejects(verify({ ...honestState(), liquidity_reserve: 50_000_000n }), /pool verification/);
});

test("a pool without accepted collateral, or with a zero denomination, is refused", async () => {
  await assert.rejects(verify({ ...honestState(), collateral_assets: [] }), /pool verification/);
  await assert.rejects(verify({ ...honestState(), collateral_assets: [{ ...ADA, denomination: 0n }] }), /pool verification/);
});
