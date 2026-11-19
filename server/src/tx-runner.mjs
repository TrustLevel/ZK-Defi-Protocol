/**
 * Builds, signs and submits the relayer's transactions with the relayer wallet
 * as the only signer and payer. Returns the hash once submitted, with `settled`:
 * a promise for the transaction being confirmed and indexed, so the next relayed
 * transaction sees the relayer's new change output and the new pool.
 */
import { MeshTxBuilder } from "@meshsdk/core";
import * as ff from "ffjavascript";
import { compressProof } from "@zk-defi/protocol/crypto";
import { buildBorrow, buildUnlock, buildWithdrawLiquidity } from "@zk-defi/protocol/tx";
import { RelayError } from "./relayer.mjs";

const SPENT_INPUT = /BadInputsUTxO|All inputs are spent|UnknownUtxo|ValueNotConservedUTxO/i;

export async function createTxRunner({ provider, S, deployment, wallet, settleMs = 20_000, pollMs = 5_000 }) {
  const address = await wallet.getChangeAddress();
  const curve = await ff.getCurveFromName("bls12381");

  async function waitConfirmed(txHash) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        if ((await provider.fetchTxInfo(txHash))?.block && (await provider.fetchUTxOs(txHash)).length) {
          await new Promise((r) => setTimeout(r, settleMs));
          return;
        }
      } catch { /* not indexed yet */ }
    }
    throw new Error(`relayed tx ${txHash} not confirmed in time`);
  }

  async function run(build) {
    const payer = { address, utxos: await provider.fetchAddressUTxOs(address) };
    let unsigned;
    try {
      unsigned = await build(new MeshTxBuilder({ fetcher: provider, evaluator: provider }), payer);
    } catch (e) {
      if (SPENT_INPUT.test(String(e?.message ?? e))) throw new RelayError(409, "pool_moved", "the pool moved while building");
      throw new RelayError(422, "evaluation_failed", `the transaction does not validate: ${String(e?.message ?? e).slice(0, 300)}`);
    }
    let txHash;
    try {
      txHash = await provider.submitTx(await wallet.signTx(unsigned));
    } catch (e) {
      if (SPENT_INPUT.test(String(e?.message ?? e))) throw new RelayError(409, "pool_moved", "the pool moved before submission");
      throw e;
    }
    // a timeout here only delays the next relayed transaction
    return { txHash, settled: waitConfirmed(txHash).catch((e) => console.log(e.message)) };
  }

  return {
    address,
    findDeposit: async ({ txHash, outputIndex }) =>
      (await provider.fetchAddressUTxOs(S.COLLATERAL_ADDRESS)).find((u) => u.input.txHash === txHash && u.input.outputIndex === outputIndex) ?? null,
    borrow: ({ pool, proof, nullifier, recipient, recipientPkh }) =>
      run((txb, payer) => buildBorrow(txb, {
        S, deployment, pool, proof: compressProof(curve, proof), nullifier, recipient, recipientPkh, payer,
      })),
    unlock: ({ pool, proof, deposit, unlockTo }) =>
      run((txb, payer) => buildUnlock(txb, { S, deployment, pool, deposit, unlockTo, proof: compressProof(curve, proof), payer })),
    withdraw: ({ pool, proof, nullifier, recipient, recipientPkh }) =>
      run((txb, payer) => buildWithdrawLiquidity(txb, {
        S, deployment, pool, proof: compressProof(curve, proof), nullifier, recipient, recipientPkh, payer,
      })),
  };
}
