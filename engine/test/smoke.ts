// Smoke test — boots the engine in-process (no port) and exercises the Chunk 0/1 surface:
// health, a scored search, the planner, brief validation, and the SSE replay buffer.
// Runs with the mock supplier (no keys). `npm run smoke`.
import assert from "node:assert/strict";
import { build } from "../src/server.ts";
import { bus } from "../src/events/bus.ts";
import { encrypt, decrypt } from "../src/vault/crypto.ts";
import { consumeLinkCode, resolveAccount, unlinkChannel } from "../src/channels/index.ts";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const app = await build();

// 1. health
{
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.supplier, "mock"); // no DUFFEL_API_TOKEN in test env
  assert.equal(body.capabilities.search, true);
  ok("health reports ok + mock supplier");
}

// 2. search returns scored, sorted offers
const brief = {
  origin: "SFO",
  destination: "HEL",
  departDate: "2026-09-12",
  returnDate: "2026-09-19",
  adults: 2,
  budgetUsd: 6000,
  placeTypes: ["design-hotel", "sauna"],
};
let tripId = "";
{
  const res = await app.inject({ method: "POST", url: "/search", payload: brief });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  tripId = body.tripId;
  assert.ok(body.flights.length > 0, "has flights");
  assert.ok(body.stays.length > 0, "has stays");
  // sorted by score desc
  const scores = body.flights.map((o: any) => o.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "flights sorted by score");
  // every offer scored with reasons array
  assert.ok(body.flights.every((o: any) => typeof o.score === "number"));
  // taste match surfaced on at least one stay
  assert.ok(
    body.stays.some((o: any) => (o.scoreReasons ?? []).some((r: string) => r.includes("design-hotel") || r.includes("sauna"))),
    "a stay matches placeTypes",
  );
  ok("search returns scored, sorted flights + stays with taste reasons");
}

// 3. event bus captured the search → score events for that trip
{
  const events = bus.replay(tripId);
  assert.ok(events.some((e) => e.kind === "search"), "emitted a search event");
  assert.ok(events.some((e) => e.kind === "score"), "emitted a score event");
  ok("execution events streamed to the bus");
}

// 4. planner proposes a plan within budget
{
  const res = await app.inject({ method: "POST", url: "/plan", payload: brief });
  assert.equal(res.statusCode, 200);
  const plan = res.json();
  assert.ok(plan.flight && plan.stay, "plan has a flight and a stay");
  assert.equal(plan.totalUsd, plan.flight.priceUsd + plan.stay.priceUsd, "total adds up");
  assert.equal(typeof plan.withinBudget, "boolean");
  assert.ok(plan.rationale.length > 0, "has a rationale");
  assert.equal(plan.planner, "deterministic", "no key in test → deterministic planner");
  ok("planner proposes flight + stay with a rationale (deterministic fallback)");
}

