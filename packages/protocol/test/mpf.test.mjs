// The nullifier sets (mpf.mjs): proofs and roots that the validator accepts, a
// datum that keeps its size however many loans the pool has seen, and refusals
// for a nullifier that already borrowed or a share already withdrawn. The
// roots for the fixture nullifiers are checked against the Aiken library in
// contracts/lib/set_fixture.ak (offchain_roots_match_onchain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeData } from "@meshsdk/core";
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { buildSets, nullifierKey, EMPTY_ROOT, LOAN_OPEN, LOAN_SETTLED } from "../src/mpf.mjs";
import { poolDatum } from "../src/plutus.mjs";

const N = 13363567938272564440676172658199675024663324988111273564368569843933911498447n;

test("fixture roots match the ones the Aiken test pins", async () => {
  const b = await (await buildSets([])).borrow(N);
  assert.equal(b.newRoot, "8129bde90e5fab98a3420d7280cb757e21b6115446864fd04e431c71c9b25702");
  assert.deepEqual(b.proof, { list: [] });
  const r = await (await buildSets([{ type: "borrow", nullifier: N }])).repay(N);
  assert.equal(r.newRoot, "e874017f593ffe0f9f6e4126ca97e3138001c2b513bfdc616fa7515b90bd9469");
});

test("the set built from the history equals the set built step by step", async () => {
  const events = [];
  for (let i = 1n; i <= 30n; i++) {
    const s = await buildSets(events);
    const { newRoot } = await s.borrow(i);
    events.push({ type: "borrow", nullifier: i });
    assert.equal((await buildSets(events)).loansRoot, newRoot);
    if (i % 3n === 0n) {
      const { newRoot: settled } = await (await buildSets(events)).repay(i);
      events.push({ type: "repay", nullifier: i });
      assert.equal((await buildSets(events)).loansRoot, settled);
    }
  }
  const s = await buildSets(events);
  assert.equal(s.openLoans.length, 20);
  assert.equal(s.usedLoans.length, 30);
});

test("an insert proof verifies as exclusion against the old root and inclusion against the new", async () => {
  const t = await Trie.fromList([1n, 2n, 3n].map((k) => ({ key: nullifierKey(k), value: Buffer.from(LOAN_OPEN, "hex") })));
  const p = await t.prove(nullifierKey(9n), true);
  assert.equal(p.verify(false).toString("hex"), t.hash.toString("hex"));
  await t.insert(nullifierKey(9n), Buffer.from(LOAN_OPEN, "hex"));
  p.setValue(Buffer.from(LOAN_OPEN, "hex"));
  assert.equal(p.verify(true).toString("hex"), t.hash.toString("hex"));
});

test("a nullifier borrows once, is repaid once, and a share pays out once", async () => {
  const s = await buildSets([{ type: "borrow", nullifier: N }, { type: "repay", nullifier: N }, { type: "withdraw", nullifier: 5n }]);
  await assert.rejects(s.borrow(N), /already borrowed/);
  await assert.rejects(s.repay(N), /no open loan/);
  await assert.rejects(s.withdraw(5n), /already withdrawn/);
});

test("the pool datum keeps its size however many loans and withdrawals it has seen", async () => {
  const base = {
    total_deposited: 0n, total_borrowed: 0n, interest_rate: 500n, group_root: 1n, group_next_index: 0n,
    repaid_root: 1n, next_index: 0n, external_nullifier: 7777n, repay_external_nullifier: 8888n,
    loan_asset: { policy_id: "", asset_name: "" }, collateral_assets: [{ policy_id: "", asset_name: "", denomination: 20_000_000n }],
    loan_denomination: 10_000_000n, loans: EMPTY_ROOT, last_updated: 0n, lender_root: 1n, lender_next_index: 0n,
    total_shares: 0n, withdrawn: EMPTY_ROOT, lender_external_nullifier: 9999n, share_start_price: 10_000_000n,
    liquidity_reserve: 0n,
  };
  const events = [];
  for (let i = 1n; i <= 200n; i++) events.push({ type: "borrow", nullifier: i * 7919n }, { type: "withdraw", nullifier: i });
  const s = await buildSets(events);
  const size = (d) => serializeData(poolDatum(d), "JSON").length;
  assert.equal(size({ ...base, loans: s.loansRoot, withdrawn: s.withdrawnRoot }), size(base));
  assert.notEqual(s.loansRoot, EMPTY_ROOT);
  assert.equal(LOAN_SETTLED, "00");
});
