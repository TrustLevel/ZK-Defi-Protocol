import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommitment, computeNullifier, computeRepayNullifier } from "@zk-defi/protocol/crypto";
import { createNote, serializeNote, parseNote } from "../lib/notes.js";
import { positionOf, linkageWarnings } from "../lib/position.js";

const note = createNote({ network: "preprod", policyId: "e59c", depositKeyHashes: ["aa".repeat(28)] });
const C = note.commitment;
const N = computeNullifier(note.secret);
const R = computeRepayNullifier(note.secret);
const empty = { pool: { datum: { used_nullifiers: [], open_loans: [] } }, leaves: { commitments: [], repaid: [] } };
const withLeaves = (patch) => ({
  pool: { datum: { ...empty.pool.datum, ...patch.datum } },
  leaves: { ...empty.leaves, ...patch.leaves },
});

test("a note is a fresh secret whose commitment is its tagged collateral leaf", () => {
  const other = createNote({ network: "preprod", policyId: "e59c", depositKeyHashes: [] });
  assert.notEqual(note.secret, other.secret);
  assert.equal(C, computeCommitment(note.secret));
});

test("a note survives export and import, and a damaged one is refused", () => {
  const back = parseNote(serializeNote({ ...note, deposit: { txHash: "ab".repeat(32), outputIndex: 1 } }));
  assert.equal(back.secret, note.secret);
  assert.equal(back.commitment, C);
  assert.deepEqual(back.deposit, { txHash: "ab".repeat(32), outputIndex: 1 });
  const tampered = JSON.parse(serializeNote(note));
  tampered.commitment = "1";
  assert.throws(() => parseNote(JSON.stringify(tampered)), /does not match/);
  assert.throws(() => parseNote("{"), /not a note/);
});

test("position follows the chain: new → deposited → borrowed → repaid → unlocked", () => {
  assert.equal(positionOf(note, empty, { depositSpent: false }), "new");
  const deposited = withLeaves({ leaves: { commitments: [5n, C] } });
  assert.equal(positionOf(note, deposited, { depositSpent: false }), "deposited");
  const borrowed = withLeaves({ leaves: { commitments: [C] }, datum: { used_nullifiers: [N], open_loans: [N] } });
  assert.equal(positionOf(note, borrowed, { depositSpent: false }), "borrowed");
  const repaid = withLeaves({ leaves: { commitments: [C], repaid: [R] }, datum: { used_nullifiers: [N] } });
  assert.equal(positionOf(note, repaid, { depositSpent: false }), "repaid");
  assert.equal(positionOf(note, repaid, { depositSpent: true }), "unlocked");
});

test("a deposit submitted but not yet indexed is pending", () => {
  const sent = { ...note, deposit: { txHash: "ab".repeat(32), outputIndex: 1 } };
  assert.equal(positionOf(sent, empty, { depositSpent: false }), "pending");
});

test("linkage warnings: repaying or receiving with the deposit's account", () => {
  const A = "aa".repeat(28), B = "bb".repeat(28);
  assert.deepEqual(linkageWarnings(note, { step: "repay", keyHashes: [B] }), []);
  assert.equal(linkageWarnings(note, { step: "repay", keyHashes: [A] })[0].code, "repay-from-deposit-account");
  assert.equal(linkageWarnings(note, { step: "borrow", keyHashes: [A] })[0].code, "loan-to-deposit-account");
});

// Before the chain state has loaded, a card must not offer a deposit: the note
// may already be deposited, and depositing it twice locks 20 ADA for good.
test("without chain state a note is loading, never new", async () => {
  const { statusOf } = await import("../lib/position.js");
  assert.equal(statusOf(note, null), "loading");
  assert.equal(statusOf({ ...note, deposit: { txHash: "ab".repeat(32), outputIndex: 1 } }, null), "loading");
  assert.equal(statusOf(note, { ...empty, deposits: new Set() }), "new");
});