// 5. brief validation rejects garbage
{
  const res = await app.inject({ method: "POST", url: "/search", payload: { origin: "nope" } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_brief");
  ok("invalid brief rejected with 400 + issues");
}

// 5a. vault crypto: AES-256-GCM round-trips, ciphertext hides the plaintext, tampering fails
{
  const secret = JSON.stringify({ customerId: "cus_live", paymentMethodId: "pm_live" });
  const blob = encrypt(secret);
  assert.notEqual(blob, secret, "ciphertext differs from plaintext");
  assert.ok(!blob.includes("cus_live"), "plaintext not present in ciphertext");
  assert.equal(decrypt(blob), secret, "round-trips back to the original");
  // flip a char in the auth-tag region to a guaranteed-different value (deterministic tamper)
  const i = 18;
  const tampered = blob.slice(0, i) + (blob[i] === "A" ? "B" : "A") + blob.slice(i + 1);
  assert.throws(() => decrypt(tampered), "GCM auth tag rejects tampering");
  ok("vault crypto: AES-256-GCM round-trip + tamper detection");
}

// 5b. vault: connect two cards (a wallet) — redacted, grants payment:charge
let platConnId = "";
let csrConnId = "";
async function connectCard(label: string, cardKey: string, last4: string) {
  const res = await app.inject({
    method: "POST",
    url: "/connections",
    payload: { kind: "payment", label, secret: { customerId: "cus_x", paymentMethodId: "pm_" + cardKey }, meta: { last4, cardKey } },
  });
  assert.equal(res.statusCode, 200);
  return res.json();
}
{
  const plat = await connectCard("Amex Platinum", "amex_platinum", "1004");
  const csr = await connectCard("Chase Sapphire Reserve", "chase_sapphire_reserve", "7788");
  platConnId = plat.id;
  csrConnId = csr.id;
  assert.equal(plat.secretCipher, undefined, "secret never returned to client");
  assert.ok(plat.scopes.includes("payment:charge"), "payment grant present");
  const listed = (await (await app.inject({ method: "GET", url: "/connections" })).json()).connections;
  assert.ok(listed.every((x: any) => x.secretCipher === undefined), "list is redacted");
  ok("vault connects two cards (redacted) and grants payment:charge");
}

// 5c. wallet: best card differs by charge category (airfare → Platinum 5×, hotel → CSR 3×)
{
  const air = (await app.inject({ method: "GET", url: "/wallet/recommend?category=airfare&amount=5000" })).json();
  const hotel = (await app.inject({ method: "GET", url: "/wallet/recommend?category=hotel&amount=2000" })).json();
  assert.equal(air.name, "Amex Platinum", "Platinum wins airfare");
  assert.equal(hotel.name, "Chase Sapphire Reserve", "CSR wins hotel");
  ok("wallet picks the best card per category (airfare→Platinum, hotel→CSR)");
}

// 5d. traveler profile: save + read back masked, never leaking raw passport/KTN
{
  const save = await app.inject({
    method: "POST",
    url: "/profile",
    payload: { profile: { fullName: "Andy Traveler", passport: { number: "X1234567", country: "US" }, knownTravelerNumber: "TT12345678", memberships: [{ kind: "airline", program: "Finnair Plus", number: "FP998877", status: "Gold" }] } },
  });
  assert.equal(save.statusCode, 200);
  const c = save.json();
  assert.equal(c.secretCipher, undefined, "profile secret not returned");
  assert.ok(!JSON.stringify(c).includes("X1234567"), "raw passport never leaves the vault");
  assert.equal(c.meta.passportMasked, "••••4567", "passport is masked");
  assert.ok(c.meta.ktnOnFile, "KTN recorded");
  ok("traveler profile saves passport/KTN/memberships encrypted + masked");
}

// 6. booking gate: confirm_each opens the gate and charges NOTHING
let bookingId = "";
{
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  bookingId = b.id;
  assert.equal(b.status, "confirmation_required", "gate is open");
  assert.equal(b.charges.length, 0, "no charges before confirm");
  assert.ok(b.components.length >= 1, "has components staged");
  assert.ok(b.passenger && b.passenger.passportOnFile && b.passenger.ktnApplied, "passenger details attached from profile");
  assert.ok(b.audit.some((a: any) => a.action === "awaiting_confirmation"), "audit records the gate");
  ok("POST /book opens the confirm gate with no charge (passenger attached)");
}

// 7. confirm executes: per-card charges + PNRs + booked, with the wallet choosing per category
{
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.status, "booked");
  assert.equal(b.charges.length, 2, "one charge per component");
  assert.ok(b.charges.every((p: any) => p.status === "succeeded"), "all charges succeeded");
  const flight = b.components.find((c: any) => c.kind === "flight");
  const stay = b.components.find((c: any) => c.kind === "stay");
  assert.equal(flight.card.name, "Amex Platinum", "flight charged on the best airfare card");
  assert.equal(stay.card.name, "Chase Sapphire Reserve", "stay charged on the best hotel card");
  assert.ok(b.components.every((c: any) => c.status === "confirmed" && c.confirmation), "every component confirmed");
  assert.ok(b.audit.some((a: any) => a.action === "card_selected"), "audit records card selection");
  assert.ok(b.audit.some((a: any) => a.action === "booked"), "audit records booked");
  ok("confirm picks the best card per charge, books each component, writes the audit trail");
}

// 8. confirm is idempotent — same charges, no double charge
{
  const before = (await (await app.inject({ method: "GET", url: `/book/${bookingId}` })).json()).charges.map((p: any) => p.intentId).sort();
  const res = await app.inject({ method: "POST", url: `/book/${bookingId}/confirm` });
  const after = res.json();
  assert.equal(after.status, "booked");
  assert.deepEqual(after.charges.map((p: any) => p.intentId).sort(), before, "same intents — not re-charged");
  ok("re-confirming a booked trip is idempotent (no double charge)");
}

// 9. policy gate: over-budget booking is refused with 409, nothing charged
{
  const tinyBudget = { ...brief, budgetUsd: 100 };
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief: tinyBudget } });
  assert.equal(res.statusCode, 409, "over-budget refused");
  const b = res.json();
  assert.equal(b.status, "failed");
  assert.ok(b.violations.some((v: string) => /budget/.test(v)), "violation cites budget");
  assert.equal(b.charges.length, 0, "nothing charged on a blocked booking");
  ok("over-budget booking blocked at the policy gate (409, no charge)");
}

// 10. auto_within_brief books immediately (no gate) when within budget
{
  const auto = { ...brief, bookingMode: "auto_within_brief" };
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief: auto } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.status, "booked", "auto-booked without a gate");
  assert.ok(b.audit.some((a: any) => a.action === "auto_book"), "audit records the auto-book decision");
  ok("auto_within_brief books immediately within budget");
}

// 11. idempotencyKey: a duplicate POST /book returns the same booking
{
  const key = "idem-test-key-123456";
  const a = (await app.inject({ method: "POST", url: "/book", payload: { brief, idempotencyKey: key } })).json();
  const b = (await app.inject({ method: "POST", url: "/book", payload: { brief, idempotencyKey: key } })).json();
  assert.equal(a.id, b.id, "same idempotency key → same booking");
  ok("duplicate /book with same idempotencyKey is deduped");
}

