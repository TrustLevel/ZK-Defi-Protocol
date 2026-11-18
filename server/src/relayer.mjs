/**
 * Relayer for borrow and unlock: it pays fees and script collateral, so the
 * user's wallet does not appear in these transactions. It cannot redirect
 * funds: the borrow proof is bound to the recipient key and the unlock pays the
 * deposit's own unlock_to.
 *
 * It spends its own ADA on every relayed transaction, so it checks everything
 * itself first: the public signals against the live pool datum, the recipient
 * against the proof, the nullifier against used_nullifiers, and the proof
 * against the verification key. It compresses the proof points itself and
 * never trusts an encoding from the client. Relayed transactions run one at a
 * time (they spend the same wallet), each until it is confirmed.
 */
import * as snarkjs from "snarkjs";
import { pkhToInt } from "@zk-defi/protocol/crypto";
import { paymentKeyHash, decodeDepositDatum, addressFromData } from "@zk-defi/protocol/plutus";

export class RelayError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
const bad = (msg) => new RelayError(400, "invalid_request", msg);
const stale = (msg) => new RelayError(409, "stale", msg);

function parseSignals(publicSignals, n) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== n) throw bad(`expected ${n} public signals`);
  try {
    return publicSignals.map((s) => {
      if (typeof s !== "string" || !/^\d{1,80}$/.test(s)) throw new Error();
      return BigInt(s);
    });
  } catch {
    throw bad("public signals must be decimal strings");
  }
}
function checkProofShape(proof) {
  const point = (p, n) => Array.isArray(p) && p.length === 3 && p.flat().every((x) => typeof x === "string" && /^\d{1,120}$/.test(x)) && p.flat().length === n;
  if (!proof || !point(proof.pi_a, 3) || !point(proof.pi_b, 6) || !point(proof.pi_c, 3)) throw bad("malformed proof");
}
async function verify(vkey, publicSignals, proof) {
  let ok = false;
  try {
    ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } catch { /* an invalid point is an invalid proof */ }
  if (!ok) throw bad("proof does not verify");
}

// chain:  { state({ fresh }) }      (chain-service.mjs)
// runner: { borrow(args), unlock(args), findDeposit(ref) }   (tx-runner.mjs)
// vkeys:  { borrow, settlement } as snarkjs verification key JSON
export function createRelayer({ chain, runner, vkeys }) {
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  return {
    // body: { proof, publicSignals, recipient }
    // publicSignals: [group_root, loan_nullifier, loan_amount, collateral_ratio, external_nullifier, recipient]
    async borrow(body = {}) {
      const { proof, publicSignals, recipient } = body;
      checkProofShape(proof);
      const [root, nullifier, amount, ratio, ext, recipientInt] = parseSignals(publicSignals, 6);
      let recipientPkh;
      try {
        recipientPkh = paymentKeyHash(recipient);
      } catch {
        throw bad("recipient must be a key payment address");
      }
      if (pkhToInt(recipientPkh) !== recipientInt) throw bad("the proof is bound to a different recipient");
      const { pool } = await chain.state();
      const d = pool.datum;
      if (amount !== d.loan_denomination || ratio !== d.collateral_ratio || ext !== d.external_nullifier) {
        throw bad("public signals do not match the pool parameters");
      }
      await verify(vkeys.borrow, publicSignals, proof);

      return exclusive(async () => {
        const { pool: live } = await chain.state({ fresh: true });
        if (live.datum.group_root !== root) throw stale("the deposit set changed; prove again against the new root");
        if (live.datum.used_nullifiers.includes(nullifier)) throw new RelayError(409, "used", "this deposit already backed a loan");
        return runner.borrow({ pool: live, proof, nullifier, recipient, recipientPkh });
      });
    },

    // body: { proof, publicSignals, deposit: { txHash, outputIndex } }
    // publicSignals: [commitment, repaid_root, repay_external_nullifier]
    async unlock(body = {}) {
      const { proof, publicSignals, deposit: ref } = body;
      checkProofShape(proof);
      const [commitment, repaidRoot, repayExt] = parseSignals(publicSignals, 3);
      if (!ref || !/^[0-9a-f]{64}$/.test(ref.txHash) || !Number.isInteger(ref.outputIndex)) throw bad("deposit must be { txHash, outputIndex }");
      const deposit = await runner.findDeposit(ref);
      if (!deposit) throw new RelayError(404, "not_found", "deposit not found (already unlocked?)");
      const datum = decodeDepositDatum(deposit.output.plutusData);
      if (datum.commitment !== commitment) throw bad("the proof is for a different deposit");
      const { pool } = await chain.state();
      if (repayExt !== pool.datum.repay_external_nullifier) throw bad("public signals do not match the pool parameters");
      await verify(vkeys.settlement, publicSignals, proof);
      const unlockTo = addressFromData(datum.unlockTo);

      return exclusive(async () => {
        const { pool: live } = await chain.state({ fresh: true });
        if (live.datum.repaid_root !== repaidRoot) throw stale("the repaid set changed; prove again against the new root");
        return runner.unlock({ pool: live, proof, deposit, unlockTo });
      });
    },
  };
}
