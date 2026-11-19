// The four steps of a position and the two of a pool share, as run from the
// browser. Proofs are generated here (Web Worker); deposit, repay and buying a
// share are built here and signed by the connected account; borrow, unlock and
// withdrawing a share go to the relayer as proofs.
//
// on(event) reports progress for the UI:
//   { type: "proof", kind, stage }       witness | proving | verifying | done
//   { type: "sign" }                     waiting for the wallet
//   { type: "submitted", txHash }
//   { type: "confirming" }               waiting for the chain and the index
//   { type: "retry", reason }            the pool moved; proving again
import { MeshTxBuilder, deserializeAddress } from "@meshsdk/core";
import {
  appendInput, borrowInput, repayInput, settlementInput, lenderWithdrawInput, computeRepayNullifier,
} from "@zk-defi/protocol/crypto";
import { deriveScripts } from "@zk-defi/protocol/scripts";
import { buildDeposit, buildRepay, buildAddLiquidity, buildCollateralSplit, hasCollateral } from "@zk-defi/protocol/tx";
import deployment from "@zk-defi/protocol/deployments/preprod-m4-lend.json";
import blueprint from "../../contracts/plutus.json";
import { getState, fetcher, evaluator, submitTx, relayBorrow, relayUnlock, relayWithdraw, ApiError } from "./api";
import { prove } from "./prover";
import { payerOf } from "./wallet";

export const S = deriveScripts(blueprint, deployment.seed, deployment.vkeys);
export { deployment };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newBuilder = () => new MeshTxBuilder({ fetcher, evaluator });

// Another user's transaction spent the pool first, or changed the root the proof
// was made against: build and prove again on the new state.
const isContention = (e) =>
  (e instanceof ApiError && (e.code === "stale" || e.code === "pool_moved"))
  || /BadInputsUTxO|All inputs are spent|UnknownUtxo/i.test(String(e?.message));

async function withRetry(on, attempt, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!isContention(e) || i >= tries) throw e;
      on({ type: "retry", reason: "Someone else used the pool at the same moment. Proving again on the new state." });
      await sleep(8000);
    }
  }
}

async function proveStep(on, kind, input) {
  const out = await prove(kind, input, (stage) => on({ type: "proof", kind, stage }));
  on({ type: "proof", kind, stage: "done", timings: out.timings });
  return out;
}

