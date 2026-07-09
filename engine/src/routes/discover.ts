// Discovery — real hotels, restaurants, things-to-do, and ground transport for a trip. Hotels +
// dining + activities come from Google Places (New); transport is a modeled estimate from the real
// airport→destination distance. Read-only; "booking" an extra is the simulated /reserve below.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BriefSchema, type OfferKind } from "../types.ts";
import { geocode } from "../geo/index.ts";
import { searchHotels, searchDining, searchActivities } from "../discovery/places.ts";
import { estimateTransport } from "../discovery/transport.ts";
import { recall } from "../mem0.ts";
import { config } from "../config.ts";

let discoverCounter = 0;

const DiscoverSchema = BriefSchema.extend({ userId: z.string().optional() });

export async function discoverRoutes(app: FastifyInstance) {
  // POST /discover — a brief in, real trip-extras out. Finds; books nothing.
  app.post("/discover", async (req, reply) => {
    const parsed = DiscoverSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_brief", issues: parsed.error.issues });
    }
    const { userId, ...brief } = parsed.data;
    const destGeo = await geocode(brief.destination);
    if (!destGeo) {
      return reply.status(422).send({ error: "could_not_locate_destination", destination: brief.destination });
    }

    const memQuery = `${destGeo.label} restaurants activities things to do`;
    const memories = userId ? await recall(userId, memQuery, 4) : [];

    const [stays, dining, activities] = await Promise.all([
      searchHotels(destGeo, brief),
      searchDining(destGeo, brief),
      searchActivities(destGeo, brief),
    ]);
    const transport = estimateTransport(destGeo, brief);

    return {
      tripId: `disc_${Date.now().toString(36)}_${discoverCounter++}`,
      destination: { label: destGeo.label, location: { lat: destGeo.lat, lng: destGeo.lng } },
      source: config.googleMapsKey ? "google-places" : "unconfigured",
      googlePlaces: !!config.googleMapsKey,
      memories,
      stays,
      dining,
      activities,
      transport,
    };
  });

  // POST /reserve — SIMULATE reserving an extra (restaurant / activity / ride). No real reservation
  // is made (those providers have no open booking API) and no money moves; returns a labeled sample
  // confirmation, consistent with the booking service's simulated path.
  app.post("/reserve", async (req, reply) => {
    const b = (req.body as any) || {};
    const kind: OfferKind | string = b.kind || "dining";
    const id = String(b.id || "");
    const title = String(b.title || "Reservation");
    if (!id) return reply.status(400).send({ error: "missing_offer_id" });

    let h = 2166136261;
    const s = id + ":reserve";
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const code = (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
    const ref = kind === "dining" ? "RES" : kind === "activity" ? "TKT" : kind === "transport" ? "RIDE" : "CONF";

    return {
      ok: true,
      simulated: true,
      kind,
      title,
      confirmation: `SAMPLE-${ref}-${code}`,
      note: "Simulated — no real reservation was made and no money moved.",
    };
  });
}
