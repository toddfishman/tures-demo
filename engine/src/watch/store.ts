import { Collection } from "../db/persist.ts";
import type { TripWatch } from "./types.ts";

class WatchStore {
  private byId = new Collection<TripWatch>("trip_watches");

  get(bookingId: string): TripWatch | undefined {
    return this.byId.get(bookingId);
  }

  getByTripId(tripId: string): TripWatch | undefined {
    return this.byId.values().find((w) => w.tripId === tripId);
  }

  active(): TripWatch[] {
    return this.byId.values().filter((w) => w.enabled);
  }

  put(w: TripWatch): TripWatch {
    return this.byId.set(w.bookingId, w);
  }

  delete(bookingId: string): void {
    this.byId.delete(bookingId);
  }
}

export const watches = new WatchStore();
