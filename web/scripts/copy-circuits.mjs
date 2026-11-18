// Copy the circuit artifacts the browser proves with into public/circuits/
// (generated; not committed). Same files the CLI and the tests use.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../circuits");
const OUT = path.resolve(HERE, "../public/circuits");
const CIRCUITS = {
  append: ["append_proof", "verification_key_append"],
  borrow: ["collateral_semaphore", "verification_key_semaphore"],
  repay: ["repay_proof", "verification_key_repay"],
  settlement: ["settlement_proof", "verification_key_settlement"],
};

fs.mkdirSync(OUT, { recursive: true });
for (const [kind, [circuit, vkey]] of Object.entries(CIRCUITS)) {
  fs.copyFileSync(path.join(SRC, `${circuit}_js/${circuit}.wasm`), path.join(OUT, `${kind}.wasm`));
  fs.copyFileSync(path.join(SRC, `keys/${circuit}_final.zkey`), path.join(OUT, `${kind}.zkey`));
  fs.copyFileSync(path.join(SRC, `keys/${vkey}.json`), path.join(OUT, `${kind}.vkey.json`));
}
console.log(`circuits copied to ${path.relative(process.cwd(), OUT)}`);
