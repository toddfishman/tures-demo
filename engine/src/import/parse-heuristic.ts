import type { Brief } from "../types.ts";
import { heuristicParse } from "../agent/parse-heuristic.ts";
import type { ImportLeg, ImportParseResult } from "./types.ts";

const FLIGHT =
  /\b([A-Z]{2})\s*(\d{1,4})\b[^.\n]{0,80}?([A-Z]{3})\s*(?:→|->|to|-)\s*([A-Z]{3})/gi;
const CONF = /\b(?:conf(?:irmation)?|pnr|record\s*locator)[:\s#]*([A-Z0-9]{4,12})\b/gi;
const HOTEL =
  /\b((?:the\s+)?(?:park\s+hyatt|hyatt|okura|marriott|hilton|airbnb|montage|four\s+seasons|ritz)[^.,\n]{0,40})/gi;
const DINING = /\b(?:dinner|lunch|reservation)\s+(?:at\s+)?([A-Z][^.,\n]{2,40})/gi;

function countGaps(legs: ImportLeg[]): number {
  return legs.filter((l) => {
    if (l.confidence === "low") return true;
    if ((l.kind === "flight" || l.kind === "stay") && !l.confirmation) return true;
    return false;
  }).length;
}

export function heuristicImportParse(text: string): ImportParseResult {
  const { brief, assumptions } = heuristicParse(text);
  const legs: ImportLeg[] = [];
  const confs = [...text.matchAll(CONF)].map((m) => m[1]!.toUpperCase());
  let confIdx = 0;

  for (const m of text.matchAll(FLIGHT)) {
    const carrier = m[1]!.toUpperCase();
    const num = m[2]!;
    const from = m[3]!.toUpperCase();
    const to = m[4]!.toUpperCase();
    const conf = confs[confIdx];
    if (conf) confIdx++;
    legs.push({
      kind: "flight",
      supplier: carrier,
      title: `${carrier} ${num} · ${from} → ${to}`,
      detail: "From your pasted itinerary",
      confirmation: conf,
      confidence: conf ? "high" : "medium",
      sourceHint: "pasted text",
    });
  }

  for (const m of text.matchAll(HOTEL)) {
    const name = m[1]!.replace(/\s+/g, " ").trim();
    const conf = confs[confIdx];
    if (conf) confIdx++;
    legs.push({
      kind: "stay",
      supplier: name.split(/\s+/)[0] ?? "Hotel",
      title: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      detail: brief.returnDate ? `Through ${brief.returnDate}` : undefined,
      confirmation: conf,
      confidence: conf ? "high" : "medium",
      sourceHint: "pasted text",
    });
  }

  for (const m of text.matchAll(DINING)) {
    const venue = m[1]!.trim();
    legs.push({
      kind: "dining",
      supplier: venue,
      title: venue,
      detail: "Reservation mentioned in text",
      confidence: "low",
      sourceHint: "pasted text",
    });
  }

  if (!legs.length && brief.destination) {
    legs.push({
      kind: "flight",
      supplier: "Unknown",
      title: `Trip to ${brief.destination}`,
      detail: "Add flight details or upload a confirmation screenshot",
      confidence: "low",
      sourceHint: "inferred from destination",
    });
    assumptions.push("couldn't read specific legs — add flights, hotels, or confirmations");
  }

  return { brief, legs, assumptions, via: "heuristic", gaps: countGaps(legs) };
}
