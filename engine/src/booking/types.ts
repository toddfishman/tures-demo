// Booking domain — the money-moving side of the engine. A booking is a small state machine
// with a human-confirm gate in the middle; nothing is charged until it is explicitly confirmed.
import type { Brief, Offer } from "../types.ts";

export type BookingStatus =
  | "confirmation_required" // gate open — awaiting explicit human confirm. No money moved.
  | "booking" // confirm received, executing charge + supplier orders
  | "booked" // all components confirmed
  | "failed"; // policy violation or supplier/payment error

export interface BookedComponent {
  kind: Offer["kind"];
  offerId: string;
  supplier: string;
  title: string;
  amountUsd: number;
  confirmation?: string; // PNR / booking ref once booked
  status: "pending" | "confirmed" | "failed";
}

export interface PaymentRecord {
  provider: "stripe" | "mock";
  intentId: string;
  amountUsd: number;
  currency: string;
  status: "requires_confirmation" | "succeeded" | "failed";
  live: boolean;
}

export interface AuditEntry {
  ts: string;
  actor: "agent" | "user" | "system";
  action: string;
  detail?: string;
}

export interface Booking {
  id: string;
  tripId: string;
  brief: Brief;
  status: BookingStatus;
  totalUsd: number;
  currency: string;
  components: BookedComponent[];
  payment?: PaymentRecord;
  /** Why the gate is open / why it failed — surfaced to the client. */
  violations: string[];
  audit: AuditEntry[];
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}
