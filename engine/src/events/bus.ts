// In-process event bus. The agent emits ExecutionEvents here; the SSE route subscribes and
// streams them to the front-end. Per-trip topics so one browser only sees its own trip.
// Chunk 6 swaps the in-memory impl for Redis pub/sub when we run more than one instance.
import type { ExecutionEvent } from "../types.ts";
import { onExecutionEvent } from "../notify/proactive.ts";

type Listener = (e: ExecutionEvent) => void;

class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  /** Short replay buffer so a browser that connects mid-trip catches recent events. */
  private history = new Map<string, ExecutionEvent[]>();
  private static MAX_HISTORY = 200;

  publish(event: ExecutionEvent) {
    const buf = this.history.get(event.tripId) ?? [];
    buf.push(event);
    if (buf.length > EventBus.MAX_HISTORY) buf.shift();
    this.history.set(event.tripId, buf);

    for (const l of this.listeners.get(event.tripId) ?? []) l(event);
    onExecutionEvent(event);
  }

  subscribe(tripId: string, listener: Listener): () => void {
    const set = this.listeners.get(tripId) ?? new Set();
    set.add(listener);
    this.listeners.set(tripId, set);
    return () => set.delete(listener);
  }

  replay(tripId: string): ExecutionEvent[] {
    return this.history.get(tripId) ?? [];
  }
}

export const bus = new EventBus();

let seq = 0;
/** Build + publish an event in one call. ts is monotonic-ish via process clock. */
export function emitEvent(
  tripId: string,
  kind: ExecutionEvent["kind"],
  label: string,
  extra?: { detail?: string; data?: Record<string, unknown> },
): ExecutionEvent {
  const event: ExecutionEvent = {
    ts: new Date().toISOString(),
    tripId,
    kind,
    label,
    detail: extra?.detail,
    data: { seq: seq++, ...(extra?.data ?? {}) },
  };
  bus.publish(event);
  return event;
}
