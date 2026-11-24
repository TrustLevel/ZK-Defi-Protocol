// The five verification keys and the reference scripts sit at the park address of
// every deployment. That address must be unspendable, so that no one can move the
// keys the validators read at fixed references. This test derives the address from
// the source in contracts/validators/always_false.ak:
//
//   validator always_false { else(_) { False } }
//
// Its compiled program (in contracts/plutus.json) always fails. The park address's
// script hash is blake2b-224 over that program's flat bytes, without the CBOR
// bytestring wrapper a ledger Plutus script carries. A spend would have to present a
// script whose bytes hash to it; the only such bytes are the bare flat program, which
// does not deserialize as a Plutus script (it starts with a CBOR integer, not a
// bytestring), and the program itself returns False. No transaction can spend it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveScriptHash, applyCborEncoding, serializePlutusScript } from "@meshsdk/core";

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const blueprint = json("../../../contracts/plutus.json");
const PARK_HASH = "be5ab5bca183f1f8274d29f6acd263b5800217a7a56955936b9775d9";
const DEPLOYMENTS = ["preprod-m3-ada.json", "preprod-m3-usd.json"];

const alwaysFalse = blueprint.validators.find((v) => v.title === "always_false.always_false.else");

test("the always_false validator is in the blueprint", () => {
  assert.ok(alwaysFalse, "always_false.always_false.else missing from contracts/plutus.json");
  assert.equal(alwaysFalse.compiledCode, "5101010023259800a508a4d136564004ae69");
});

test("the park address derives from the always_false program", () => {
  // compiledCode is one CBOR bytestring (header 0x51: 17 bytes) around the flat program.
  assert.equal(alwaysFalse.compiledCode.slice(0, 2), "51");
  const flat = alwaysFalse.compiledCode.slice(2);
  assert.equal(flat.length / 2, 0x11);
  // Hashing the blueprint's compiledCode as the script bytes hashes the flat program.
  assert.equal(resolveScriptHash(alwaysFalse.compiledCode, "V3"), PARK_HASH);
  const address = serializePlutusScript({ code: alwaysFalse.compiledCode, version: "V3" }, undefined, 0).address;
  for (const file of DEPLOYMENTS) {
    assert.equal(json(`../deployments/${file}`).vkeyParkAddress, address, file);
  }
});

test("the bare flat program is not a well-formed script, and the wrapped one is another hash", () => {
  const flat = alwaysFalse.compiledCode.slice(2);
  // CBOR major type of the first byte: 0 (unsigned integer), not 2 (bytestring).
  assert.equal(parseInt(flat.slice(0, 2), 16) >> 5, 0);
  // The well-formed script (the program with its bytestring wrapper) hashes to the
  // blueprint hash, not to the park hash.
  assert.equal(resolveScriptHash(applyCborEncoding(alwaysFalse.compiledCode), "V3"), alwaysFalse.hash);
  assert.notEqual(alwaysFalse.hash, PARK_HASH);
});
