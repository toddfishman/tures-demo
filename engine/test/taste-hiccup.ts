// Tests for the Taste Engine and the Hiccup Handler.
//
// Split out from smoke.ts because these two subsystems earn their own coverage: one decides what
// gets recommended, the other can move money without being asked. Every test below either pins a
// behaviour the product promises, or pins a bug that was actually in the code.
//
// Run: node node_modules/tsx/dist/cli.mjs test/taste-hiccup.ts
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { readOffer } from "../src/taste/features.ts";
import { tasteFit } from "../src/taste/fit.ts";
import { learn } from "../src/taste/learn.ts";
import { applyLens, getLens, lensForPurpose } from "../src/taste/lens.ts";
import { triage } from "../src/hiccup/triage.ts";
import { NEUTRAL, normalizeDims, type TastePrint } from "../src/taste/types.ts";
import type { Offer } from "../src/types.ts";
import type { Booking } from "../src/booking/types.ts";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function offer(partial: Partial<Offer> & { title: string }): Offer {
  return {
    id: partial.id ?? partial.title.toLowerCase().replace(/\W+/g, "-"),
    kind: partial.kind ?? "stay",
    supplier: "test",
    title: partial.title,
    priceUsd: partial.priceUsd ?? 500,
    currency: "USD",
    raw: partial.raw ?? {},
    summary: partial.summary ?? [],
  };
}

