// Picks the supplier from config: token present → Duffel, absent → mock. One place to add
// future suppliers / multi-supplier fan-out.
import type { SupplierAdapter } from "./adapter.ts";
import { config } from "../config.ts";
import { DuffelSupplier } from "./duffel.ts";
import { MockSupplier } from "./mock.ts";

export function getSupplier(): SupplierAdapter {
  return config.supplier === "duffel" ? new DuffelSupplier() : new MockSupplier();
}
