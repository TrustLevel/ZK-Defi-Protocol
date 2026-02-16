//// Helper functions for V3 ZK-privacy enhanced lending protocol
//// These functions support the new Deposit Contract and RepayAnonymous flows

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of}
use cardano/script_context.{ScriptInfo, Spending}
use cardano/transaction.{Input, Output, OutputReference, Transaction}

/// Checks if an output contains the specified beacon token
/// Used to identify contract UTXOs by their beacon tokens
pub fn has_valid_beacon(
  output: Output,
  beacon_policy: PolicyId,
  beacon_name: AssetName,
) -> Bool {
  quantity_of(output.value, beacon_policy, beacon_name) == 1
}

/// Finds the input that matches the given output reference
/// Searches both inputs and reference_inputs (for read-only UTXOs)
/// Returns None if the reference doesn't exist
pub fn find_input_by_ref(
  tx: Transaction,
  output_ref: OutputReference,
) -> Option<Input> {
  // First try regular inputs (spent UTXOs)
  when list.find(tx.inputs, fn(input) { input.output_reference == output_ref }) is {
    Some(input) -> Some(input)
    // If not found in inputs, try reference_inputs (read-only UTXOs)
    None ->
      list.find(
        tx.reference_inputs,
        fn(input) { input.output_reference == output_ref },
      )
  }
}

/// Gets the input being spent by the current script invocation
/// Fails if the script purpose is not Spending
pub fn get_own_input(tx: Transaction, info: ScriptInfo) -> Input {
  expect Spending { output: own_ref, .. } = info
  expect Some(input) =
    list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
  input
}

/// Sums all value paid to the given address across all transaction outputs
/// Returns the total Value sent to that address
pub fn value_paid_to_address(
  outputs: List<Output>,
  address: Address,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(output, acc) {
      if output.address == address {
        acc + lovelace_of(output.value)
      } else {
        acc
      }
    },
  )
}

/// Verifies ZK proof hash is valid (32 bytes, non-zero)
/// Used to ensure proof hashes meet requirements before accepting them
pub fn verify_zk_proof_hash(proof_hash: ByteArray) -> Bool {
  // Must be exactly 32 bytes (Blake2b-256 output)
  let valid_length = builtin.length_of_bytearray(proof_hash) == 32

  // Must not be all zeros
  let non_zero =
    proof_hash != #"0000000000000000000000000000000000000000000000000000000000000000"

  valid_length && non_zero
}

/// Gets the lovelace amount from an output's value
/// Convenience function for extracting ADA amounts
pub fn get_ada_amount(output: Output) -> Int {
  lovelace_of(output.value)
}

/// Finds all outputs going to a specific script address
/// Used to collect all outputs to a particular contract
pub fn find_outputs_to_script(
  outputs: List<Output>,
  script_hash: ScriptHash,
) -> List<Output> {
  list.filter(
    outputs,
    fn(output) {
      when output.address.payment_credential is {
        Script(hash) -> hash == script_hash
        _ -> False
      }
    },
  )
}

/// Verifies that a commitment is valid (32 bytes, non-zero)
/// Poseidon commitments should be 32 bytes (256 bits)
pub fn verify_commitment(commitment: ByteArray) -> Bool {
  // Must be exactly 32 bytes
  let valid_length = builtin.length_of_bytearray(commitment) == 32

  // Must not be all zeros
  let non_zero =
    commitment != #"0000000000000000000000000000000000000000000000000000000000000000"

  valid_length && non_zero
}
