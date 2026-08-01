// /signals — situational awareness for a trip. Locate the destination, return ranked signals
// (weather, air, events, advisories, transit, traffic) from real sources. Read-only; books nothing,
// moves no money. `deep:true` adds the Claude web scout (slower, richer). This is the surface the
// front-end "Trip Radar" reads, and the same gather the background watcher runs.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gatherSignals } from "../signals/service.ts";
import { providerStatus } from "../signals/registry.ts";

const Body = z.object({
  destination: z.string().min(2),
  origin: z.string().optional(),
  departDate: z.string().optional(),
  returnDate: z.string().optional(),
  // Include the Claude web scout (real-time events/advisories/transit). Off by default so the
  // radar paints instantly from the fast keyless providers; the deep pass is opt-in.
  deep: z.boolean().optional(),
});

export async function signalRoutes(app: FastifyInstance) {
  app.post("/signals", async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    const r = await gatherSignals(
      { destination: p.data.destination, origin: p.data.origin, departDate: p.data.departDate, returnDate: p.data.returnDate },
      { deep: !!p.data.deep },
    );
    if (!r.located) return reply.status(422).send({ error: "could_not_locate_destination", destination: p.data.destination });
    return {
      destination: r.context?.label,
      location: r.context ? { lat: r.context.lat, lng: r.context.lng } : undefined,
      deep: !!p.data.deep,
      signals: r.signals,
      providers: r.providers,
    };
  });

  // GET /signals/providers — what's wired and configured (the honest capability surface).
  app.get("/signals/providers", async () => ({ providers: providerStatus() }));
}
