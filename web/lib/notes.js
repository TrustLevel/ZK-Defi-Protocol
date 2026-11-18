// A note is the user's position: the secret behind one deposit. Whoever holds it
// can borrow against the deposit and, after repaying, unlock it; whoever loses it
// loses the collateral. Notes are kept in this browser (localStorage) and
// exported as a file; they are never sent to the backend.
import { computeCommitment, COLLATERAL_DENOMINATION } from "@zk-defi/protocol/crypto";

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
    version: VERSION, network, policyId,
    id: computeCommitment(COLLATERAL_DENOMINATION, secret).toString(16).slice(0, 12),
    secret, commitment: computeCommitment(COLLATERAL_DENOMINATION, secret),
    deposit: null, depositKeyHashes, createdAt: new Date().toISOString(),
  };
}

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
  if (computeCommitment(COLLATERAL_DENOMINATION, note.secret) !== note.commitment) {
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
export function loadNotes(policyId) {
  return readAll().filter((n) => n.policyId === policyId);
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
