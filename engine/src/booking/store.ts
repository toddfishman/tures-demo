// In-memory booking store. One place behind a tiny interface so Chunk 6 swaps in Prisma/Postgres
// without touching the booking service. Also tracks idempotency keys → booking id.
import type { Booking } from "./types.ts";

class BookingStore {
  private byId = new Map<string, Booking>();
  private byIdemKey = new Map<string, string>();

  get(id: string): Booking | undefined {
    return this.byId.get(id);
  }

  getByIdemKey(key: string): Booking | undefined {
    const id = this.byIdemKey.get(key);
    return id ? this.byId.get(id) : undefined;
  }

  put(b: Booking): Booking {
    b.updatedAt = new Date().toISOString();
    this.byId.set(b.id, b);
    if (b.idempotencyKey) this.byIdemKey.set(b.idempotencyKey, b.id);
    return b;
  }
}

export const bookings = new BookingStore();

let bookingCounter = 0;
export function nextBookingId(): string {
  return `bk_${Date.now().toString(36)}_${bookingCounter++}`;
}
