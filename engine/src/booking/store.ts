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