function print(dims: Partial<typeof NEUTRAL>, evidence = 0): TastePrint {
  return {
    version: 2,
    dims: normalizeDims({ ...NEUTRAL, ...dims }),
    placeTypes: [],
    tags: [],
    signature: "",
    evidence: { pace: evidence, register: evidence, energy: evidence, palate: evidence, planning: evidence, aesthetic: evidence },
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

console.log("\nTaste Engine\n");

// 1. Word boundaries. The old scorer did haystack.includes("grand"), so "Rio Grande" read as a
//    grand hotel. This is the regression guard for that.
{
  const grande = readOffer(offer({ title: "Rio Grande Inn", summary: ["family-run"] }));
  const grand = readOffer(offer({ title: "Grand Hôtel du Palais" }));
  assert.ok((grande.dims.register ?? 50) < 45, `"Rio Grande Inn" should not read as grand (got ${grande.dims.register})`);
  assert.ok((grand.dims.register ?? 50) > 70, `"Grand Hôtel du Palais" should read as grand (got ${grand.dims.register})`);
  ok('word boundaries: "Rio Grande" is not "grand"');
}

// 2. Never guess. An offer with nothing readable must produce no axes at all, so the scorer can
//    weight taste down instead of inventing a fit.
{
  const bare = readOffer(offer({ title: "Property 4821", priceUsd: 310 }));
  assert.equal(Object.keys(bare.dims).length, 0, "an unreadable offer claims no axes");
  const fit = tasteFit(offer({ title: "Property 4821" }), normalizeDims({ ...NEUTRAL, register: 12 }));
  assert.equal(fit.coverage, 0, "no coverage on an unreadable offer");
  assert.equal(fit.fit, 0.5, "unreadable offers score neutral, not zero");
  ok("unreadable offers claim no axes and score neutral (never guessed)");
}

// 3. A neutral traveler is never pushed. This is what makes a half-built print safe.
{
  const boutique = offer({ title: "Boutique townhouse", raw: { style: "boutique" } });
  const fit = tasteFit(boutique, NEUTRAL);
  assert.equal(fit.coverage, 0, "no opinions → nothing to match against");
  assert.equal(fit.fit, 0.5);
  ok("a neutral print exerts no pull on ranking");
}

// 4. Opposite travelers rank the same two offers in opposite orders.
{
  const boutique = offer({ title: "Boutique townhouse", raw: { style: "boutique" } });
  const grandDame = offer({ title: "Grand-dame palace hotel", raw: { style: "grand-dame" } });
  const hiddenGem = normalizeDims({ ...NEUTRAL, register: 14 });
  const grandTaste = normalizeDims({ ...NEUTRAL, register: 88 });

  assert.ok(tasteFit(boutique, hiddenGem).fit > tasteFit(grandDame, hiddenGem).fit, "hidden-gem traveler prefers the boutique");
  assert.ok(tasteFit(grandDame, grandTaste).fit > tasteFit(boutique, grandTaste).fit, "grand traveler prefers the palace");
  ok("opposite prints rank the same pair in opposite orders");
}

// 5. Every pick carries its reason, including the honest negative.
{
  const grandDame = offer({ title: "Grand-dame palace hotel", raw: { style: "grand-dame" } });
  const fit = tasteFit(grandDame, normalizeDims({ ...NEUTRAL, register: 12 }));
  assert.ok(fit.reasons.length > 0, "produces a reason");
  assert.ok(fit.reasons.some((r) => r.startsWith("note:")), `expected an honest caveat, got ${JSON.stringify(fit.reasons)}`);
  ok("a mismatched pick says so out loud");
}

// 6. The lens bends outliers less than the middle — a lens should not flatten everyone.
{
  const mid = applyLens(normalizeDims({ ...NEUTRAL, register: 40 }), getLens("celebrate"));
  const already = applyLens(normalizeDims({ ...NEUTRAL, register: 88 }), getLens("celebrate"));
  const midShift = mid.register - 40;
  const alreadyShift = already.register - 88;
  assert.ok(midShift > alreadyShift, `mid-scale should move more (${midShift}) than an outlier (${alreadyShift})`);
  assert.ok(already.register <= 100, "never exceeds the pole");
  ok("a lens bends the outliers, it does not flatten the traveler");
}

// 7. Purpose prose from a brief resolves to the right lens.
{
  assert.equal(lensForPurpose(["our 10th anniversary"]).id, "celebrate");
  assert.equal(lensForPurpose(["need to decompress after a brutal quarter"]).id, "unwind");
  assert.equal(lensForPurpose(["client meetings in Zurich"]).id, "work");
  assert.equal(lensForPurpose(["something else entirely"]).id, "usual");
  ok("free-text trip purpose maps to a lens");
}

// 8. Learning from CONTRAST — the core idea. Choosing the boutique over two grand hotels teaches
//    register; choosing among three identical boutiques teaches nothing.
{
  const boutique = offer({ title: "Boutique townhouse", raw: { style: "boutique" }, priceUsd: 900 });
  const grandA = offer({ id: "g1", title: "Grand-dame palace", raw: { style: "grand-dame" }, priceUsd: 1000 });
  const grandB = offer({ id: "g2", title: "Grand Regency", raw: { style: "grand-dame" }, priceUsd: 1100 });

  const informative = learn(print({ register: 50 }), { type: "booked", chosen: boutique, rejected: [grandA, grandB] });
  assert.ok(informative.learning, "a distinguishing choice teaches something");
  assert.ok(informative.dims.register < 50, `register should fall toward the boutique (got ${informative.dims.register})`);

  // A genuinely uniform field: same style AND same price, so nothing distinguishes the pick.
  // (Price is itself a signal — a dearer boutique among cheaper ones still teaches `register`.)
  const uniform = learn(print({ register: 50 }), {
    type: "booked",
    chosen: offer({ id: "b1", title: "Boutique townhouse", raw: { style: "boutique" }, priceUsd: 900 }),
    rejected: [
      offer({ id: "b2", title: "Boutique guesthouse", raw: { style: "boutique" }, priceUsd: 900 }),
      offer({ id: "b3", title: "Boutique inn", raw: { style: "boutique" }, priceUsd: 900 }),
    ],
  });
  assert.equal(uniform.learning, null, "a choice among identical options teaches nothing");
  ok("learning comes from the contrast, not the choice");
}

// 9. A swap is the strongest signal, and learning converges rather than oscillating.
{
  const boutique = offer({ title: "Boutique townhouse", raw: { style: "boutique" } });
  const grand = offer({ id: "g", title: "Grand-dame palace", raw: { style: "grand-dame" } });

  const swap = learn(print({ register: 50 }), { type: "swapped", chosen: boutique, replaced: grand });
  const book = learn(print({ register: 50 }), { type: "booked", chosen: boutique, rejected: [grand] });
  assert.ok(50 - swap.dims.register > 50 - book.dims.register, "a correction outweighs a booking");

  // Repeat the same observation and the steps must shrink.
  let p = print({ register: 50 });
  const steps: number[] = [];
  for (let i = 0; i < 4; i++) {
    const before = p.dims.register;
    const r = learn(p, { type: "booked", chosen: boutique, rejected: [grand] });
    steps.push(Math.abs(r.dims.register - before));
    p = { ...p, dims: r.dims, evidence: r.evidence };
  }
  assert.ok(steps[0]! > steps[3]!, `steps should decay (${steps.join(" → ")})`);
  assert.ok(p.dims.register < 40, "four consistent signals should have moved the axis meaningfully");
  ok("a swap outweighs a booking, and repeated evidence converges");
}

// 10. A decline pushes away rather than toward.
{
  const grand = offer({ title: "Grand-dame palace", raw: { style: "grand-dame" } });
  const r = learn(print({ register: 70 }), { type: "declined", chosen: grand });
  assert.ok(r.dims.register < 70, `a decline should move away from the declined thing (got ${r.dims.register})`);
  ok("declining something moves the print away from it");
}

console.log("\nTaste Engine — over HTTP\n");

const app = await build();

// resolveAccountId deliberately ignores any accountId in the body — the session is the only
// authority on who you are. So every account-scoped test signs in for real.
async function signup(email: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: "POST", url: "/auth/signup", payload: { email, password: "correct-horse-1" } });
  assert.equal(res.statusCode, 200, `signup failed for ${email}: ${res.body}`);
  return { authorization: `Bearer ${res.json().token}` };
}

