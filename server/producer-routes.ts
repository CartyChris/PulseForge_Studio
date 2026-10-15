/**
 * End-to-end AI producer endpoints. Small, stateless steps (each well under serverless time
 * limits); the app orchestrates them and does all audio work locally:
 *   POST /api/ai/produce/plan     prompt + catalog            → ProductionSpec
 *   POST /api/ai/produce/revise   change + spec + project     → respec | edit plan
 *   POST /api/ai/produce/critique goal + metrics + project    → verdict + conservative mix commands
 * Every model reply is Zod-validated here (and again in the app) before it can touch a project.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProvider } from "./providers";
import { redactSecrets } from "./secrets";
import { chatWithJsonRetry } from "./ai-json";
import { validateProductionSpec } from "../shared/producer";
import { validateProduceRevise, validateProduceCritique } from "../shared/producer-ai";
import { PRODUCER_PLAN_SYSTEM, PRODUCER_REVISE_SYSTEM, PRODUCER_CRITIQUE_SYSTEM } from "./producer-prompts";

const base = z.object({ providerId: z.string().min(1).max(64), model: z.string().max(120).optional() });

export function registerProducerRoutes(app: FastifyInstance): void {
  app.post("/api/ai/produce/plan", async (req, reply) => {
    const body = base.extend({
      prompt: z.string().min(1).max(4000),
      catalog: z.string().max(24000).default(""),
      context: z.string().max(20000).default(""),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      const user = [
        body.data.catalog && `Sound catalog (use only these ids):\n${body.data.catalog}`,
        body.data.context && `Current project context:\n${body.data.context}`,
        `Make this beat: ${body.data.prompt}`,
      ].filter(Boolean).join("\n\n");
      const spec = await chatWithJsonRetry(provider, PRODUCER_PLAN_SYSTEM, user, body.data.model, validateProductionSpec, { maxTokens: 4000 });
      return { spec };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });

  app.post("/api/ai/produce/revise", async (req, reply) => {
    const body = base.extend({
      prompt: z.string().min(1).max(4000),
      spec: z.record(z.string(), z.unknown()),
      projectSummary: z.string().max(60000).default(""),
      catalog: z.string().max(24000).default(""),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      const user = [
        `Current production spec:\n${JSON.stringify(body.data.spec).slice(0, 12000)}`,
        body.data.projectSummary && `Live project summary (ids are real):\n${body.data.projectSummary}`,
        body.data.catalog && `Sound catalog:\n${body.data.catalog}`,
        `Change request: ${body.data.prompt}`,
      ].filter(Boolean).join("\n\n");
      const result = await chatWithJsonRetry(provider, PRODUCER_REVISE_SYSTEM, user, body.data.model, validateProduceRevise, { maxTokens: 6000 });
      return { result };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });

  app.post("/api/ai/produce/critique", async (req, reply) => {
    const body = base.extend({
      goal: z.string().max(4000).default(""),
      spec: z.record(z.string(), z.unknown()),
      metrics: z.string().max(8000),
      projectSummary: z.string().max(60000).default(""),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    try {
      const provider = getProvider(body.data.providerId);
      const user = [
        `User's goal: ${body.data.goal || "(not stated)"}`,
        `Production spec:\n${JSON.stringify(body.data.spec).slice(0, 8000)}`,
        `Render measurements:\n${body.data.metrics}`,
        body.data.projectSummary && `Project summary (ids are real):\n${body.data.projectSummary}`,
      ].filter(Boolean).join("\n\n");
      const critique = await chatWithJsonRetry(provider, PRODUCER_CRITIQUE_SYSTEM, user, body.data.model, validateProduceCritique, { maxTokens: 2500 });
      return { critique };
    } catch (e) {
      req.log.warn(redactSecrets(String(e)));
      return reply.code(502).send({ error: redactSecrets(String(e)) });
    }
  });
}
