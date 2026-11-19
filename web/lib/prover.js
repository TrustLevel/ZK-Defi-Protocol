// Main-thread side of the proving worker: one worker, one request per id.
// prove(kind, input, onStage) -> { proof, publicSignals, compressed, timings }
//   kind: "append" | "borrow" | "repay" | "settlement" | "lender"
//   onStage("witness" | "proving" | "verifying")

let worker;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/prover.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.stage) return p.onStage?.(data.stage);
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data);
  };
  return worker;
}

export function prove(kind, input, onStage) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onStage });
    getWorker().postMessage({ id, kind, input });
  });
}