const taster = await signup("taster@test.com");

// 11. Quiz → persisted print with derived vocabulary, then a lens preview off it.
{
  const dims = { pace: 30, register: 20, energy: 25, palate: 80, planning: 45, aesthetic: 85 };
  const saved = await app.inject({ method: "POST", url: "/taste/quiz", headers: taster, payload: { dims, tags: ["boutique", "design-forward"] } });
  assert.equal(saved.statusCode, 200);
  const print1 = saved.json().print;
  assert.equal(print1.dims.register, 20);
  assert.ok(print1.placeTypes.includes("boutique"), "vocabulary derived from dims");
  assert.ok(print1.placeTypes.includes("design-hotel"), "high aesthetic → design-hotel");
  assert.ok(print1.signature.length > 20, "prose signature derived server-side");

  const read = await app.inject({ method: "GET", url: "/taste", headers: taster });
  assert.equal(read.json().print.dims.register, 20, "print persisted");
  assert.equal(read.json().known, true);

  const lens = await app.inject({ method: "POST", url: "/taste/lens", headers: taster, payload: { lens: "celebrate" } });
  const body = lens.json();
  assert.equal(body.standing.register, 20, "standing print unchanged by a preview");
  assert.ok(body.effective.register > body.standing.register, "the lens bends register up");
  assert.ok(body.shifts.some((s: any) => s.axis === "register"), "reports which axes moved");
  ok("quiz persists a print; lens preview bends it without saving");
}

// 12. An untouched account reads as neutral and unknown — no sample data pretending to be real.
{
  const fresh = await signup("untouched@test.com");
  const res = await app.inject({ method: "GET", url: "/taste", headers: fresh });
  const body = res.json();
  assert.equal(body.known, false, "an account with no print is honestly unknown");
  assert.equal(body.print.dims.register, 50, "defaults to neutral");
  assert.equal(body.confidence, 0);
  ok("an account with no taste reads as unknown, not as a sample");
}