// Poll the backend until the step shows in the chain state.
export async function waitFor(on, predicate, what) {
  on({ type: "confirming" });
  for (let i = 0; i < 90; i++) {
    const state = await getState();
    if (predicate(state)) return state;
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for the ${what} to appear on-chain.`);
}

async function signAndSubmit(on, account, unsigned) {
  on({ type: "sign" });
  const signed = await account.wallet.signTx(unsigned);
  const txHash = await submitTx(signed);
  on({ type: "submitted", txHash });
  return txHash;
}

// Script transactions need a pure-ADA UTxO as collateral. If the account has
// none, send 5 ADA to itself first (one extra signature).
export async function ensureCollateral(on, account) {
  const payer = await payerOf(account);
  if (payer.collateral || hasCollateral(payer.utxos)) return;
  on({ type: "collateral" });
  const unsigned = await buildCollateralSplit(newBuilder(), { payer });
  await signAndSubmit(on, account, unsigned);
  on({ type: "confirming" });
  for (let i = 0; i < 60 && !hasCollateral((await payerOf(account)).utxos); i++) await sleep(5000);
}

// 1. Deposit from account A. The note must already be backed up.
// onSubmitted(deposit) lets the caller store the deposit reference at once.
export async function deposit(on, account, note, onSubmitted) {
  await ensureCollateral(on, account);
  const txHash = await withRetry(on, async () => {
    const state = await getState();
    const a = appendInput({ leavesBefore: state.leaves.commitments, leaf: note.commitment });
    const { compressed } = await proveStep(on, "append", a.input);
    const unsigned = await buildDeposit(newBuilder(), {
      S, deployment, pool: state.pool, commitment: note.commitment, appendProof: compressed,
      newGroupRoot: a.newRoot, unlockTo: account.address, payer: await payerOf(account),
    });
    return signAndSubmit(on, account, unsigned);
  });
  // outputs: 0 = pool, 1 = the deposit
  onSubmitted({ txHash, outputIndex: 1 });
  return waitFor(on, (s) => s.leaves.commitments.includes(note.commitment), "collateral");
}

// 2. Borrow: the relayer submits; the loan goes to `recipient` (account B).
export async function borrow(on, note, recipient) {
  const recipientPkh = deserializeAddress(recipient).pubKeyHash;
  if (!recipientPkh) throw new Error("The loan must go to a wallet address.");
  let nullifier;
  await withRetry(on, async () => {
    const state = await getState();
    const b = borrowInput({
      commitments: state.leaves.commitments, index: state.leaves.commitments.indexOf(note.commitment),
      secret: note.secret, ratio: state.pool.datum.collateral_ratio, recipientPkh,
    });
    nullifier = b.nullifier;
    const { proof, publicSignals } = await proveStep(on, "borrow", b.input);
    on({ type: "relaying" });
    const { txHash } = await relayBorrow(proof, publicSignals, recipient);
    on({ type: "submitted", txHash });
  });
  return waitFor(on, (s) => s.pool.datum.used_nullifiers.includes(nullifier), "loan");
}

// 3. Repay from account B: principal + interest; R enters the repaid set.
export async function repay(on, account, note) {
  await ensureCollateral(on, account);
  const R = computeRepayNullifier(note.secret);
  await withRetry(on, async () => {
    const state = await getState();
    const index = state.leaves.commitments.indexOf(note.commitment);
    const r = repayInput({ commitments: state.leaves.commitments, index, secret: note.secret, ratio: state.pool.datum.collateral_ratio });
    const a = appendInput({ leavesBefore: state.leaves.repaid, leaf: R });
    const { compressed: proof } = await proveStep(on, "repay", r.input);
    const { compressed: appendProof } = await proveStep(on, "append", a.input);
    const unsigned = await buildRepay(newBuilder(), {
      S, deployment, pool: state.pool, proof, nullifier: r.nullifier, R, appendProof,
      newRepaidRoot: a.newRoot, payer: await payerOf(account),
    });
    return signAndSubmit(on, account, unsigned);
  });
  return waitFor(on, (s) => s.leaves.repaid.includes(R), "repayment");
}

// 4. Unlock: the relayer submits; the collateral returns to the deposit's unlock_to.
export async function unlock(on, note) {
  const R = computeRepayNullifier(note.secret);
  const ref = `${note.deposit.txHash}#${note.deposit.outputIndex}`;
  await withRetry(on, async () => {
    const state = await getState();
    const s = settlementInput({ commitment: note.commitment, secret: note.secret, repaid: state.leaves.repaid, index: state.leaves.repaid.indexOf(R) });
    const { proof, publicSignals } = await proveStep(on, "settlement", s.input);
    on({ type: "relaying" });
    const { txHash } = await relayUnlock(proof, publicSignals, note.deposit);
    on({ type: "submitted", txHash });
  });
  return waitFor(on, (s) => !s.deposits.has(ref), "unlock");
}

// Lend: buy one pool share from the connected account (account A) at the
// current price; the note's leaf enters the lender tree. The note must already
// be backed up. onSubmitted(txHash) lets the caller store it at once.
export async function lend(on, account, note, onSubmitted) {
  await ensureCollateral(on, account);
  const txHash = await withRetry(on, async () => {
    const state = await getState();
    const a = appendInput({ leavesBefore: state.leaves.lenders, leaf: note.commitment });
    const { compressed } = await proveStep(on, "append", a.input);
    const unsigned = await buildAddLiquidity(newBuilder(), {
      S, deployment, pool: state.pool, commitment: note.commitment, appendProof: compressed,
      newLenderRoot: a.newRoot, payer: await payerOf(account),
    });
    return signAndSubmit(on, account, unsigned);
  });
  onSubmitted(txHash);
  return waitFor(on, (s) => s.leaves.lenders.includes(note.commitment), "share");
}

// Withdraw one share: the relayer submits; the current share price goes to
// `recipient` (account B).
export async function withdraw(on, note, recipient) {
  const recipientPkh = deserializeAddress(recipient).pubKeyHash;
  if (!recipientPkh) throw new Error("The withdrawal must go to a wallet address.");
  let nullifier;
  await withRetry(on, async () => {
    const state = await getState();
    const w = lenderWithdrawInput({
      notes: state.leaves.lenders, index: state.leaves.lenders.indexOf(note.commitment), secret: note.secret, recipientPkh,
    });
    nullifier = w.nullifier;
    const { proof, publicSignals } = await proveStep(on, "lender", w.input);
    on({ type: "relaying" });
    const { txHash } = await relayWithdraw(proof, publicSignals, recipient);
    on({ type: "submitted", txHash });
  });
  return waitFor(on, (s) => s.pool.datum.lender_nullifiers.includes(nullifier), "withdrawal");
}
