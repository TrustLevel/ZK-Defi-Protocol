// Lender notes: one note is one pool share. Its state follows the public chain
// data (lender tree, spent withdraw nullifiers), and the app warns before a
// withdrawal that would link it to the account that added the share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLenderCommitment, computeLenderNullifier } from "@zk-defi/protocol/crypto";
import { createLenderNote, createNote, serializeNote, parseNote, notesOfKind } from "../lib/notes.js";
import { lenderStatusOf, withdrawWarnings } from "../lib/position.js";

const A = "aa".repeat(28), B = "bb".repeat(28);
const note = createLenderNote({ network: "preprod", policyId: "e59c", addKeyHashes: [A] });
const L = note.commitment;
const W = computeLenderNullifier(note.secret);
const state = (lenders, spent = [], deposits = new Set()) => ({
  pool: { datum: { lender_nullifiers: spent } }, leaves: { commitments: [], repaid: [], lenders }, deposits,
});

test("a lender note is a fresh secret whose commitment is a lender leaf", () => {
  assert.equal(note.kind, "lender");
  assert.equal(L, computeLenderCommitment(note.secret));
  assert.notEqual(createLenderNote({ network: "preprod", policyId: "e59c" }).secret, note.secret);
});

test("a lender note survives export and import, and a damaged one is refused", () => {
  const back = parseNote(serializeNote({ ...note, added: "cd".repeat(32) }));
  assert.equal(back.kind, "lender");
  assert.equal(back.secret, note.secret);
  assert.equal(back.added, "cd".repeat(32));
  const tampered = JSON.parse(serializeNote(note));
  tampered.commitment = "1";
  assert.throws(() => parseNote(JSON.stringify(tampered)), /does not match/);
});

test("lender notes and collateral notes are kept apart", () => {
  const collateral = createNote({ network: "preprod", policyId: "e59c" });
  assert.deepEqual(notesOfKind([note, collateral], "lender"), [note]);
  assert.deepEqual(notesOfKind([note, collateral], "collateral"), [collateral]);
  // notes from before lender notes existed have no kind: they are collateral notes
  const { kind, ...old } = collateral;
  assert.deepEqual(notesOfKind([old], "collateral"), [old]);
});

test("a share follows the chain: new → pending → held → withdrawn, never offered while loading", () => {
  assert.equal(lenderStatusOf(note, null), "loading");
  assert.equal(lenderStatusOf(note, state([])), "new");
  assert.equal(lenderStatusOf({ ...note, added: "cd".repeat(32) }, state([])), "pending");
  assert.equal(lenderStatusOf(note, state([5n, L])), "held");
  assert.equal(lenderStatusOf(note, state([5n, L], [W])), "withdrawn");
});

test("withdraw warnings: payout to the adding account, and a small anonymity set", () => {
  const big = state([1n, 2n, 3n, 4n, 5n, L]);
  assert.deepEqual(withdrawWarnings(note, big, { keyHashes: [B] }), []);
  assert.equal(withdrawWarnings(note, big, { keyHashes: [A] })[0].code, "payout-to-adding-account");
  const small = state([5n, L]);
  assert.ok(withdrawWarnings(note, small, { keyHashes: [B] }).some((w) => w.code === "small-anonymity-set"));
  // shares already withdrawn do not hide anyone any more: 5 notes, 3 out
  const thinned = state([1n, 2n, 3n, 4n, L], [11n, 12n, 13n]);
  assert.ok(withdrawWarnings(note, thinned, { keyHashes: [B] }).some((w) => w.code === "small-anonymity-set"));
});
