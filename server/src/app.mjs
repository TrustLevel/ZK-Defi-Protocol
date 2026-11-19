/**
 * HTTP API of the M4 backend. Everything it serves is public chain data; it
 * never receives a secret or a note. Dependencies are injected so the routes
 * are testable without the chain.
 *
 *   GET  /api/state          pool UTxO + decoded datum + both trees' leaves
 *   GET  /api/utxos/:txHash  outputs of a transaction (for the browser's tx builder)
 *   GET  /api/cost-models    Plutus cost models of the current epoch (same)
 *   POST /api/evaluate {tx}  script budgets for a transaction built in the browser
 *   POST /api/submit   {tx}  submit a transaction signed in the browser
 *   POST /api/relay/borrow   relayer builds, pays and submits a borrow (see relayer.mjs)
 *   POST /api/relay/unlock   relayer builds, pays and submits an unlock
 *   POST /api/events         anonymous usage counters (see analytics.mjs)
 *   GET  /api/analytics      the counters, public
 */
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { IndexLagError } from "./chain-service.mjs";
import { EVENT } from "./analytics.mjs";

// BigInt-safe JSON: every integer of the protocol goes out as a decimal string.
const toJson = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function buildApp({ chain, txService, relayer, analytics, deployment, logger = false }) {
  // Unknown fields are refused, not silently dropped (Fastify's default).
  const app = Fastify({ logger, bodyLimit: 64 * 1024, ajv: { customOptions: { removeAdditional: false } } });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof IndexLagError) return reply.code(503).header("retry-after", "5").send({ error: "indexing", message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || "bad_request", message: err.message });
    app.log.error(err);
    return reply.code(502).send({ error: "upstream", message: err.message });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/state", async () => {
    const { pool, leaves, deposits, activity = [], at } = await chain.state();
    return toJson({
      deployment: { network: deployment.network, policyId: deployment.policyId, poolAddress: deployment.poolAddress, collateralAddress: deployment.collateralAddress },
      pool: { utxo: pool.utxo, datum: pool.datum },
      leaves,
      deposits,
      activity,
      indexedAt: at,
    });
  });

  // Outputs of a transaction, for the browser's transaction builder (reference
  // inputs such as the parked verification keys).
  app.get("/api/utxos/:txHash", {
    schema: { params: { type: "object", properties: { txHash: { type: "string", pattern: "^[0-9a-f]{64}$" } } } },
  }, async (req) => toJson(await txService.utxos(req.params.txHash)));

  // Plutus cost models of the current epoch: the browser's builder needs them for
  // the script integrity hash (Mesh's defaults may differ from the network's).
  app.get("/api/cost-models", async () => txService.costModels());

  const txBody = { body: { type: "object", required: ["tx"], properties: { tx: { type: "string", pattern: "^[0-9a-fA-F]+$", maxLength: 32768 } } } };
  app.post("/api/evaluate", { schema: txBody }, async (req) => toJson({ redeemers: await txService.evaluate(req.body.tx) }));
  app.post("/api/submit", { schema: txBody }, async (req) => ({ txHash: await txService.submit(req.body.tx) }));

  if (relayer) {
    const relayLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
    app.post("/api/relay/borrow", relayLimit, async (req) => relayer.borrow(req.body));
    app.post("/api/relay/unlock", relayLimit, async (req) => relayer.unlock(req.body));
  }

  if (analytics) {
    // One request carries the events of one step only, so a request never links two steps.
    app.post("/api/events", {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { body: { type: "object", additionalProperties: false, required: ["events"], properties: { events: { type: "array", maxItems: 20, items: EVENT } } } },
    }, async (req, reply) => {
      for (const e of req.body.events) analytics.record(e);
      return reply.code(204).send();
    });
    app.get("/api/analytics", async () => analytics.summary());
  }
  return app;
}