// 13. Hiccup Handler: auto-rebook a cancellation within standing authority
{
  const autoBrief = { ...brief, rebooking: { mode: "auto", maxUpchargeUsd: 5000 } };
  const bk = (await app.inject({ method: "POST", url: "/book", payload: { brief: autoBrief } })).json();
  await app.inject({ method: "POST", url: `/book/${bk.id}/confirm` });
  const beforeFlight = (await (await app.inject({ method: "GET", url: `/book/${bk.id}` })).json()).components.find((c: any) => c.kind === "flight");
  const res = await app.inject({ method: "POST", url: "/disruptions", payload: { bookingId: bk.id, kind: "cancellation", detail: "flight cancelled" } });
  assert.equal(res.statusCode, 200);
  const { resolution, booking } = res.json();
  assert.equal(resolution.status, "rebooked", "auto-rebooked");
  const flight = booking.components.find((c: any) => c.kind === "flight");
  assert.equal(flight.status, "rebooked");
  assert.ok(flight.confirmation && flight.confirmation !== beforeFlight.confirmation, "new confirmation issued");
  assert.ok(flight.rebookedFrom, "records what it replaced");
  assert.ok(booking.audit.some((a: any) => a.action === "disruption_detected"), "audit: detected");
  assert.ok(booking.audit.some((a: any) => a.action === "rebooked"), "audit: rebooked");
  assert.ok(booking.hiccups && booking.hiccups.length === 1, "hiccup recorded on booking");
  ok("Hiccup Handler auto-rebooks within standing authority");
}

// 14. Hiccup Handler: propose-only (no standing authority) — no charge, original untouched
{
  const bk = (await app.inject({ method: "POST", url: "/book", payload: { brief } })).json(); // default rebooking = propose
  await app.inject({ method: "POST", url: `/book/${bk.id}/confirm` });
  const chargesBefore = (await (await app.inject({ method: "GET", url: `/book/${bk.id}` })).json()).charges.length;
  const res = await app.inject({ method: "POST", url: "/disruptions", payload: { bookingId: bk.id, kind: "schedule_change" } });
  const { resolution, booking } = res.json();
  assert.equal(resolution.status, "proposed", "proposed, not auto");
  assert.ok(resolution.to && resolution.upchargeUsd !== undefined, "proposal names an option + cost");
  assert.equal(booking.charges.length, chargesBefore, "no extra charge on a proposal");
  assert.ok(booking.audit.some((a: any) => a.action === "rebook_proposed"), "audit: proposed");
  ok("Hiccup Handler proposes (no auto-charge) without standing authority");
}

// 12. revoking all payment methods blocks new bookings at the policy gate
{
  await app.inject({ method: "POST", url: `/connections/${platConnId}/revoke` });
  const rev = await app.inject({ method: "POST", url: `/connections/${csrConnId}/revoke` });
  assert.equal(rev.json().status, "revoked");
  const res = await app.inject({ method: "POST", url: "/book", payload: { brief } });
  assert.equal(res.statusCode, 409, "no payment method → blocked");
  assert.ok(res.json().violations.some((v: string) => /payment method/.test(v)), "violation cites payment method");
  ok("revoking all payment methods immediately blocks new bookings");
}

// 13.5 auth + sessions + per-trip fee + mock billing
{
  const su = await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "a@b.com", name: "Ada", password: "password123" } });
  assert.equal(su.statusCode, 200);
  const { token, user } = su.json();
  assert.ok(token && user.id.startsWith("acct_"), "signup returns token + account");
  assert.equal(user.passwordHash, undefined, "never returns the password hash");

  const auth = { authorization: "Bearer " + token };

  // a card connected under the session is namespaced to this account
  await app.inject({ method: "POST", url: "/connections", headers: auth, payload: { kind: "payment", label: "Amex Platinum", secret: { customerId: "c", paymentMethodId: "p" }, meta: { cardKey: "amex_platinum" } } });
  const mine = (await (await app.inject({ method: "GET", url: "/connections", headers: auth })).json()).connections;
  assert.equal(mine.length, 1, "session sees only its own connection");
  const demoConns = (await (await app.inject({ method: "GET", url: "/connections" })).json()).connections;
  assert.ok(demoConns.every((c: any) => c.accountId !== user.id), "another account can't see it");
  ok("auth: signup + session namespaces vault data to the account");

  // book with the session + a per-trip concierge fee
  const bk = (await app.inject({ method: "POST", url: "/book", headers: auth, payload: { brief, feeUsd: 99 } })).json();
  assert.equal(bk.accountId, user.id, "booking belongs to the signed-in account");
  const booked = (await app.inject({ method: "POST", url: `/book/${bk.id}/confirm`, headers: auth })).json();
  assert.equal(booked.status, "booked");
  assert.equal(booked.charges.length, 3, "2 components + 1 concierge fee");
  assert.ok(booked.audit.some((a: any) => a.action === "concierge_fee"), "fee in audit");
  ok("booking collects the $99 per-trip fee with the trip");

  // the trip shows in the account's dashboard list
  const trips = (await (await app.inject({ method: "GET", url: "/bookings", headers: auth })).json()).bookings;
  assert.ok(trips.length >= 1 && trips[0].accountId === user.id, "trip appears for the account");

  // mock subscription flips the plan
  const co = (await app.inject({ method: "POST", url: "/billing/checkout", headers: auth })).json();
  assert.equal(co.mock, true, "no Stripe key → mock activation");
  const me = (await (await app.inject({ method: "GET", url: "/auth/me", headers: auth })).json()).user;
  assert.equal(me.plan, "subscribe", "plan upgraded to subscribe");
  ok("billing: subscription activates and upgrades the plan");

  // login checks
  assert.equal((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "a@b.com", password: "nope" } })).statusCode, 401, "wrong password rejected");
  assert.equal((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "a@b.com", password: "password123" } })).statusCode, 200, "correct password accepted");
  assert.equal((await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "a@b.com", password: "password123" } })).statusCode, 409, "duplicate email rejected");
  ok("auth: login succeeds, bad password + duplicate email rejected");
}

