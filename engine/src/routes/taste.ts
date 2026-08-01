// The Taste Engine's HTTP face.
//
//   GET  /taste            → the standing print, its confidence, and what it learned
//   GET  /taste/lenses     → the canonical lens table (taste.html renders THIS, not a copy)
//   POST /taste/quiz       → save a this-or-that quiz result
//   POST /taste/lens       → preview a lens: standing dims + bent dims + which axes moved
//   POST /taste/feedback   → a correction ("I swapped A for B", "not this one") → learning
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveAccountId } from "../auth/index.ts";
import { getPrint, setQuizResult, observe, effectiveTaste, signatureFor, placeTypesFor } from "../taste/service.ts";
import { LENSES, getLens, applyLens, lensShifts } from "../taste/lens.ts";
import { confidenceOf } from "../taste/learn.ts";
import { AXES, AXIS_POLES, AXIS_PHRASE, normalizeDims } from "../taste/types.ts";
import type { Offer } from "../types.ts";

const DimsInput = z.record(z.string(), z.number());

const QuizBody = z.object({
  accountId: z.string().optional(),
  dims: DimsInput,
  tags: z.array(z.string()).optional(),
});

const LensBody = z.object({
  accountId: z.string().optional(),
  lens: z.string().optional(),
  purpose: z.array(z.string()).optional(),
  /** Preview against these dims instead of the saved print (the sample traveler on taste.html). */
  dims: DimsInput.optional(),
});

/** An offer as the client can describe it. Enough for the feature reader to do a real read. */
const OfferInput = z.object({
  id: z.string().default(""),
  kind: z.enum(["flight", "stay", "dining", "activity", "transport"]).default("stay"),
  title: z.string(),
  priceUsd: z.number().nonnegative().default(0),
  summary: z.array(z.string()).default([]),
  raw: z.record(z.string(), z.unknown()).default({}),
});

const FeedbackBody = z.object({
  accountId: z.string().optional(),
  type: z.enum(["booked", "swapped", "declined", "rated"]),
  chosen: OfferInput,
  replaced: OfferInput.optional(),
  rejected: z.array(OfferInput).default([]),
  rating: z.number().min(1).max(10).optional(),
  note: z.string().max(400).optional(),
});

function toOffer(o: z.infer<typeof OfferInput>): Offer {
  return { ...o, supplier: "client", currency: "USD" } as Offer;
}

export async function tasteRoutes(app: FastifyInstance) {
  // The axis vocabulary, so the front-end never hardcodes pole labels that could drift.
  app.get("/taste/axes", async () => ({
    axes: AXES.map((a) => ({ axis: a, poles: AXIS_POLES[a], phrases: AXIS_PHRASE[a] })),
  }));

  app.get("/taste/lenses", async () => ({ lenses: LENSES }));

  app.get<{ Querystring: { accountId?: string } }>("/taste", async (req) => {
    const accountId = resolveAccountId(req, req.query.accountId);
    const print = getPrint(accountId);
    const { total, confidence } = confidenceOf(print.evidence);
    return {
      print,
      confidence,
      evidenceTotal: total,
      // Honest state for the UI: an untouched print must not be shown as if it were learned.
      known: AXES.some((a) => print.dims[a] !== 50) || print.tags.length > 0,
      history: print.history.slice(-12).reverse(),
    };
  });

  app.post("/taste/quiz", async (req, reply) => {
    const parsed = QuizBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const accountId = resolveAccountId(req, parsed.data.accountId);
    const print = setQuizResult(accountId, { dims: parsed.data.dims, tags: parsed.data.tags });
    return { print, confidence: confidenceOf(print.evidence).confidence };
  });

  // Preview a lens without saving anything — this is what powers the two-profile panel.
  app.post("/taste/lens", async (req, reply) => {
    const parsed = LensBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { dims: override, lens: lensId, purpose } = parsed.data;

    if (override) {
      // Sample/preview path: bend the dims we were handed, no account involved.
      const standing = normalizeDims(override);
      const lens = getLens(lensId);
      const effective = applyLens(standing, lens);
      return {
        standing,
        effective,
        lens,
        shifts: lensShifts(standing, effective),
        signature: signatureFor(effective),
        placeTypes: placeTypesFor(effective),
        sample: true,
      };
    }

    const accountId = resolveAccountId(req, parsed.data.accountId);
    const t = effectiveTaste(accountId, purpose ? { tripSentiment: { purpose, pace: "balanced", avoid: [] } } : undefined, lensId);
    return {
      standing: t.standing,
      effective: t.effective,
      lens: t.lens,
      shifts: lensShifts(t.standing, t.effective),
      signature: signatureFor(t.effective),
      placeTypes: placeTypesFor(t.effective),
      confidence: t.confidence,
      known: t.known,
      sample: !t.known,
    };
  });

  // A correction from the traveler. This is the highest-value signal the engine gets — a swap
  // says more than ten bookings — so it is weighted hardest in taste/learn.ts.
  app.post("/taste/feedback", async (req, reply) => {
    const parsed = FeedbackBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const accountId = resolveAccountId(req, parsed.data.accountId);
    const print = observe(accountId, {
      type: parsed.data.type,
      chosen: toOffer(parsed.data.chosen),
      replaced: parsed.data.replaced ? toOffer(parsed.data.replaced) : undefined,
      rejected: parsed.data.rejected.map(toOffer),
      rating: parsed.data.rating,
      note: parsed.data.note,
    });
    // No learning is a legitimate outcome (the field was uniform on every axis) — say so plainly
    // rather than pretending the print moved.
    if (!print) return { learned: false, reason: "that choice did not distinguish anything we can read" };
    return { learned: true, print, confidence: confidenceOf(print.evidence).confidence, latest: print.history[print.history.length - 1] };
  });
}