// 13. Feedback learns, and an uninformative correction says so instead of faking a change.
{
  const res = await app.inject({
    method: "POST",
    url: "/taste/feedback",
    headers: taster,
    payload: {
      type: "swapped",
      chosen: { title: "Twelve-room townhouse", kind: "stay", raw: { style: "boutique" } },
      replaced: { title: "Grand-dame palace hotel", kind: "stay", raw: { style: "grand-dame" } },
      note: "too big",
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().learned, true);
  assert.ok(res.json().latest.note.includes("too big"), "keeps the traveler's own reason");

  const flat = await app.inject({
    method: "POST",
    url: "/taste/feedback",
    headers: taster,
    payload: { type: "booked", chosen: { title: "Property 9931", kind: "stay" } },
  });
  assert.equal(flat.json().learned, false, "an unreadable choice reports no learning rather than faking it");
  ok("feedback teaches the print; an unreadable one admits it learned nothing");
}

// 14. End to end: opposite prints produce different top stays from the same search.
{
  const brief = { origin: "SFO", destination: "HEL", departDate: "2026-09-12", returnDate: "2026-09-19", adults: 2, priceSensitivity: "no_limit" };
  const gemLover = await signup("gem@test.com");
  const grandLover = await signup("grand@test.com");
  await app.inject({ method: "POST", url: "/taste/quiz", headers: gemLover, payload: { dims: { ...NEUTRAL, register: 8, aesthetic: 50 } } });
  await app.inject({ method: "POST", url: "/taste/quiz", headers: grandLover, payload: { dims: { ...NEUTRAL, register: 95, aesthetic: 50 } } });

  const gem = (await app.inject({ method: "POST", url: "/search", headers: gemLover, payload: brief })).json();
  const grand = (await app.inject({ method: "POST", url: "/search", headers: grandLover, payload: brief })).json();

  const gemTop = gem.stays[0].title as string;
  const grandTop = grand.stays[0].title as string;
  assert.notEqual(gemTop, grandTop, `two opposite prints should not pick the same stay (both got "${gemTop}")`);
  assert.ok(/boutique|minimalist|sauna/i.test(gemTop), `hidden-gem traveler got "${gemTop}"`);
  assert.ok(/grand/i.test(grandTop), `grand traveler got "${grandTop}"`);
  assert.ok(gem.stays[0].taste, "the taste read is attached to the offer for the UI");
  ok("the Taste Print actually changes what gets recommended");
}

console.log("\nHiccup Handler\n");

// Triage is pure, so the interesting decisions are testable without booking anything.
function fakeBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: "bk_test",
    tripId: "trip_test",
    accountId: "acct_test",
    brief: { origin: "SFO", destination: "HEL", departDate: "2026-09-12", returnDate: "2026-09-19" } as any,
    status: "booked",
    totalUsd: 2000,
    currency: "USD",
    components: [
      { kind: "flight", offerId: "f1", supplier: "mock", title: "Finnair SFO→HEL", amountUsd: 1200, status: "confirmed", confirmation: "PNR-AAAAA" },
      { kind: "stay", offerId: "s1", supplier: "mock", title: "boutique stay in HEL", amountUsd: 800, status: "confirmed", confirmation: "CONF-BBBBB" },
    ],
    charges: [],
    violations: [],
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as Booking;
}

// 15. A short delay is watched, not acted on. This is the branch that used to rebook people.
{
  const t = triage(fakeBooking(), { kind: "delay", delayMinutes: 40 });
  assert.equal(t.action, "monitor", `a 40-minute delay should be monitored, got "${t.action}"`);
  const long = triage(fakeBooking(), { kind: "delay", delayMinutes: 240 });
  assert.equal(long.action, "rebook", "a four-hour delay is worth acting on");
  ok("short delays are watched; long ones are acted on");
}

// 16. An unquantified schedule change asks rather than guesses.
{
  const t = triage(fakeBooking(), { kind: "schedule_change" });
  assert.equal(t.action, "propose", "no numbers → show options, don't move anyone");
  const small = triage(fakeBooking(), { kind: "schedule_change", delayMinutes: 20 });
  assert.equal(small.action, "monitor", "a 20-minute move is inside tolerance");
  ok("an unquantified schedule change proposes instead of guessing");
}

// 17. Concierge Mode imports are advised, never rebooked — Tures does not hold that PNR.
{
  const t = triage(fakeBooking({ source: "import" }), { kind: "cancellation" });
  assert.equal(t.adviseOnly, true, "flagged as advisory");
  assert.equal(t.action, "propose", "an imported booking is never auto-rebooked");
  ok("Tures advises on imported trips, it does not rebook them");
}

// 18. Ripple: a flight that slips a day puts the first hotel night at risk, and says so.
{
  const t = triage(fakeBooking(), { kind: "cancellation", newDepartureIso: "2026-09-13T08:00:00Z" });
  assert.ok(t.ripple.some((r) => /first night/i.test(r)), `expected a hotel-night ripple, got ${JSON.stringify(t.ripple)}`);
  ok("a day slip surfaces the unused hotel night");
}

// 19. A destination closure is a notice, not a reason to touch a flight.
{
  const t = triage(fakeBooking(), { kind: "closure", detail: "the museum is shut for renovation" });
  assert.equal(t.action, "monitor");
  ok("a destination closure never moves a booking");
}

console.log("\nHiccup Handler — over HTTP\n");

// Set up a real signed-in account with a card so bookings can actually execute.
let acctBrief: any;
const auth = await signup("hiccup@test.com");
{
  const conn = await app.inject({
    method: "POST",
    url: "/connections",
    headers: auth,
    payload: { kind: "payment", label: "Test Visa", secret: { customerId: "cus_t", paymentMethodId: "pm_visa" }, meta: { last4: "4242", cardKey: "visa" } },
  });
  assert.equal(conn.statusCode, 200, `card connect failed: ${conn.body}`);
  assert.ok(conn.json().scopes.includes("payment:charge"), "the card grants payment:charge");
  acctBrief = {
    origin: "SFO",
    destination: "HEL",
    departDate: "2026-09-12",
    returnDate: "2026-09-19",
    adults: 1,
    rebooking: { mode: "propose" },
  };
}

async function bookAndConfirm(briefOver: any = {}) {
  const bk = (await app.inject({ method: "POST", url: "/book", headers: auth, payload: { brief: { ...acctBrief, ...briefOver } } })).json();
  await app.inject({ method: "POST", url: `/book/${bk.id}/confirm`, headers: auth });
  return bk.id as string;
}

// 20. THE RE-PICK BUG. `?? flights[0]` could rebook a cancelled flight onto itself. The
//     replacement must never be the offer that just fell through.
{
  const id = await bookAndConfirm({ rebooking: { mode: "auto", maxUpchargeUsd: 9000 } });
  const before = (await (await app.inject({ method: "GET", url: `/book/${id}`, headers: auth })).json()).components.find((c: any) => c.kind === "flight");
  const res = await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "cancellation", detail: "cancelled" } });
  const { resolution, booking } = res.json();
  assert.equal(resolution.status, "rebooked");
  const after = booking.components.find((c: any) => c.kind === "flight");
  assert.notEqual(after.offerId, before.offerId, "must not rebook onto the disrupted offer");
  assert.notEqual(after.confirmation, before.confirmation, "a genuinely new confirmation");
  assert.equal(after.rebookedFrom.title, before.title, "records what it replaced");
  ok("a rebooking can never land on the flight that was just cancelled");
}