// 14.5 travelers (family) + places ("where you've been")
{
  const su = await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "fam@b.com", name: "Fam", password: "password123" } });
  const auth = { authorization: "Bearer " + su.json().token };

  // add a companion — PII masked, never returned raw
  const t = await app.inject({ method: "POST", url: "/travelers", headers: auth, payload: { fullName: "Kid One", relationship: "child", passport: { number: "K9999999" }, memberships: [] } });
  assert.equal(t.statusCode, 200);
  assert.equal(t.json().secretCipher, undefined, "traveler secret not returned");
  assert.ok(!JSON.stringify(t.json()).includes("K9999999"), "raw passport not leaked");
  const list = (await (await app.inject({ method: "GET", url: "/travelers", headers: auth })).json()).travelers;
  assert.equal(list.length, 1, "companion listed");
  assert.equal(list[0].meta.relationship, "child");
  ok("travelers: add a companion (PII masked) and list it");

  // where you've been + taste signal
  await app.inject({ method: "POST", url: "/places", headers: auth, payload: { kind: "city", name: "Lisbon", region: "Portugal", rating: 9, tags: ["food", "design"] } });
  await app.inject({ method: "POST", url: "/places", headers: auth, payload: { kind: "city", name: "Dubai", rating: 4, tags: ["luxury"] } });
  const res = (await (await app.inject({ method: "GET", url: "/places", headers: auth })).json());
  assert.equal(res.places.length, 2, "two places stored");
  assert.equal(res.places[0].name, "Lisbon", "sorted best-rated first");
  assert.ok(res.taste.lovedPlaces.includes("Lisbon") && !res.taste.lovedPlaces.includes("Dubai"), "taste signal = highly-rated only");
  assert.ok(res.taste.favoriteTags.includes("food"), "favorite tags derived from loved places");
  ok("places: rate where you've been → derives a taste signal for the planner");

  // the taste signal actually reaches scoring: search with NO placeTypes still boosts on taste
  const sres = (await (await app.inject({ method: "POST", url: "/search", headers: auth, payload: { ...brief, placeTypes: [] } })).json());
  assert.ok(sres.stays.some((s: any) => (s.scoreReasons || []).some((r: string) => /your taste/.test(r))), "account taste boosts a stay");
  ok("taste signal feeds the planner — where you've been changes the suggestions");
}

// 14.6 auth ownership: one account cannot confirm/read/disrupt another's booking, or revoke its card
{
  const A = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "owner@b.com", name: "Owner", password: "password123" } })).json();
  const B = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "intruder@b.com", name: "Intruder", password: "password123" } })).json();
  const authA = { authorization: "Bearer " + A.token };
  const authB = { authorization: "Bearer " + B.token };

  // A connects a card and opens a booking
  const aCard = (await app.inject({ method: "POST", url: "/connections", headers: authA, payload: { kind: "payment", label: "Amex", secret: { customerId: "c", paymentMethodId: "p" }, meta: { cardKey: "amex_platinum" } } })).json();
  const aBooking = (await app.inject({ method: "POST", url: "/book", headers: authA, payload: { brief } })).json();
  assert.equal(aBooking.accountId, A.user.id, "A owns the booking");

  // B is refused everywhere with 404 (not 403 → no enumeration)
  assert.equal((await app.inject({ method: "POST", url: `/book/${aBooking.id}/confirm`, headers: authB })).statusCode, 404, "B cannot confirm A's booking");
  assert.equal((await app.inject({ method: "GET", url: `/book/${aBooking.id}`, headers: authB })).statusCode, 404, "B cannot read A's booking");
  assert.equal((await app.inject({ method: "POST", url: "/disruptions", headers: authB, payload: { bookingId: aBooking.id, kind: "delay" } })).statusCode, 404, "B cannot disrupt A's booking");
  assert.equal((await app.inject({ method: "POST", url: `/connections/${aCard.id}/revoke`, headers: authB })).statusCode, 404, "B cannot revoke A's card");

  // A still can (sanity: the guard isn't a blanket block)
  assert.equal((await app.inject({ method: "GET", url: `/book/${aBooking.id}`, headers: authA })).statusCode, 200, "A can read its own booking");
  ok("auth ownership: a second account cannot touch another's booking or card (404)");
}

