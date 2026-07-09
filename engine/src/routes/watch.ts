import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId, actsFor } from "../auth/index.ts";
import { bookings } from "../booking/store.ts";
import { getTripWatch, listWatchesForAccount, enableTripWatch, approveWatchCap } from "../watch/service.ts";
import { config } from "../config.ts";
import { xConfigured } from "../watch/x.ts";

export async function watchRoutes(app: FastifyInstance) {
  app.get("/watch/capabilities", async () => ({
    enabled: config.watch.enabled,
    pricingModel: "pass_through",
    marginPercent: config.watch.marginPercent,
    defaultCapUsd: config.watch.defaultCapUsd,
    subscriberCapUsd: config.watch.subscriberCapUsd,
    alertsIntervalMin: config.watch.alertsIntervalMin,
    xAlerts: xConfigured(),
  }));

  app.get("/watch", async (req) => {
    const accountId = resolveAccountId(req);
    return {
      watches: listWatchesForAccount(accountId).map((w) => ({ ...w, pricing: getTripWatch(w.bookingId)?.pricing })),
    };
  });

  app.get<{ Params: { bookingId: string } }>("/watch/:bookingId", async (req, reply) => {
    const b = bookings.get(req.params.bookingId);
    if (!b || !actsFor(req, b.accountId)) return reply.status(404).send({ error: "not_found" });
    const w = getTripWatch(req.params.bookingId);
    if (!w) return { enabled: false, bookingId: b.id, tripId: b.tripId };
    return w;
  });

  const EnableBody = z.object({
    capUsd: z.number().positive().max(100).optional(),
    alertsOn: z.boolean().optional(),
  });
  app.post<{ Params: { bookingId: string } }>("/watch/:bookingId/enable", async (req, reply) => {
    const b = bookings.get(req.params.bookingId);
    if (!b || !actsFor(req, b.accountId)) return reply.status(404).send({ error: "not_found" });
    const p = EnableBody.safeParse(req.body ?? {});
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    const w = await enableTripWatch(req.params.bookingId, p.data);
    if (!w) return reply.status(409).send({ error: "booking_not_active" });
    return getTripWatch(req.params.bookingId);
  });

  const ApproveCapBody = z.object({ additionalUsd: z.number().positive().max(50).default(5) });
  app.post<{ Params: { bookingId: string } }>("/watch/:bookingId/approve-cap", async (req, reply) => {
    const b = bookings.get(req.params.bookingId);
    if (!b || !actsFor(req, b.accountId)) return reply.status(404).send({ error: "not_found" });
    const p = ApproveCapBody.safeParse(req.body ?? {});
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    const w = approveWatchCap(req.params.bookingId, p.data.additionalUsd);
    if (!w) return reply.status(404).send({ error: "watch_not_found" });
    return getTripWatch(req.params.bookingId);
  });
}
