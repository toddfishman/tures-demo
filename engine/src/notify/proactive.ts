// Proactive outbound alerts — Trip Watch, hiccups, and important booking events → Telegram
// when the traveler has linked Telegram. Browser SSE still works; this reaches them away from the tab.
import { config } from "../config.ts";
import { bookings } from "../booking/store.ts";
import type { ExecutionEvent } from "../types.ts";
import { sendTelegramToAccount } from "./telegram.ts";

const recent = new Map<string, number>();
const DEDUPE_MS = 3 * 60 * 1000;

function shouldNotify(e: ExecutionEvent): boolean {
  if (e.kind === "hiccup") return true;
  if (e.kind === "notify") {
    const d = e.data ?? {};
    if (d.travelImpacting) return true;
    if (d.watch && (d.severity === "warning" || d.severity === "critical")) return true;
    if (/Morning brief|paused at cap|Disruption handled|Trip booked/i.test(e.label)) return true;
  }
  return false;
}

function resolveAccountId(e: ExecutionEvent): string | null {
  const bookingId = e.data?.bookingId as string | undefined;
  if (bookingId) {
    const b = bookings.get(bookingId);
    if (b?.accountId && b.accountId !== "demo") return b.accountId;
  }
  const byTrip = bookings.getByTripId(e.tripId);
  if (byTrip?.accountId && byTrip.accountId !== "demo") return byTrip.accountId;
  return null;
}

function tripLink(): string {
  const base = (config.publicBaseUrl || "https://toddfishman.github.io/tures-demo/v12").replace(/\/$/, "");
  return `${base}/trips.html`;
}

/** Called from the event bus on every execution event — filters and sends Telegram when appropriate. */
export function onExecutionEvent(e: ExecutionEvent): void {
  if (!config.telegram.enabled) return;
  if (!shouldNotify(e)) return;

  const accountId = resolveAccountId(e);
  if (!accountId) return;

  const dedupeKey = `${accountId}:${e.kind}:${e.label}`;
  const now = Date.now();
  const last = recent.get(dedupeKey) ?? 0;
  if (now - last < DEDUPE_MS) return;
  recent.set(dedupeKey, now);

  const lines = [`Tures · ${e.label}`];
  if (e.detail) lines.push(e.detail);
  lines.push(`→ ${tripLink()}`);

  void sendTelegramToAccount(accountId, lines.join("\n\n"));
}
