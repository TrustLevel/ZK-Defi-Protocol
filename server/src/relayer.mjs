/**
 * Relayer for borrow, unlock and lender withdraw: it pays fees and script
 * collateral, so the user's wallet does not appear in these transactions. It
 * cannot redirect funds: the borrow and withdraw proofs are bound to the
 * recipient key and the unlock pays the deposit's own unlock_to.
 *
 * It spends its own ADA on every relayed transaction, so it checks everything
 * itself first: the public signals against the live pool datum, the recipient
 * against the proof, the nullifier against the pool's nullifier sets, and the
 * proof against the verification key. It compresses the proof points itself and
 * never trusts an encoding from the client. Relayed transactions run one at a
 * time (they spend the same wallet), each until it is confirmed.
 *
 * Its spending is capped: every relayed transaction costs its fee, and a payout
 * in a native token also carries the output's min ADA from the relayer. A loop
 * of share purchases and relayed withdrawals would otherwise drain it. Limits:
 * `perRecipientPerDay` relayed borrows and withdrawals per payout key and
 * `perDay` relayed transactions in total, per UTC day.
 */
import * as snarkjs from "snarkjs";
import { pkhToInt } from "@zk-defi/protocol/crypto";
import { paymentKeyHash, decodeDepositDatum, addressFromData } from "@zk-defi/protocol/plutus";
import { withdrawableShares, poolBalance } from "@zk-defi/protocol/tx";

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
function recipientKey(recipient, recipientInt) {
  let recipientPkh;
  try {
    recipientPkh = paymentKeyHash(recipient);
  } catch {
    throw bad("recipient must be a key payment address");
  }
  if (pkhToInt(recipientPkh) !== recipientInt) throw bad("the proof is bound to a different recipient");
  return recipientPkh;
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
// runner: { borrow(args), unlock(args), withdraw(args), findDeposit(ref) }   (tx-runner.mjs)
// vkeys:  { borrow, settlement, lender } as snarkjs verification key JSON
export function createRelayer({
  chain, runner, vkeys, retryMs = 15_000, attempts = 3,
  limits = { perRecipientPerDay: 3, perDay: 50 }, now = Date.now,
}) {
  // Relayed transactions of the current UTC day: in total and per payout key.
  let day = null, total = 0, perKey = new Map();
  const quota = (key) => {
    const today = Math.floor(now() / 86_400_000);
    if (today !== day) { day = today; total = 0; perKey = new Map(); }
    if (total >= limits.perDay) throw new RelayError(429, "rate_limited", "the relayer's daily budget is used up; try again tomorrow or submit the transaction yourself");
    if (key && (perKey.get(key) ?? 0) >= limits.perRecipientPerDay) {
      throw new RelayError(429, "rate_limited", "this payout key reached its daily limit of relayed transactions");
    }
  };
  const count = (key) => { total += 1; if (key) perKey.set(key, (perKey.get(key) ?? 0) + 1); };
  // The caller gets the hash once the transaction is submitted (the client
  // follows the chain itself); the next relayed transaction waits until this
  // one is confirmed (`settled`), so it sees the relayer's new change output.
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then((r) => r?.settled).catch(() => {});
    return run.then(({ settled, ...result }) => result);
  };
  // Another transaction may spend the pool between our read and our submit. The
  // proof stays valid as long as its root is unchanged, so build again on the
  // new pool (the attempt re-reads it and re-checks the root).
  const withRetry = async (attempt) => {
    for (let i = 1; ; i++) {
      try {
        return await attempt();
      } catch (e) {
        if (e?.code !== "pool_moved" || i >= attempts) throw e;
        await new Promise((r) => setTimeout(r, retryMs));
      }
    }
  };

  return {
    // body: { proof, publicSignals, recipient }
    // publicSignals: [group_root, loan_nullifier, external_nullifier, recipient]
    async borrow(body = {}) {
      const { proof, publicSignals, recipient } = body;
      checkProofShape(proof);
      const [root, nullifier, ext, recipientInt] = parseSignals(publicSignals, 4);
      const recipientPkh = recipientKey(recipient, recipientInt);
      const { pool } = await chain.state();
      const d = pool.datum;
      if (ext !== d.external_nullifier) {
        throw bad("public signals do not match the pool parameters");
      }
      await verify(vkeys.borrow, publicSignals, proof);

      quota(recipientPkh);
      return exclusive(() => withRetry(async () => {
        const { pool: live, sets } = await chain.state({ fresh: true });
        if (live.datum.group_root !== root) throw stale("the deposit set changed; prove again against the new root");
        if (sets.usedLoans.includes(nullifier)) throw new RelayError(409, "used", "this deposit already backed a loan");
        quota(recipientPkh);
        const loans = await sets.borrow(nullifier);
        const out = await runner.borrow({
          pool: live, proof, nullifier, recipient, recipientPkh, loansProof: loans.proof, newLoansRoot: loans.newRoot,
        });
        count(recipientPkh);
        return out;
      }));
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

      quota(null);
      return exclusive(() => withRetry(async () => {
        const { pool: live } = await chain.state({ fresh: true });
        if (live.datum.repaid_root !== repaidRoot) throw stale("the repaid set changed; prove again against the new root");
        quota(null);
        const out = await runner.unlock({ pool: live, proof, deposit, unlockTo });
        count(null);
        return out;
      }));
    },

    // body: { proof, publicSignals, recipient }
    // publicSignals: [lender_root, withdraw_nullifier, lender_external_nullifier, recipient]
    async withdraw(body = {}) {
      const { proof, publicSignals, recipient } = body;
      checkProofShape(proof);
      const [root, nullifier, ext, recipientInt] = parseSignals(publicSignals, 4);
      const recipientPkh = recipientKey(recipient, recipientInt);
      const { pool } = await chain.state();
      if (ext !== pool.datum.lender_external_nullifier) throw bad("public signals do not match the pool parameters");
      await verify(vkeys.lender, publicSignals, proof);

      quota(recipientPkh);
      return exclusive(() => withRetry(async () => {
        const { pool: live, sets } = await chain.state({ fresh: true });
        if (live.datum.lender_root !== root) throw stale("the lender set changed; prove again against the new root");
        if (sets.withdrawnNotes.includes(nullifier)) throw new RelayError(409, "used", "this share was already withdrawn");
        if (withdrawableShares(live.datum, poolBalance(live)) < 1n) {
          throw new RelayError(409, "no_liquidity", "not enough free liquidity for a share; wait for repayments");
        }
        quota(recipientPkh);
        const withdrawn = await sets.withdraw(nullifier);
        const out = await runner.withdraw({
          pool: live, proof, nullifier, recipient, recipientPkh,
          withdrawnProof: withdrawn.proof, newWithdrawnRoot: withdrawn.newRoot,
        });
        count(recipientPkh);
        return out;
      }));
    },
  };
}
