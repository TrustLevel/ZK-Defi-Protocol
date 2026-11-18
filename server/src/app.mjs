/**
 * HTTP API of the M4 backend. Everything it serves is public chain data; it
 * never receives a secret or a note. Dependencies are injected so the routes
 * are testable without the chain.
 *
 *   GET  /api/state          pool UTxO + decoded datum + both trees' leaves
 *   POST /api/evaluate {tx}  script budgets for a transaction built in the browser
 *   POST /api/submit   {tx}  submit a transaction signed in the browser
 *   POST /api/relay/borrow   relayer builds, pays and submits a borrow (see relayer.mjs)
 *   POST /api/relay/unlock   relayer builds, pays and submits an unlock
 */
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { IndexLagError } from "./chain-service.mjs";

// BigInt-safe JSON: every integer of the protocol goes out as a decimal string.
const toJson = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function buildApp({ chain, txService, relayer, deployment, logger = false }) {
  const app = Fastify({ logger, bodyLimit: 64 * 1024 });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof IndexLagError) return reply.code(503).header("retry-after", "5").send({ error: "indexing", message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || "bad_request", message: err.message });
    app.log.error(err);
    return reply.code(502).send({ error: "upstream", message: err.message });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/state", async () => {
    const { pool, leaves, at } = await chain.state();
    return toJson({
      deployment: { network: deployment.network, policyId: deployment.policyId, poolAddress: deployment.poolAddress, collateralAddress: deployment.collateralAddress },
      pool: { utxo: pool.utxo, datum: pool.datum },
      leaves,
      indexedAt: at,
    });
  });

  const txBody = { body: { type: "object", required: ["tx"], properties: { tx: { type: "string", pattern: "^[0-9a-fA-F]+$", maxLength: 32768 } } } };
  app.post("/api/evaluate", { schema: txBody }, async (req) => toJson({ redeemers: await txService.evaluate(req.body.tx) }));
  app.post("/api/submit", { schema: txBody }, async (req) => ({ txHash: await txService.submit(req.body.tx) }));

  if (relayer) {
    const relayLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
    app.post("/api/relay/borrow", relayLimit, async (req) => relayer.borrow(req.body));
    app.post("/api/relay/unlock", relayLimit, async (req) => relayer.unlock(req.body));
  }
  return app;
}
