// Household routes — Memory 2.0 capture→confirm loop and the party summary.
//   POST /household/extract  — propose people found in a message (nothing is stored)
//   POST /household/remember — the user's confirmation: save the proposed people
//   GET  /household/summary  — the redacted party the planner reasons on
// Confirmed people are stored exactly like companions (encrypted `traveler` connections), so they
// flow into planning (assembleContext) and, later, the booking manifest.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addTraveler, partySummary, bookingManifest, type Companion } from "../profile/index.ts";
import { extractHousehold } from "../agent/household-extract.ts";
import { resolveAccountId } from "../auth/index.ts";

const ExtractBody = z.object({ text: z.string().min(1) });

const MemberInput = z.object({
  relationship: z.enum(["spouse", "partner", "child", "parent", "companion"]).default("companion"),
  fullName: z.string().optional(),
  age: z.number().int().min(0).max(120).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dietary: z.array(z.string()).default([]),
});
const RememberBody = z.object({ members: z.array(MemberInput).min(1).max(12) });

/** A friendly display name when the user confirmed a person without giving a name. */
function displayName(m: z.infer<typeof MemberInput>): string {
  if (m.fullName && m.fullName.trim()) return m.fullName.trim();
  const cap = m.relationship.charAt(0).toUpperCase() + m.relationship.slice(1);
  if (m.relationship === "child") return m.age != null ? `Child (${m.age})` : "Child";
  return cap;
}

export async function householdRoutes(app: FastifyInstance) {
  // Propose — never stores. The front-end shows these as confirm chips.
  app.post("/household/extract", async (req, reply) => {
    const p = ExtractBody.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request" });
    return { proposals: extractHousehold(p.data.text) };
  });

  // Confirm — the user said yes. Save each person as an encrypted companion.
  app.post("/household/remember", async (req, reply) => {
    const p = RememberBody.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: "invalid_request", issues: p.error.issues });
    const accountId = resolveAccountId(req);
    const added = [];
    for (const m of p.data.members) {
      const companion: Companion = {
        fullName: displayName(m),
        relationship: m.relationship,
        dietary: m.dietary,
        age: m.age,
        dateOfBirth: m.dateOfBirth,
        memberships: [],
      };
      added.push(await addTraveler(accountId, companion));
    }
    return { added, party: partySummary(accountId) };
  });

  // The redacted party the planner reasons on (also powers the "same crew?" prompt).
  app.get("/household/summary", async (req) => ({ party: partySummary(resolveAccountId(req)) }));

  // Pre-filled passenger manifest for the booking step — who's traveling + what Tures already has,
  // and (per the minors'-data advisory) whose exact DOB still needs collecting just-in-time.
  app.get("/household/manifest", async (req) => bookingManifest(resolveAccountId(req)));
}
