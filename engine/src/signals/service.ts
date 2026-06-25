// gatherSignals — locate the destination, run the configured providers, return ranked signals.
// Fast by default (weather + air + any keyed feeds); `deep` adds the Claude web scout. Never throws:
// a provider that errors contributes nothing.
import { geocode } from "../geo/index.ts";
import { FAST_PROVIDERS, DEEP_PROVIDERS, providerStatus } from "./registry.ts";
import { rankAndDedupe, type Signal, type SignalContext } from "./types.ts";

export interface GatherInput {
  destination: string;
  origin?: string;
  departDate?: string;
  returnDate?: string;
}

export interface GatherResult {
  located: boolean;
  context?: SignalContext;
  signals: Signal[];
  providers: ReturnType<typeof providerStatus>;
}

export async function gatherSignals(input: GatherInput, opts: { deep?: boolean } = {}): Promise<GatherResult> {
  const geo = await geocode(input.destination);
  if (!geo) return { located: false, signals: [], providers: providerStatus() };

  const ctx: SignalContext = { ...input, label: geo.label, lat: geo.lat, lng: geo.lng };
  const providers = [...FAST_PROVIDERS, ...(opts.deep ? DEEP_PROVIDERS : [])].filter((p) => p.configured());
  const results = await Promise.all(providers.map((p) => p.fetch(ctx).catch(() => [] as Signal[])));

  return { located: true, context: ctx, signals: rankAndDedupe(results.flat()), providers: providerStatus() };
}
