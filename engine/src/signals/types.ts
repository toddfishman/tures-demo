// Situational awareness — the "alarm system" that watches a trip's world before and during travel.
// A Signal is one thing worth knowing about a place + time window: weather, air, a transit strike,
// a festival that clogs the city, a safety note, a fare/event opportunity. Providers fetch signals
// from real sources; the watcher surfaces fresh ones onto the trip's live stream so Tures can act
// (or flag for the Hiccup Handler) BEFORE it reaches the traveler.
//
// Honesty rule (mirrors the booking layer's "no fake success"): a provider that lacks what it needs
// (a key, a resolvable location) reports itself NOT configured and returns nothing. It never invents
// a signal — an empty result means "we genuinely found nothing," not "we couldn't look."

export type SignalSeverity = "info" | "watch" | "warning" | "critical";

export type SignalCategory =
  | "weather"
  | "air"
  | "advisory" // safety / security / entry rules
  | "transit" // flights, trains, strikes, closures
  | "traffic" // roads, construction
  | "event" // festivals, marathons, holidays that change a place
  | "health"
  | "news";

export interface Signal {
  /** Stable per (category + place + day/topic) so repeated sweeps don't re-alert the same thing. */
  id: string;
  category: SignalCategory;
  severity: SignalSeverity;
  title: string; // short headline, no period
  detail?: string; // one or two sentences
  source: string; // where it came from, e.g. "Open-Meteo", "web"
  url?: string;
  /** The window this pertains to (ISO dates), if dated. */
  when?: { from?: string; to?: string };
  /** Could plausibly affect flights / ground plans → a candidate to escalate to the Hiccup Handler. */
  travelImpacting?: boolean;
}

/** Resolved context a provider needs: a located destination + the trip's dates. */
export interface SignalContext {
  destination: string; // raw brief.destination (IATA or city)
  origin?: string;
  departDate?: string;
  returnDate?: string;
  label: string; // human "City, Country"
  lat: number;
  lng: number;
}

export interface SignalProvider {
  name: string;
  category: SignalCategory;
  /** Whether this provider can run right now (has its key / data). Unconfigured → skipped + reported. */
  configured(): boolean;
  /** Fetch signals for this trip. MUST resolve (never reject) — return [] on any error or no-news. */
  fetch(ctx: SignalContext): Promise<Signal[]>;
}

const SEVERITY_RANK: Record<SignalSeverity, number> = { critical: 3, warning: 2, watch: 1, info: 0 };

/** Most severe first; de-duplicated by id (first occurrence wins). */
export function rankAndDedupe(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  const unique = signals.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  return unique.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
