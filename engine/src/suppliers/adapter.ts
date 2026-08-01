// The contract every supplier must satisfy. Duffel is v1; Amadeus / direct contracts slot
// in later without the search service or agent knowing which one answered.
import type { Brief, Offer } from "../types.ts";

export interface SupplierAdapter {
  readonly name: string;
  /** True when this adapter can move real money — the booking gate refuses it in dev. */
  readonly isLive: boolean;
  searchFlights(brief: Brief): Promise<Offer[]>;
  searchStays(brief: Brief): Promise<Offer[]>;
  /** Commit an offer into a real reservation. Optional: a supplier without this can be
   *  searched but not booked (the booking service guards against it). */
  book?(offer: Offer): Promise<{ confirmation: string }>;
}