// 14.7 scope hardening: client-supplied scopes are ignored — scopes are derived from kind
{
  const su = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "scopes@b.com", password: "password123" } })).json();
  const auth = { authorization: "Bearer " + su.token };
  // try to self-grant payment:charge via a loyalty connection — must NOT work
  const sneaky = (await app.inject({ method: "POST", url: "/connections", headers: auth, payload: { kind: "loyalty", label: "United", scopes: ["payment:charge"], secret: { n: "x" } } })).json();
  assert.deepEqual(sneaky.scopes, ["loyalty:read"], "loyalty connection gets only loyalty:read, not the smuggled payment:charge");
  // with no real payment method, a booking is still blocked at the policy gate
  const blocked = await app.inject({ method: "POST", url: "/book", headers: auth, payload: { brief } });
  assert.equal(blocked.statusCode, 409, "no payment:charge → booking blocked despite the scope smuggling attempt");
  ok("scope hardening: client cannot self-grant payment:charge via the scopes field");
}

// 14.8 situational-awareness /signals: locates a destination, returns ranked signals + provider status
{
  const res = await app.inject({ method: "POST", url: "/signals", payload: { destination: "OGG", departDate: "2026-09-12", returnDate: "2026-09-19" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.destination && body.location, "destination located");
  assert.ok(Array.isArray(body.signals), "signals is an array");
  assert.ok(Array.isArray(body.providers) && body.providers.some((p: any) => p.category === "weather" && p.configured), "weather provider is wired + configured (keyless)");
  assert.ok(body.providers.some((p: any) => p.name.includes("web search")), "the web scout provider is registered");
  ok("signals: /signals locates a trip and returns ranked signals + provider status");

  // an unlocatable destination is refused cleanly (no fabricated radar)
  const bad = await app.inject({ method: "POST", url: "/signals", payload: { destination: "ZZ" } });
  assert.equal(bad.statusCode, 422, "unlocatable destination → 422");
  ok("signals: an unlocatable destination is refused (no fake signals)");

  // health surfaces the signals layer + provider status
  const h = (await app.inject({ method: "GET", url: "/health" })).json();
  assert.equal(h.capabilities.situationalAwareness, true, "health reports the situational-awareness capability");
  assert.ok(Array.isArray(h.signals.providers), "health lists signal providers");
  ok("health: reports the situational-awareness layer + provider status");
}

// 14.9 cross-channel: link-code needs sign-in; the channel store binds/resolves/unlinks; webhook guarded
{
  // unauthenticated → 401
  assert.equal((await app.inject({ method: "POST", url: "/channels/link-code" })).statusCode, 401, "link-code needs sign-in");

  const su = (await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "chan@b.com", password: "password123" } })).json();
  const auth = { authorization: "Bearer " + su.token };
  const lc = await app.inject({ method: "POST", url: "/channels/link-code", headers: auth });
  assert.equal(lc.statusCode, 200);
  const code = lc.json().code;
  assert.ok(code && lc.json().telegramEnabled === false, "returns a code; telegram off in test");

  // the channel store: consume the code from "telegram" → binds chat to the account; resolves; one-time
  assert.equal(consumeLinkCode(code, "telegram", "tg-chat-1"), su.user.id, "code consumed → bound to the account");
  assert.equal(resolveAccount("telegram", "tg-chat-1"), su.user.id, "chat resolves to the account");
  assert.equal(consumeLinkCode(code, "telegram", "tg-chat-1"), null, "code is one-time");
  const listed = (await (await app.inject({ method: "GET", url: "/channels", headers: auth })).json()).channels;
  assert.ok(listed.some((c: any) => c.channel === "telegram"), "linked channel is listed");
  assert.equal(unlinkChannel(su.user.id, "telegram"), true, "unlink works");
  assert.equal(resolveAccount("telegram", "tg-chat-1"), null, "resolves null after unlink");
  ok("cross-channel: link-code + channel store bind/resolve/unlink (one account, any channel)");

  // telegram webhook 404s until a bot token is configured (guarded, like the other providers)
  assert.equal((await app.inject({ method: "POST", url: "/telegram/webhook", payload: { message: { chat: { id: 1 }, text: "hi" } } })).statusCode, 404, "telegram off → webhook 404");
  const h = (await app.inject({ method: "GET", url: "/health" })).json();
  assert.equal(h.capabilities.crossChannel, true);
  assert.equal(h.capabilities.telegram, false);
  ok("cross-channel: telegram webhook guarded off + health reports the layer");
}

