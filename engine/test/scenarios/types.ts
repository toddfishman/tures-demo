// Scenario contract for the Tures stress-test harness.
// Tiers:
//   deterministic — parse heuristics, geocode, discover, transport, audit log ($0)
//   replay        — golden /converse transcripts, then real parse/plan/discover ($0)
//   llm           — live /converse; use --record to refresh goldens (costs $)
//   journey       — replay or live multi-turn → parse → discover

export type ScenarioTier = "deterministic" | "replay" | "llm" | "journey";

export interface ParseExpect {
  text: string;
  assumptions?: string[];
  brief: {
    origin?: string;
    destination?: string;
    lodgingArea?: string;
    tripScope?: "full" | "flights_stay" | "flights_transport" | "flights_only";
    adults?: number;
    children?: number;
  };
}

export interface DiscoverExpect {
  brief: Record<string, unknown>;
  diningCount?: number;
  activitiesCount?: number;
  staysCount?: number;
  transportMinMiles?: number;
  transportMaxMiles?: number;
  routeIncludes?: string;
}

export interface ConverseTurn {
  user: string;
  replyIncludes?: string[];
  replyExcludes?: string[];
  expectReady?: boolean;
  slots?: {
    destination?: string;
    lodgingArea?: string;
    scope?: string;
  };
}

export interface JourneyExpect {
  discover?: DiscoverExpect;
  planHasStay?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  tier: ScenarioTier;
  tags?: string[];
  /** Golden fixture id under test/replay/goldens/{id}.json — for replay tier. */
  goldenId?: string;
  parse?: ParseExpect;
  discover?: DiscoverExpect;
  turns?: ConverseTurn[];
  journey?: JourneyExpect;
}

export interface ScenarioResult {
  id: string;
  name: string;
  tier: ScenarioTier;
  passed: boolean;
  skipped?: boolean;
  skipReason?: string;
  ms: number;
  errors: string[];
}

/** Saved /converse response for replay mode. */
export interface GoldenFixture {
  id: string;
  recordedAt?: string;
  brain?: string;
  turns: {
    user: string;
    response: {
      reply: string;
      via?: "fugu" | "anthropic";
      ready?: boolean;
      brief?: string;
      slots?: Record<string, unknown>;
      sessionId?: string;
    };
  }[];
}
