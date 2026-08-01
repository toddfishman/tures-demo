// Expense export — turn a booking into structured line items an expense tool can ingest.
// CSV + JSON for now (Expensify/Concur/Ramp/QuickBooks all import CSV; JSON drives future direct
// integrations). One line per charged component plus the Tures fee.
import type { Booking } from "./types.ts";

export interface ExportLine {
  date: string; // ISO date (yyyy-mm-dd)
  category: string; // Airfare | Lodging | Service fee
  merchant: string;
  description: string;
  amount: number; // in `currency`
  currency: string;
  confirmation: string;
  card: string; // e.g. "Amex Platinum ••1004"
  simulated: boolean; // true = SAMPLE booking, no money moved
}

const CATEGORY: Record<string, string> = { flight: "Airfare", stay: "Lodging" };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** One line item per component + the concierge fee. Amounts are in the booking's stored currency. */
export function expenseLines(b: Booking): ExportLine[] {
  const date = (b.createdAt || "").slice(0, 10);
  const currency = b.currency || "USD";
  const lines: ExportLine[] = [];
  for (const c of b.components) {
    lines.push({
      date,
      category: CATEGORY[c.kind] ?? c.kind,
      merchant: c.supplier || c.title,
      description: c.title,
      amount: round2(c.amountUsd),
      currency,
      confirmation: c.confirmation || "",
      card: c.card ? `${c.card.name}${c.card.last4 ? " ••" + c.card.last4 : ""}` : "",
      simulated: !!c.simulated,
    });
  }
  if (b.feeUsd && b.feeUsd > 0) {
    lines.push({
      date,
      category: "Service fee",
      merchant: "Tures",
      description: "Tures concierge fee",
      amount: round2(b.feeUsd),
      currency,
      confirmation: "",
      card: "",
      simulated: b.components.some((c) => c.simulated),
    });
  }
  return lines;
}

const CSV_COLS = ["date", "category", "merchant", "description", "amount", "currency", "confirmation", "card", "simulated"] as const;
function csvField(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** RFC-4180-ish CSV: CRLF rows, quote-escaped fields. */
export function expenseCsv(b: Booking): string {
  const rows = expenseLines(b).map((l) => CSV_COLS.map((k) => csvField((l as unknown as Record<string, unknown>)[k])).join(","));
  return [CSV_COLS.join(","), ...rows].join("\r\n");
}

export function expenseJson(b: Booking) {
  const lineItems = expenseLines(b);
  const total = round2(lineItems.reduce((s, l) => s + l.amount, 0));
  return {
    bookingId: b.id,
    tripId: b.tripId,
    destination: b.brief?.destination ?? null,
    date: (b.createdAt || "").slice(0, 10),
    currency: b.currency || "USD",
    total,
    simulated: lineItems.some((l) => l.simulated),
    lineItems,
    // Known limitation: amounts are stored in USD; non-USD fares are not yet FX-normalized.
    note: "Amounts in USD. Non-USD fares are not yet currency-normalized.",
  };
}
