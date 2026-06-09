import type { FastifyInstance } from "fastify";
import { BriefSchema } from "../types.ts";
import { proposePlan } from "../agent/orchestrator.ts";
import { resolveAccountId } from "../auth/index.ts";

let planCounter = 0;

export async function planRoutes(app: FastifyInstance) {
  // POST /plan — run the (deterministic, pre-LLM) planner: search → score → propose a plan.
  // Proposes only; books nothing. Stream the trip's events via GET /stream/:tripId.
  app.post("/plan", async (req, reply) => {
    const parsed = BriefSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_brief", issues: parsed.error.issues });
    }
    const tripId = `trip_${Date.now().toString(36)}_p${planCounter++}`;
    const plan = await proposePlan(tripId, parsed.data, resolveAccountId(req));
    return plan;
  });
}