// 21. A proposal persists and can be accepted later — it used to be an event and nothing else.
{
  const id = await bookAndConfirm();
  const rep = await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "cancellation" } });
  const { resolution } = rep.json();
  assert.equal(resolution.status, "proposed");
  assert.ok(resolution.proposalId, "the proposal has an id to act on");

  const listed = (await app.inject({ method: "GET", url: `/disruptions/${id}`, headers: auth })).json();
  assert.equal(listed.pending.length, 1, "one pending question");
  assert.ok(listed.pending[0].options.length >= 2, "a proposal offers a real choice, not one option");
  assert.ok(listed.pending[0].options.every((o: any) => o.reasons.length > 0), "every option explains itself");

  const chargesBefore = (await (await app.inject({ method: "GET", url: `/book/${id}`, headers: auth })).json()).charges.length;
  const second = listed.pending[0].options[1].offerId;
  const accepted = await app.inject({ method: "POST", url: `/disruptions/proposals/${resolution.proposalId}/accept`, headers: auth, payload: { offerId: second } });
  assert.equal(accepted.statusCode, 200);
  const after = accepted.json();
  assert.equal(after.resolution.status, "rebooked", "accepting actually rebooks");
  const flight = after.booking.components.find((c: any) => c.kind === "flight");
  assert.equal(flight.offerId, second, "it books the option the traveler picked, not the top one");
  assert.ok(after.booking.charges.length >= chargesBefore, "the fare difference is handled at accept time, not before");
  assert.ok(after.booking.audit.some((a: any) => a.action === "rebook_approved"), "audit records the human approval");

  const relisted = (await app.inject({ method: "GET", url: `/disruptions/${id}`, headers: auth })).json();
  assert.equal(relisted.pending.length, 0, "the question closes once answered");
  ok("proposals persist, offer a real choice, and can be accepted later");
}

