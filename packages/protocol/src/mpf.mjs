/**
 * The pool's two nullifier sets as Merkle Patricia Forestry (MPF) tries
 * (@aiken-lang/merkle-patricia-forestry, the off-chain side of the Aiken
 * library the validator uses). Node only: the library uses Node built-ins; the
 * browser gets proofs from the backend.
 *
 *   loans:     loan nullifier -> 01 (open) | 00 (settled). Borrow inserts, repay
 *              updates; nothing deletes.
 *   withdrawn: withdraw nullifier -> 01. Withdraw inserts.
 *
 * Keys are the nullifier's 32-byte big-endian encoding (types_v5.nullifier_key).
 * The tries are rebuilt from the pool's redeemer history (chain.fetchLeaves).
 */
import { Trie } from "@aiken-lang/merkle-patricia-forestry";
import { deserializeDatum } from "@meshsdk/core";
import { plain } from "./plutus.mjs";

export const LOAN_OPEN = "01";
export const LOAN_SETTLED = "00";
export const NOTE_WITHDRAWN = "01";
// Root of the empty trie (the Aiken library's null hash).
export const EMPTY_ROOT = "00".repeat(32);

export const nullifierKey = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, "0"), "hex");
const rootOf = (trie) => (trie.hash ? trie.hash.toString("hex") : EMPTY_ROOT);

// An MPF proof as Plutus data (the Aiken `Proof`), for a redeemer.
export const proofData = (proof) => plain(deserializeDatum(proof.toCBOR().toString("hex")));

// Final values of both sets from the events of the pool history, in order.
// events: [{ type: "borrow" | "repay" | "withdraw", nullifier }]
function valuesOf(events) {
  const loans = new Map(), withdrawn = new Map();
  for (const e of events) {
    const k = BigInt(e.nullifier);
    if (e.type === "borrow") loans.set(k, LOAN_OPEN);
    if (e.type === "repay") loans.set(k, LOAN_SETTLED);
    if (e.type === "withdraw") withdrawn.set(k, NOTE_WITHDRAWN);
  }
  return { loans, withdrawn };
}
const trieOf = (map) => Trie.fromList([...map].map(([k, v]) => ({ key: nullifierKey(k), value: Buffer.from(v, "hex") })));

export async function buildSets(events) {
  const { loans, withdrawn } = valuesOf(events);
  const loansTrie = await trieOf(loans), withdrawnTrie = await trieOf(withdrawn);
  return {
    loansRoot: rootOf(loansTrie),
    withdrawnRoot: rootOf(withdrawnTrie),
    openLoans: [...loans].filter(([, v]) => v === LOAN_OPEN).map(([k]) => k),
    usedLoans: [...loans.keys()],
    withdrawnNotes: [...withdrawn.keys()],
    // Borrow: proof that N is not in the loans set, and the root with N open.
    async borrow(n) {
      if (loans.has(BigInt(n))) throw new Error("this nullifier already borrowed");
      const proof = await loansTrie.prove(nullifierKey(n), true);
      const next = await trieOf(new Map([...loans, [BigInt(n), LOAN_OPEN]]));
      return { proof: proofData(proof), newRoot: rootOf(next) };
    },
    // Repay: proof that N is in the loans set, and the root with N settled.
    async repay(n) {
      if (loans.get(BigInt(n)) !== LOAN_OPEN) throw new Error("no open loan for this nullifier");
      const proof = await loansTrie.prove(nullifierKey(n));
      const next = await trieOf(new Map([...loans, [BigInt(n), LOAN_SETTLED]]));
      return { proof: proofData(proof), newRoot: rootOf(next) };
    },
    // Withdraw: proof that W is not in the withdrawn set, and the root with W.
    async withdraw(w) {
      if (withdrawn.has(BigInt(w))) throw new Error("this share was already withdrawn");
      const proof = await withdrawnTrie.prove(nullifierKey(w), true);
      const next = await trieOf(new Map([...withdrawn, [BigInt(w), NOTE_WITHDRAWN]]));
      return { proof: proofData(proof), newRoot: rootOf(next) };
    },
  };
}
