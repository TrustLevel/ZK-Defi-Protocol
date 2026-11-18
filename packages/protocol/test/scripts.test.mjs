// The parameter chain must reproduce the scripts the M4 pool was deployed with
// (policy, hashes and addresses as created on-chain by 2-init-pool).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveScripts } from "../src/scripts.mjs";

const json = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const blueprint = json("../../../contracts/plutus.json");
const m4 = json("../deployments/preprod-m4.json");

test("deriveScripts reproduces the M4 deployment", () => {
  const S = deriveScripts(blueprint, m4.seed, m4.vkeys);
  assert.equal(S.POLICY_ID, m4.policyId);
  assert.equal(S.POOL_NFT_UNIT, m4.policyId + "504f4f4c");
  assert.equal(S.COLLATERAL_HASH, m4.collateralHash);
  assert.equal(S.COLLATERAL_ADDRESS, m4.collateralAddress);
  assert.equal(S.POOL_HASH, m4.poolHash);
  assert.equal(S.POOL_ADDRESS, m4.poolAddress);
});
