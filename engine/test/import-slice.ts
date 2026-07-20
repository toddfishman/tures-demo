import assert from "node:assert/strict";
import { build } from "../src/server.ts";

const app = await build();
const su = await app.inject({
  method: "POST",
  url: "/auth/signup",
  payload: { email: "imp2@b.com", name: "I", password: "password123" },
});
const auth = { authorization: "Bearer " + su.json().token };
await app.inject({
  method: "POST",
  url: "/connections",
  headers: auth,
  payload: { kind: "payment", label: "Visa", secret: { customerId: "c", paymentMethodId: "p" }, meta: { cardKey: "visa" } },
});
const text = "NH 105 SEA to HND 2026-03-08 conf 7XK2M9. Okura Tokyo Mar 8 conf OKU8841";
const imp = (await app.inject({ method: "POST", url: "/trips/import", headers: auth, payload: { text, heuristic: true } })).json();
assert.equal(imp.booking.source, "import");
const confirmed = (
  await app.inject({ method: "POST", url: `/trips/import/${imp.booking.id}/confirm`, headers: auth })
).json();
assert.equal(confirmed.booking.status, "booked");
assert.ok(confirmed.booking.audit.some((a: { action: string }) => a.action === "concierge_fee"));
console.log("import slice ok", confirmed.booking.components.length, "legs");
await app.close();
