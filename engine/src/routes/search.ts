import type { FastifyInstance } from "fastify";
import { BriefSchema } from "../types.ts";
import { runSearch } from "../search/service.ts";

let tripCounter = 0;

export async function searchRoutes(app: FastifyInstance) {
  // POST /search — validate a brief, run a scored deal search, return ranked offers.
  // Read-only: finds deals, books nothing (booking arrives in Chunk 3).
  app.post("/search", async (req, reply) => {
    const parsed = BriefSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_brief", issues: parsed.error.issues });
    }
    const tripId = `trip_${Date.now().toString(36)}_${tripCounter++}`;
    const result = await runSearch(tripId, parsed.data);
    return { tripId, ...result };
  });
}