// 15. conversation history compaction
{
  const { compactConversation, capContext } = await import("../src/agent/history.ts");
  const long = "x".repeat(2000);
  const out = compactConversation([
    { role: "user", content: long },
    { role: "assistant", content: "ok" },
    { role: "user", content: "next" },
  ]);
  assert.ok(out.length <= 12, "caps turn count");
  assert.ok(out[0]!.content.endsWith("…"), "truncates long messages");
  assert.equal(capContext("a".repeat(2000))!.length, 1401, "capContext adds ellipsis at 1400");
  ok("history: compactConversation + capContext stay within budget");
}

// 15.5 adaptive trip watch — risk + pass-through metering
{
  const { assessRisk } = await import("../src/watch/risk.ts");
  const { recordUsage, pricing } = await import("../src/watch/meter.ts");
  const { emptyMeter } = await import("../src/watch/meter.ts");
  const low = assessRisk([], "2099-01-01");
  assert.equal(low.level, "clear");
  assert.equal(low.scansBudget, 0);
  const high = assessRisk(
    [{ id: "w:1", category: "weather", severity: "critical", title: "Storm", source: "test", travelImpacting: true }],
    "2026-07-10",
  );
  assert.ok(high.score >= 50, "critical weather + near depart elevates risk");
  const w = {
    bookingId: "bk_test",
    tripId: "t1",
    accountId: "demo",
    enabled: true,
    capUsd: 10,
    marginPercent: 20,
    alertsOn: true,
    riskScore: 0,
    riskLevel: "clear" as const,
    scansToday: 0,
    scansBudgetToday: 0,
    deepScansToday: 0,
    meter: emptyMeter(),
    keywords: [],
    surfacedSignalIds: [],
    createdAt: "",
    updatedAt: "",
  };
  recordUsage(w, "deep_scout", 1);
  const p = pricing(w);
  assert.ok(p.billableUsd >= p.cogsUsd);
  w.meter.cogsUsd = 50;
  w.meter.billableUsd = 0;
  const { recalcBillable } = await import("../src/watch/meter.ts");
  recalcBillable(w);
  assert.ok(w.meter.billableUsd <= w.capUsd);
  ok("trip watch: risk scoring + pass-through metering");
}

// 15.6 trip watch pass-through settlement at trip end
{
  const { settleWatchBilling, watchWindowClosed } = await import("../src/watch/settle.ts");
  const { recordUsage, emptyMeter } = await import("../src/watch/meter.ts");
  const { watches } = await import("../src/watch/store.ts");

  await connectCard("Watch Settle Card", "generic_cashback", "4242");

  const pastBrief = { ...brief, departDate: "2020-01-01", returnDate: "2020-01-05" };
  const fakeBooking = {
    id: "bk_watch_settle",
    tripId: "trip_watch_settle",
    accountId: "demo",
    brief: pastBrief,
    status: "booked" as const,
    totalUsd: 1000,
    currency: "USD",
    components: [],
    charges: [],
    violations: [],
    audit: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as import("../src/booking/types.ts").Booking;
  assert.ok(watchWindowClosed(fakeBooking), "past trip window is closed");

  const w0 = {
    bookingId: fakeBooking.id,
    tripId: fakeBooking.tripId,
    accountId: "demo",
    enabled: true,
    capUsd: 10,
    marginPercent: 20,
    alertsOn: true,
    riskScore: 0,
    riskLevel: "clear" as const,
    scansToday: 0,
    scansBudgetToday: 0,
    deepScansToday: 0,
    meter: emptyMeter(),
    keywords: ["HEL"],
    surfacedSignalIds: [],
    createdAt: "",
    updatedAt: "",
  };
  watches.put(w0);
  const skipped = await settleWatchBilling(watches.get(fakeBooking.id)!, fakeBooking);
  assert.equal(skipped.settlementStatus, "skipped", "zero spend → no charge");
  assert.ok(skipped.settledAt, "settlement timestamp recorded");

  const w1 = watches.get(fakeBooking.id)!;
  w1.settledAt = undefined;
  w1.settlementStatus = undefined;
  recordUsage(w1, "deep_scout", 2);
  watches.put(w1);
  const settled = await settleWatchBilling(watches.get(fakeBooking.id)!, fakeBooking);
  assert.equal(settled.settlementStatus, "mock", "mock mode settles pass-through spend");
  assert.ok((settled.settlementUsd ?? 0) > 0, "billable amount captured");
  assert.equal(settled.enabled, false, "watch disabled after settlement");
  ok("trip watch: pass-through settlement charges once at trip end");
}

// 36. Action executor — permissions, grants, run → handoff
{
  const caps = await app.inject({ method: "GET", url: "/actions/capabilities" });
  assert.equal(caps.statusCode, 200);
  assert.ok(caps.json().permissions["act:browser_login"], "browser_login in catalog");

  // Acting on someone's behalf needs an account, so this flow runs signed in.
  const actor = (await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { email: "actions@b.com", password: "password123" },
  })).json();
  const actorAuth = { authorization: "Bearer " + actor.token };

  const grant = await app.inject({
    method: "POST",
    url: "/actions/grants",
    headers: actorAuth,
    payload: { permission: "act:browser_login", label: "Sign in to airline site" },
  });
  assert.equal(grant.statusCode, 200);
  const grantId = grant.json().grant.id;

  const denied = await app.inject({
    method: "POST",
    url: "/actions/run",
    headers: actorAuth,
    payload: { permission: "act:fill_forms", title: "Submit form", targetUrl: "https://example.com/form" },
  });
  assert.equal(denied.statusCode, 403, "run without grant blocked");

  const run = await app.inject({
    method: "POST",
    url: "/actions/run",
    headers: actorAuth,
    payload: {
      permission: "act:browser_login",
      title: "Sign in to Example Air",
      targetUrl: "https://example.com/login",
      grantId,
    },
  });
  assert.equal(run.statusCode, 200);
  const body = run.json();
  assert.equal(body.run.status, "needs_human");
  assert.ok(body.run.handoffToken);
  const token = body.run.handoffToken;

  const ho = await app.inject({ method: "GET", url: `/actions/handoff/${token}`, headers: actorAuth });
  assert.equal(ho.statusCode, 200);
  assert.equal(ho.json().handoff.status, "open");

  const cont = await app.inject({ method: "POST", url: `/actions/handoff/${token}/continue`, headers: actorAuth });
  assert.equal(cont.statusCode, 200);
  assert.equal(cont.json().run.status, "completed");

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.ok(health.json().capabilities.actionExecutor);
  ok("action executor: grant → run → handoff → continue");
}

