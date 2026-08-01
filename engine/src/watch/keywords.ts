// Compact alert keywords + X recent-search query per trip (under 512 chars).
import type { Brief } from "../types.ts";
import { geocode } from "../geo/index.ts";

const DISRUPT = "(strike OR delay OR cancelled OR closure OR protest OR storm OR flood OR ground stop)";

function iataCodes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []) {
    if (!["THE", "AND", "FOR", "VIA", "ALL"].includes(m)) out.add(m);
  }
  return [...out];
}

export function buildWatchKeywords(brief: Brief): string[] {
  const keys = new Set<string>();
  for (const field of [brief.origin, brief.destination]) {
    if (!field) continue;
    iataCodes(field).forEach((c) => keys.add(c));
    field.split(/[\s,–-]+/).forEach((w) => {
      const t = w.trim();
      if (t.length >= 4 && /^[A-Za-z]/.test(t)) keys.add(t);
    });
  }
  return [...keys].slice(0, 8);
}

/** X recent-search query — destination-scoped disruption terms. */
export async function buildXQuery(brief: Brief): Promise<string | undefined> {
  const codes = [...new Set([...iataCodes(brief.origin || ""), ...iataCodes(brief.destination || "")])];
  const geo = await geocode(brief.destination || "");
  const city = geo?.label?.split(",")[0]?.trim();
  const placeParts: string[] = [];
  codes.slice(0, 3).forEach((c) => placeParts.push(c));
  if (city) placeParts.push(city.includes(" ") ? `"${city}"` : city);
  if (!placeParts.length) return undefined;
  const q = `(${placeParts.join(" OR ")}) ${DISRUPT} -is:retweet lang:en`;
  return q.length <= 512 ? q : q.slice(0, 509) + "…";
}
