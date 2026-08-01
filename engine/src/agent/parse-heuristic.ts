// Heuristic prose → Brief (no LLM). Used in tests and as parse fallback.
import { BriefSchema } from "../types.ts";
import type { Brief } from "../types.ts";

export interface HeuristicParseResult {
  brief: Brief;
  assumptions: string[];
  via: "heuristic";
}

const CITY_IATA: Record<string, string> = {
  paris: "CDG", lisbon: "LIS", london: "LHR", "new york": "JFK", tokyo: "HND",
  kyoto: "KIX", seattle: "SEA", "san francisco": "SFO", "sf": "SFO", copenhagen: "CPH",
  helsinki: "HEL", ivalo: "IVL", rome: "FCO", barcelona: "BCN", amsterdam: "AMS",
  berlin: "BER", reykjavik: "KEF", oslo: "OSL", stockholm: "ARN", lima: "LIM",
  "big island": "KOA", kona: "KOA", hawaii: "KOA", honolulu: "HNL", maui: "OGG",
  portland: "PDX", "cannon beach": "PDX",
};

/** Known IATA codes we accept when written directly in prose (PDX, SEA, …). */
const KNOWN_IATA = new Set(Object.values(CITY_IATA));

function isoDaysFromNow(days: number): string {
  const ms = Date.parse("2026-06-09T00:00:00Z") + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function extractIataTokens(text: string): string[] {
  const raw = text.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? [];
  return [...new Set(raw.filter((c) => KNOWN_IATA.has(c)))];
}

function cityToIata(city: string): string | undefined {
  const key = city.trim().toLowerCase();
  return CITY_IATA[key];
}

function textIncludesCity(text: string, city: string): boolean {
  const escaped = city.trim().replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function heuristicParse(text: string): HeuristicParseResult {
  const t = text.toLowerCase();
  const assumptions: string[] = [];
  const iatas = extractIataTokens(text);

  const found: string[] = [];
  for (const city of Object.keys(CITY_IATA)) {
    if (textIncludesCity(text, city)) found.push(city);
  }

  let origin = "SFO";
  let destination = "LIS";

  const fromIataToIata = text.match(/\bfrom\s+([A-Za-z]{3})\s+to\s+([A-Za-z]{3})\b/i);
  const flyIata = text.match(/\b(?:fly|flight)\s+([A-Za-z]{3})\s+to\s+([A-Za-z]{3})\b/i);
  const transportFrom = text.match(/\btransport\s+from\s+([A-Za-z]{3})\s+to\s+([^,.;\n]+)/i);
  const fromCityMatch = t.match(/\bfrom\s+([a-z\s]+?)(?:\s+to|[,.\n]|$)/);
  const toCityMatch = t.match(/\bto\s+([a-z\s]+?)(?:[,.\n]|for\b|$)/);

  if (fromIataToIata) {
    const o = fromIataToIata[1]!.toUpperCase();
    const d = fromIataToIata[2]!.toUpperCase();
    if (KNOWN_IATA.has(o)) origin = o;
    if (KNOWN_IATA.has(d)) destination = d;
    assumptions.push(`read route ${origin} → ${destination}`);
  } else if (flyIata) {
    const o = flyIata[1]!.toUpperCase();
    const d = flyIata[2]!.toUpperCase();
    if (KNOWN_IATA.has(o)) origin = o;
    if (KNOWN_IATA.has(d)) destination = d;
    assumptions.push(`read flight ${origin} → ${destination}`);
  } else if (transportFrom) {
    const d = transportFrom[1]!.toUpperCase();
    if (KNOWN_IATA.has(d)) destination = d;
    assumptions.push(`arrival airport ${destination} with ground transfer`);
  }

  const fromCity = fromCityMatch?.[1]?.trim() ?? "";
  if (fromCity && cityToIata(fromCity)) {
    origin = cityToIata(fromCity)!;
  } else if (iatas.length >= 1 && !flyIata) {
    origin = iatas[0]!;
    if (iatas.length === 1 && fromCityMatch) assumptions.push(`assumed origin ${origin} from IATA in text`);
  }
  if (fromCity && !cityToIata(fromCity) && !flyIata && origin === "SFO") {
    assumptions.push("assumed home airport SFO");
  }

  if (!fromIataToIata && !flyIata && !transportFrom) {
    const destCity = found.find((c) => CITY_IATA[c] !== origin) ?? found[0];
    if (destCity) destination = CITY_IATA[destCity]!;
    else if (iatas.length >= 2) destination = iatas[1]!;
    else if (iatas.length === 1 && iatas[0] !== origin) destination = iatas[0]!;
    else if (toCityMatch && cityToIata(toCityMatch[1]!)) destination = cityToIata(toCityMatch[1]!)!;
    if (!destCity && !iatas.length) assumptions.push("couldn't read a destination yet — tell me the city and I'll re-plan");
  }

  // "from Seattle to Maui" — city names beat stray IATA ordering
  if (fromCityMatch && toCityMatch) {
    const o = cityToIata(fromCityMatch[1]!);
    const d = cityToIata(toCityMatch[1]!);
    if (o) origin = o;
    if (d) destination = d;
  }

  let children = 0;
  const kidMatch = t.match(/(\d+)\s*(?:kids?|children|child)/);
  if (kidMatch) children = Number(kidMatch[1]) || 0;

  let adults = 1;
  if (/family of (\d+)|(\d+) of us|party of (\d+)|(\d+)\s*people|(\d+)\s*adults/.test(t)) {
    const m = t.match(/family of (\d+)|(\d+) of us|party of (\d+)|(\d+)\s*people|(\d+)\s*adults/)!;
    const total = Number(m[1] || m[2] || m[3] || m[4] || m[5]) || 1;
    adults = m[5] ? total : Math.max(1, total - children);
  } else if (/\b(two adults|2 adults)\b/.test(t)) {
    adults = 2;
  } else if (/\b(couple|two of us|both of us|me and|my partner|my wife|my husband)\b/.test(t)) {
    adults = 2;
  }

  const cabin = /business/.test(t)
    ? "business"
    : /premium economy/.test(t)
      ? "premium_economy"
      : /first class/.test(t)
        ? "first"
        : "economy";

  let priceSensitivity: "thrifty" | "balanced" | "premium" | "no_limit" = "balanced";
  if (/budget|cheap|save money|affordable|frugal|inexpensive/.test(t)) priceSensitivity = "thrifty";
  else if (/no expense|to the nines|money is no object|not price sensitive|splurge|whatever it costs|sky'?s the limit/.test(t)) priceSensitivity = "no_limit";
  else if (/treat ourselves|treat myself|nice but|spare no|go all out|special/.test(t)) priceSensitivity = "premium";
  const capMatch = t.match(/(?:under|below|max|up to|budget of|no more than)\s*\$?\s*([\d,]+)\s*(k)?/);
  const budgetUsd = capMatch ? Number((capMatch[1] ?? "0").replace(/,/g, "")) * (capMatch[2] ? 1000 : 1) || undefined : undefined;

  const placeTypes: string[] = [];
  for (const kw of ["design-hotel", "design", "boutique", "ryokan", "sauna", "spa", "waterfront", "minimalist", "grand"]) {
    if (t.includes(kw.replace("-hotel", "")) || t.includes(kw)) placeTypes.push(kw);
  }

  const departDate = isoDaysFromNow(45);
  const returnDate = /weekend/.test(t) ? isoDaysFromNow(48) : isoDaysFromNow(52);
  assumptions.push(`assumed dates ${departDate} → ${returnDate} (none clearly stated)`);

  if (children) assumptions.push(`read ${adults} adult${adults > 1 ? "s" : ""} + ${children} child${children > 1 ? "ren" : ""}`);

  if (priceSensitivity !== "balanced") assumptions.push(`read budget posture: ${priceSensitivity.replace("_", " ")}`);

  let lodgingArea: string | undefined;
  if (/cannon beach|\bcb\b/i.test(text)) lodgingArea = "Cannon Beach, OR";
  else {
    const stayMatch = text.match(
      /(?:stay(?:ing)? (?:in|at)|lodging (?:in|at)|(?:drive|transport) to|transport from\s+[A-Za-z]{3}\s+to)\s+([^,.;\n]+)/i,
    );
    if (stayMatch?.[1]) lodgingArea = stayMatch[1].trim();
  }
  if (lodgingArea) assumptions.push(`lodging area: ${lodgingArea}`);

  let tripScope: Brief["tripScope"] = "full";
  if (
    /flight(s)?\s*(?:and|\+|plus)\s*(?:car|ground|transfer|car service|ride)/i.test(t) ||
    (/\bjust\s+(?:the\s+)?flight/i.test(t) && /car|transfer|ground/i.test(t)) ||
    /(?:need|want|book)\s+(?:ground\s+)?transport|transport from\s+[a-z]{3}\s+to/i.test(t)
  ) {
    tripScope = "flights_transport";
    assumptions.push("scope: flight + ground transport only");
  } else if (/just\s+(?:the\s+)?flights?|flights?\s*only/i.test(t)) {
    tripScope = "flights_only";
    assumptions.push("scope: flights only");
  } else if (/no\s+(?:activities|restaurants|dining|extras)/i.test(t)) {
    tripScope = "flights_stay";
    assumptions.push("scope: flight + stay, no extras");
  }

  const brief = BriefSchema.parse({
    origin,
    destination,
    departDate,
    returnDate,
    adults,
    children,
    cabin,
    priceSensitivity,
    budgetUsd,
    placeTypes: [...new Set(placeTypes)],
    bookingMode: "confirm_each",
    lodgingArea,
    tripScope,
  });
  return { brief, assumptions, via: "heuristic" };
}