// 36b. Anonymous free tier — cheap read-only lookups run on us; acting still needs an account
{
  const { config } = await import("../src/config.ts");
  const ip = (n: number) => ({ "x-forwarded-for": `203.0.113.${n}` });

  // read-only + browser-free + under the cost cap → runs anonymously
  const free = await app.inject({
    method: "POST",
    url: "/actions/run",
    headers: ip(1),
    payload: { permission: "act:research", title: "Find family-friendly lodging with a pool" },
  });
  assert.equal(free.statusCode, 200, "anonymous research runs free");
  assert.equal(free.json().run.status, "completed");

  // anything that acts on your behalf → account wall, with a reason (not a grant error)
  for (const perm of ["act:fill_forms", "act:purchase", "act:contact"]) {
    const blocked = await app.inject({
      method: "POST",
      url: "/actions/run",
      headers: ip(2),
      payload: { permission: perm, title: "Do the thing", targetUrl: "https://example.com/x" },
    });
    assert.equal(blocked.statusCode, 401, `${perm} needs an account`);
    assert.equal(blocked.json().error, "sign_in_required");
    assert.ok(blocked.json().reason, "says why an account is needed");
  }

  // the daily quota bounds total anonymous spend (per-run cost is capped separately)
  const limit = config.freeActionDailyLimit;
  let last = 200;
  for (let i = 0; i < limit + 2; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/actions/run",
      headers: ip(3),
      payload: { permission: "act:research", title: "Lookup " + i },
    });
    last = r.statusCode;
    if (last === 429) { assert.equal(r.json().error, "free_limit_reached"); break; }
  }
  assert.equal(last, 429, "free runs are capped per day");
  ok("anonymous: free read-only research, account wall for acting, daily cap enforced");
}

// 37. Vault site-login matching for browser actions
{
  const { connect } = await import("../src/vault/index.ts");
  const { credentialsForSite } = await import("../src/actions/vault-creds.ts");
  await connect({
    accountId: "demo",
    kind: "site_login",
    label: "Marriott Bonvoy",
    secret: { program: "Marriott Bonvoy", username: "traveler@example.com", password: "vault-test", domain: "marriott.com" },
  });
  const c = await credentialsForSite("demo", "https://www.marriott.com/sign-in");
  assert.ok(c && c.username === "traveler@example.com", "matches marriott URL to saved login");
  assert.equal(await credentialsForSite("demo", "https://example.com"), null, "no match for unrelated site");
  ok("vault: site login credentials match by URL");
}

// 38. mem0 guest merge route
{
  const { mergeMem0 } = await import("../src/mem0.ts");
  const merged = await mergeMem0("guest-smoke-a", "guest-smoke-b");
  assert.equal(typeof merged, "number", "merge returns count");
  ok("mem0: merge guest memories (guarded when unkeyed)");
}

// 16. /metrics reports counts + uptime
{
  const res = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(res.statusCode, 200);
  const m = res.json();
  assert.ok(m.requests > 0 && typeof m.uptimeSec === "number", "metrics populated");
  assert.ok(m.byClass && typeof m.byClass["2xx"] === "number", "status-class buckets present");
  ok("/metrics reports request counts + uptime");
}

// 39. PDX → Cannon Beach transport uses real distance, not a 12-mile city hop
{
  const { geocode } = await import("../src/geo/index.ts");
  const { estimateTransport } = await import("../src/discovery/transport.ts");
  const { BriefSchema } = await import("../src/types.ts");
  const pdx = await geocode("PDX");
  const cb = await geocode("Cannon Beach, OR");
  assert.ok(pdx && cb, "geocodes PDX and Cannon Beach");
  const offers = estimateTransport(pdx, cb, BriefSchema.parse({ origin: "SEA", destination: "PDX", departDate: "2026-08-01" }));
  assert.ok(offers.length, "transport options returned");
  const miles = offers[0]!.raw?.roadMiles as number;
  assert.ok(miles >= 60 && miles <= 110, `PDX→CB ~90min drive, got ${miles} mi`);
  ok("transport: airport→lodging distance (PDX → Cannon Beach)");
}

