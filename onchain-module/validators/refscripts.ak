//// Validator to hold utxos containing the protocol's reference scripts

use aiken/collection/pairs
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Transaction, find_input}
use functions.{is_signed_by}

validator refscripts(admin_key_hash: VerificationKeyHash) {
  spend(_datum, _redeemer, output_ref: OutputReference, this_tx: Transaction) {
    expect Some(input) = find_input(this_tx.inputs, output_ref)
    let withdrawals = this_tx.withdrawals
    let own_withdrawal = input.output.address.payment_credential
    pairs.has_key(withdrawals, own_withdrawal)
  }

  else(context: ScriptContext) {
    let this_tx: Transaction = context.transaction
    is_signed_by(this_tx.extra_signatories, admin_key_hash)
  }
}