// 22. You may only accept an option that was actually offered.
{
  const id = await bookAndConfirm();
  const { resolution } = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "cancellation" } })).json();
  const res = await app.inject({
    method: "POST",
    url: `/disruptions/proposals/${resolution.proposalId}/accept`,
    headers: auth,
    payload: { offerId: "mock-fl-SFOHEL-0-not-offered" },
  });
  assert.equal(res.json().resolution.status, "no_action", "an unoffered id is refused");
  ok("only the options Tures actually offered can be accepted");
}

// 23. Dedupe: one storm reported three times is one question, not three rebooks.
{
  const id = await bookAndConfirm({ rebooking: { mode: "auto", maxUpchargeUsd: 0 } }); // cap forces propose
  const payload = { bookingId: id, kind: "cancellation", sourceId: "sig_storm_helsinki_001", detail: "storm" };
  const first = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload })).json();
  const second = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload })).json();
  const third = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload })).json();
  assert.equal(first.resolution.status, "proposed");
  assert.equal(second.resolution.proposalId, first.resolution.proposalId, "same event → same proposal");
  assert.equal(third.resolution.proposalId, first.resolution.proposalId);
  const listed = (await app.inject({ method: "GET", url: `/disruptions/${id}`, headers: auth })).json();
  assert.equal(listed.pending.length, 1, "three reports, one open question");
  ok("repeat reports of one event collapse onto a single proposal");
}

// 24. Declining leaves the booking alone and closes the question honestly.
{
  const id = await bookAndConfirm();
  const { resolution } = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "cancellation" } })).json();
  const before = (await (await app.inject({ method: "GET", url: `/book/${id}`, headers: auth })).json()).components.find((c: any) => c.kind === "flight");
  const declined = await app.inject({ method: "POST", url: `/disruptions/proposals/${resolution.proposalId}/decline`, headers: auth, payload: { note: "I'll drive" } });
  assert.equal(declined.json().proposal.status, "declined");
  const after = (await (await app.inject({ method: "GET", url: `/book/${id}`, headers: auth })).json()).components.find((c: any) => c.kind === "flight");
  assert.equal(after.offerId, before.offerId, "the original booking is untouched");
  assert.equal(after.status, "confirmed", "still confirmed, not left in limbo");
  ok("declining a proposal leaves the trip exactly as it was");
}

// 25. A short delay over HTTP monitors — no proposal, no charge, no change.
{
  const id = await bookAndConfirm({ rebooking: { mode: "auto", maxUpchargeUsd: 9000 } });
  const chargesBefore = (await (await app.inject({ method: "GET", url: `/book/${id}`, headers: auth })).json()).charges.length;
  const res = await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "delay", delayMinutes: 35 } });
  const { resolution, booking } = res.json();
  assert.equal(resolution.status, "monitoring", "a 35-minute delay is watched even with auto authority");
  assert.equal(booking.charges.length, chargesBefore, "nothing charged");
  assert.ok(booking.components.every((c: any) => c.status === "confirmed"), "nothing moved");
  const listed = (await app.inject({ method: "GET", url: `/disruptions/${id}`, headers: auth })).json();
  assert.equal(listed.pending.length, 0, "monitoring does not open a question");
  ok("a short delay with full auto authority still changes nothing");
}

// 26. Ownership: another account cannot see or act on this trip's proposals.
{
  const id = await bookAndConfirm();
  const { resolution } = (await app.inject({ method: "POST", url: "/disruptions", headers: auth, payload: { bookingId: id, kind: "cancellation" } })).json();
  const otherAuth = await signup("other@test.com");
  assert.equal((await app.inject({ method: "GET", url: `/disruptions/${id}`, headers: otherAuth })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/disruptions/proposals/${resolution.proposalId}/accept`, headers: otherAuth })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/disruptions/proposals/${resolution.proposalId}/decline`, headers: otherAuth })).statusCode, 404);
  ok("another account cannot read or act on someone else's proposal");
}

await app.close();
console.log(`\n${passed} checks passed.\n`);