// 40. discover honors flights_transport scope — no dining/activities
{
  const { BriefSchema } = await import("../src/types.ts");
  const brief = BriefSchema.parse({
    origin: "SEA",
    destination: "PDX",
    departDate: "2026-08-01",
    lodgingArea: "Cannon Beach, OR",
    tripScope: "flights_transport",
  });
  const res = await app.inject({ method: "POST", url: "/discover", payload: brief });
  assert.equal(res.statusCode, 200);
  const d = res.json();
  assert.equal(d.dining.length, 0, "no dining when transport-only");
  assert.equal(d.activities.length, 0, "no activities when transport-only");
  assert.ok(d.transport.length > 0, "transport still returned");
  ok("discover: flights_transport skips dining and activities");
}

// 41. conversation audit log — verbatim turns retrievable by session
{
  const { logTurn, listSessionTranscript } = await import("../src/conversation-log.ts");
  logTurn({ userId: "guest-smoke", sessionId: "sess-smoke-1", role: "user", content: "Fly into Portland, get to Cannon Beach" });
  logTurn({ userId: "guest-smoke", sessionId: "sess-smoke-1", role: "assistant", content: "Got it — PDX then a drive to Cannon Beach.", via: "anthropic" });
  const rows = listSessionTranscript("sess-smoke-1");
  assert.equal(rows.length, 2, "two verbatim turns stored");
  assert.ok(rows[0]!.content.includes("Portland"), "user turn exact");
  ok("conversation log: verbatim session transcript");
}

// 16.5 Concierge Mode — import trip (fee only, alert + guide)
{
  const su = await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "import@b.com", name: "Importer", password: "password123" } });
  assert.equal(su.statusCode, 200);
  const auth = { authorization: "Bearer " + su.json().token };
  await app.inject({
    method: "POST", url: "/connections", headers: auth,
    payload: { kind: "payment", label: "Visa", secret: { customerId: "c2", paymentMethodId: "p2" }, meta: { cardKey: "visa" } },
  });
  const text = "NH 105 SEA to HND 2026-03-08 conf 7XK2M9. Okura Tokyo check in Mar 8 conf OKU8841";
  const anon = await app.inject({ method: "POST", url: "/trips/import", payload: { text } });
  assert.equal(anon.statusCode, 401, "import requires sign-in");
  const imp = (await app.inject({ method: "POST", url: "/trips/import", headers: auth, payload: { text, heuristic: true } })).json();
  assert.equal(imp.booking.source, "import");
  assert.equal(imp.booking.status, "confirmation_required");
  assert.ok(imp.booking.components.length >= 1, "at least one leg parsed");
  assert.equal(imp.mode, "alert_and_guide");
  const confirmed = (await app.inject({ method: "POST", url: `/trips/import/${imp.booking.id}/confirm`, headers: auth })).json();
  assert.equal(confirmed.booking.status, "booked");
  assert.ok(confirmed.booking.audit.some((a: any) => a.action === "import_active"), "import active in audit");
  assert.ok(confirmed.booking.audit.some((a: any) => a.action === "concierge_fee"), "import charges concierge fee");
  assert.equal(confirmed.booking.charges.length, 1, "fee only — no component charges");
  const listed = (await app.inject({ method: "GET", url: "/bookings", headers: auth })).json().bookings;
  assert.ok(listed.some((b: any) => b.id === imp.booking.id && b.source === "import"), "import appears in trips list");
  ok("Concierge Mode: import → confirm → fee only → booked with watch");
}

await app.close();

// 17. API-key auth: blocks without key, allows with, /health stays open
{
  process.env.ENGINE_API_KEY = "secret-test-key";
  const secured = await build();
  const noKey = await secured.inject({ method: "POST", url: "/search", payload: brief });
  assert.equal(noKey.statusCode, 401, "blocked without key");
  const withKey = await secured.inject({ method: "POST", url: "/search", payload: brief, headers: { authorization: "Bearer secret-test-key" } });
  assert.equal(withKey.statusCode, 200, "allowed with key");
  const health = await secured.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200, "health stays open");
  assert.equal(health.json().auth, true, "health reports auth on");
  const tgHook = await secured.inject({ method: "POST", url: "/telegram/webhook", payload: {} });
  assert.notEqual(tgHook.statusCode, 401, "telegram webhook not blocked by ENGINE_API_KEY");
  const convo = await secured.inject({ method: "POST", url: "/converse", payload: { messages: [], text: "hi" } });
  assert.notEqual(convo.statusCode, 401, "converse not blocked by ENGINE_API_KEY");
  await secured.close();
  delete process.env.ENGINE_API_KEY;
  ok("API-key auth blocks without key, allows with, /health stays open");
}

console.log(`\n${passed} checks passed.`);
