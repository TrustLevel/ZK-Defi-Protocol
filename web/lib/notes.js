// A note is the secret behind one position. A collateral note (kind
// "collateral") is a borrower's locked collateral: whoever holds it can borrow
// against it and, after repaying, unlock it. A lender note (kind "lender") is one
// pool share: whoever holds it can withdraw the share. Whoever loses a note loses
// what it stands for. Notes are kept in this browser (localStorage) and exported
// as a file; they are never sent to the backend.
import { computeCommitment, computeLenderCommitment } from "@zk-defi/protocol/crypto";

const VERSION = 1;

function randomSecret() {
  // 128 random bits, well inside the BLS12-381 scalar field
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

// depositKeyHashes: payment key hashes of the account that pays the deposit
// (account A), kept so the app can warn when a later step would reuse it.
export function createNote({ network, policyId, depositKeyHashes = [] }) {
  const secret = randomSecret();
  return {
    version: VERSION, kind: "collateral", network, policyId,
    id: computeCommitment(secret).toString(16).slice(0, 12),
    secret, commitment: computeCommitment(secret),
    deposit: null, depositKeyHashes, createdAt: new Date().toISOString(),
  };
}

// addKeyHashes: payment key hashes of the account that buys the share, kept so
// the app can warn when the withdrawal would pay back to it.
export function createLenderNote({ network, policyId, addKeyHashes = [] }) {
  const secret = randomSecret();
  const commitment = computeLenderCommitment(secret);
  return {
    version: VERSION, kind: "lender", network, policyId, id: "L" + commitment.toString(16).slice(0, 11),
    secret, commitment, added: null, addKeyHashes, createdAt: new Date().toISOString(),
  };
}

const kindOf = (note) => note.kind ?? "collateral";
const commitmentOf = (note) =>
  (kindOf(note) === "lender" ? computeLenderCommitment(note.secret) : computeCommitment(note.secret));
export const notesOfKind = (notes, kind) => notes.filter((n) => kindOf(n) === kind);

export function serializeNote(note) {
  return JSON.stringify({ ...note, secret: note.secret.toString(), commitment: note.commitment.toString() }, null, 2);
}

export function parseNote(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a note file.");
  }
  if (raw?.version !== VERSION || !raw.secret || !raw.commitment) throw new Error("This is not a note file.");
  const note = { ...raw, secret: BigInt(raw.secret), commitment: BigInt(raw.commitment) };
  if (!["collateral", "lender"].includes(kindOf(note))) throw new Error("This is not a note file.");
  if (commitmentOf(note) !== note.commitment) {
    throw new Error("The note's secret does not match its commitment; the file is damaged.");
  }
  return note;
}

// ── storage in this browser ──────────────────────────────────────────────────
const KEY = "zk-lending.notes";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]").map((t) => parseNote(t));
  } catch {
    return [];
  }
}
export function loadNotes(policyId, kind = "collateral") {
  return notesOfKind(readAll().filter((n) => n.policyId === policyId), kind);
}
export function saveNote(note) {
  const others = readAll().filter((n) => n.id !== note.id);
  localStorage.setItem(KEY, JSON.stringify([...others, note].map(serializeNote)));
}
export function removeNote(id) {
  localStorage.setItem(KEY, JSON.stringify(readAll().filter((n) => n.id !== id).map(serializeNote)));
}

// Offer the note as a file download (the backup the user must keep).
export function downloadNote(note) {
  const blob = new Blob([serializeNote(note)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `zk-lending-note-${note.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
