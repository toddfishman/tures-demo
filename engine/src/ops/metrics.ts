// Lightweight in-process metrics. Swap for Prometheus/OpenTelemetry later; the call sites stay.
const startedAtMs = Date.now();

const counters = {
  requests: 0,
  byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } as Record<string, number>,
  errors: 0,
};

let totalDurationMs = 0;

export function recordResponse(statusCode: number, durationMs: number) {
  counters.requests++;
  const cls = `${Math.floor(statusCode / 100)}xx`;
  if (counters.byClass[cls] !== undefined) counters.byClass[cls]++;
  if (statusCode >= 500) counters.errors++;
  totalDurationMs += durationMs;
}

export function metricsSnapshot() {
  return {
    uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
    requests: counters.requests,
    byClass: counters.byClass,
    errors: counters.errors,
    avgMs: counters.requests ? Math.round((totalDurationMs / counters.requests) * 10) / 10 : 0,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
}
