// The parameter chain must reproduce the scripts of a deployment of the current
// blueprint (policy, hashes and addresses as created on-chain). The pool NFT
// policy is unchanged since the lender-side M4 deployment, so it is checked
// against that one; the validator hashes changed with the asset pools and are
// checked against the asset-pool deployment once it exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveScripts } from "../src/scripts.mjs";

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const blueprint = json("../../../contracts/plutus.json");
const m4 = json("../deployments/preprod-m4-lend.json");

test("deriveScripts reproduces the pool NFT policy of the lender-side M4 deployment", () => {
  const S = deriveScripts(blueprint, m4.seed, m4.vkeys);
  assert.equal(S.POLICY_ID, m4.policyId);
  assert.equal(S.POOL_NFT_UNIT, m4.policyId + "504f4f4c");
});

test.todo("deriveScripts reproduces the asset-pool deployment (hashes and addresses)");
