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

function extrasOnly(scope: string | undefined): boolean {
  return scope === "flights_transport" || scope === "flights_only";
}

export async function discoverRoutes(app: FastifyInstance) {
  // POST /discover — a brief in, real trip-extras out. Finds; books nothing.
  app.post("/discover", async (req, reply) => {
    const parsed = DiscoverSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_brief", issues: parsed.error.issues });
    }
    const { userId, ...brief } = parsed.data;
    const airportGeo = await geocode(brief.destination);
    const lodgingGeo = brief.lodgingArea ? await geocode(brief.lodgingArea) : airportGeo;
    const searchGeo = lodgingGeo || airportGeo;
    if (!searchGeo) {
      return reply.status(422).send({
        error: "could_not_locate_destination",
        destination: brief.destination,
        lodgingArea: brief.lodgingArea,
      });
    }

    const scope = brief.tripScope || "full";
    const transportOnly = extrasOnly(scope);

    const memQuery = transportOnly
      ? `${searchGeo.label} airport ground transfer`
      : `${searchGeo.label} restaurants activities things to do`;
    const memories = userId ? await recall(userId, memQuery, 4) : [];

    let stays: Awaited<ReturnType<typeof searchHotels>> = [];
    let dining: Awaited<ReturnType<typeof searchDining>> = [];
    let activities: Awaited<ReturnType<typeof searchActivities>> = [];

    if (!transportOnly && scope !== "flights_only") {
      [stays, dining, activities] = await Promise.all([
        scope === "flights_stay" || scope === "full" ? searchHotels(searchGeo, brief) : Promise.resolve([]),
        scope === "full" ? searchDining(searchGeo, brief) : Promise.resolve([]),
        scope === "full" ? searchActivities(searchGeo, brief) : Promise.resolve([]),
      ]);
    }

    const transport = estimateTransport(airportGeo, lodgingGeo || airportGeo, brief);

    return {
      tripId: `disc_${Date.now().toString(36)}_${discoverCounter++}`,
      destination: { label: searchGeo.label, location: { lat: searchGeo.lat, lng: searchGeo.lng } },
      arrival: airportGeo ? { label: airportGeo.label, location: { lat: airportGeo.lat, lng: airportGeo.lng } } : undefined,
      tripScope: scope,
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
