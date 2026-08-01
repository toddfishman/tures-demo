// Booking store — durable when DATA_DIR is set (see db/persist). Idempotency + per-account
// lookups are derived from the collection so they survive restarts too.
import type { Booking } from "./types.ts";
import { Collection } from "../db/persist.ts";

class BookingStore {
  private byId = new Collection<Booking>("bookings");

  get(id: string): Booking | undefined {
    return this.byId.get(id);
  }

  getByIdemKey(key: string): Booking | undefined {
    return this.byId.values().find((b) => b.idempotencyKey === key);
  }

  /** Lookup by execution tripId — used to authorize the per-trip SSE stream. */
  getByTripId(tripId: string): Booking | undefined {
    return this.byId.values().find((b) => b.tripId === tripId);
  }

  /** Active booked trips whose travel window is current/upcoming — the watcher's worklist. */
  activeBooked(): Booking[] {
    return this.byId.values().filter((b) => b.status === "booked");
  }

  /** All bookings for an account, newest first — the account dashboard's trip list. */
  listByAccount(accountId: string): Booking[] {
    return this.byId
      .values()
      .filter((b) => b.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  put(b: Booking): Booking {
    b.updatedAt = new Date().toISOString();
    this.byId.set(b.id, b);
    return b;
  }
}

export const bookings = new BookingStore();

let bookingCounter = 0;
export function nextBookingId(): string {
  return `bk_${Date.now().toString(36)}_${bookingCounter++}`;
}
