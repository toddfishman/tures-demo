import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBrief } from "../agent/parse.ts";

const ParseBody = z.object({ text: z.string().min(3) });

export async function parseRoutes(app: FastifyInstance) {
  // POST /parse — prose → structured Brief (+ the assumptions made). The chat's free-text
  // composer calls this before /plan.
  app.post("/parse", async (req, reply) => {
    const parsed = ParseBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    return parseBrief(parsed.data.text);
  });
}
