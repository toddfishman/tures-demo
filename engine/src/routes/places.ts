import type { FastifyInstance } from "fastify";
import { PlaceSchema, upsertPlace, listPlaces, removePlace, tasteSignal } from "../places/index.ts";
import { resolveAccountId } from "../auth/index.ts";

export async function placeRoutes(app: FastifyInstance) {
  // POST /places — mark a place visited + rate it (upsert by name).
  app.post("/places", async (req, reply) => {
    const p = PlaceSchema.safeParse((req.body as any)?.place ?? req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    return upsertPlace(resolveAccountId(req), p.data);
  });

  // GET /places — the account's "where you've been", best-rated first, + the derived taste signal.
  app.get("/places", async (req) => {
    const accountId = resolveAccountId(req);
    return { places: listPlaces(accountId), taste: tasteSignal(accountId) };
  });

  // DELETE /places/:name — remove a place.
  app.delete<{ Params: { name: string } }>("/places/:name", async (req, reply) => {
    const ok = removePlace(resolveAccountId(req), decodeURIComponent(req.params.name));
    if (!ok) return reply.status(404).send({ error: "not_found" });
    return { ok: true };
  });
}
