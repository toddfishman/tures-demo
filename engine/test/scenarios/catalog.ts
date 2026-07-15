import type { Scenario } from "./types.ts";

/** Scenario catalog — grow toward 40+. Run: npm run test:scenarios */
export const SCENARIOS: Scenario[] = [
  // ── A. Airport + ground transfer ──
  {
    id: "pdx-cb-transport-parse",
    name: "PDX → Cannon Beach: parse sets lodging + transport scope",
    tier: "deterministic",
    tags: ["transfer", "scope"],
    parse: {
      text: "From Seattle, need transport from PDX to Cannon Beach, two adults, August 15 for 5 days, balanced budget economy.",
      assumptions: ["transport"],
      brief: {
        origin: "SEA",
        destination: "PDX",
        lodgingArea: "Cannon Beach",
        tripScope: "flights_transport",
        adults: 2,
      },
    },
  },
  {
    id: "pdx-cb-discover",
    name: "PDX → Cannon Beach: discover skips Portland extras",
    tier: "deterministic",
    tags: ["transfer", "discover"],
    discover: {
      brief: {
        origin: "SEA",
        destination: "PDX",
        departDate: "2026-08-15",
        lodgingArea: "Cannon Beach, OR",
        tripScope: "flights_transport",
        adults: 2,
      },
      diningCount: 0,
      activitiesCount: 0,
      transportMinMiles: 60,
      transportMaxMiles: 110,
      routeIncludes: "Cannon Beach",
    },
  },
  {
    id: "cb-abbreviation",
    name: "Fly SEA → PDX, lodging CB",
    tier: "deterministic",
    tags: ["transfer"],
    parse: {
      text: "Fly SEA to PDX then drive to CB for a week, two adults.",
      brief: { origin: "SEA", destination: "PDX", lodgingArea: "Cannon Beach", adults: 2 },
    },
  },
  {
    id: "paris-full-discover",
    name: "Paris full trip: discover returns transport",
    tier: "deterministic",
    tags: ["discover", "full"],
    discover: {
      brief: {
        origin: "JFK",
        destination: "CDG",
        departDate: "2026-09-01",
        tripScope: "full",
        adults: 2,
      },
      transportMinMiles: 8,
    },
  },
  // ── B. Scope narrowing ──
  {
    id: "scope-flight-car-heuristic",
    name: "Heuristic: just flight plus car service",
    tier: "deterministic",
    tags: ["scope", "correction"],
    parse: {
      text: "From SFO to PDX Dec 1-5, two adults, just flight plus car service, economy balanced.",
      brief: { tripScope: "flights_transport", destination: "PDX" },
    },
  },
  {
    id: "scope-no-extras",
    name: "Heuristic: no activities or restaurants",
    tier: "deterministic",
    tags: ["scope"],
    parse: {
      text: "Weekend in Paris from JFK, no activities or restaurants, boutique stay.",
      brief: { tripScope: "flights_stay", destination: "CDG" },
    },
  },
  // ── C. Travelers ──
  {
    id: "family-four-two-kids",
    name: "Family of 4 with 2 kids",
    tier: "deterministic",
    tags: ["travelers"],
    parse: {
      text: "Family of 4 (2 kids) from Seattle to Maui in June, premium, treat ourselves.",
      brief: { adults: 2, children: 2, origin: "SEA", destination: "OGG" },
    },
  },
  {
    id: "hawaii-route",
    name: "Seattle to Maui, two of us",
    tier: "deterministic",
    tags: ["routing"],
    parse: {
      text: "Two of us from Seattle to Maui for a week in December, oceanfront.",
      brief: { origin: "SEA", destination: "OGG", adults: 2 },
    },
  },
  // ── D. Replay goldens (free — no LLM call) ──
  {
    id: "replay-pdx-cb-opener",
    name: "Replay: PDX → CB opener acknowledges ~90 min drive",
    tier: "replay",
    goldenId: "pdx-cb-opener",
    tags: ["transfer", "converse", "replay"],
    turns: [
      {
        user: "I need transport from PDX to Cannon Beach",
        replyIncludes: ["90", "minute", "PDX"],
        replyExcludes: ["restaurant", "things to do"],
      },
    ],
  },
  {
    id: "replay-pdx-cb-journey",
    name: "Replay: full PDX→CB brief → discover transport-only",
    tier: "replay",
    goldenId: "pdx-cb-handoff",
    tags: ["transfer", "journey", "replay"],
    turns: [
      {
        user: "From Seattle, fly into PDX mid-August for 5 days, two adults, balanced economy. Ground transfer to Cannon Beach — flight and car only, no hotel or activities.",
        expectReady: true,
        slots: { destination: "PDX", lodgingArea: "Cannon", scope: "transport" },
      },
    ],
    journey: {
      discover: {
        brief: {
          origin: "SEA",
          destination: "PDX",
          departDate: "2026-08-15",
          lodgingArea: "Cannon Beach, OR",
          tripScope: "flights_transport",
        },
        diningCount: 0,
        activitiesCount: 0,
        transportMinMiles: 60,
      },
      planHasStay: false,
    },
  },
  // ── E. Live LLM (skipped in CI; run nightly with --llm --record) ──
  {
    id: "llm-pdx-cb-opener",
    name: "Live LLM: PDX → Cannon Beach opener",
    tier: "llm",
    goldenId: "pdx-cb-opener",
    tags: ["transfer", "converse", "llm", "sakana"],
    turns: [
      {
        user: "I need transport from PDX to Cannon Beach",
        replyIncludes: ["PDX"],
        replyIncludesAny: ["90", "minute", "Cannon", "coast", "drive"],
        replyExcludes: ["restaurant", "things to do"],
      },
    ],
  },
  {
    id: "llm-brain-compare",
    name: "Live LLM: logs via (fugu vs anthropic) for Sakana eval",
    tier: "llm",
    tags: ["llm", "sakana"],
    turns: [{ user: "Fly from Seattle to Portland, ground transfer to Cannon Beach, two adults, mid-August, balanced." }],
  },
];
