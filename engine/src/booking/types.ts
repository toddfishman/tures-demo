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
  /** True when this confirmation is a SIMULATED sample (real inventory may have been searched,
   *  but no real order was placed and no money moved). Set whenever live booking is off. */
  simulated?: boolean;
  status: "pending" | "confirmed" | "failed" | "rebooked";
  /** Set when the Hiccup Handler replaced a disrupted component. */
  rebookedFrom?: { title: string; confirmation?: string };
  /** Which card the wallet selector chose for this charge, and why. */
  card?: { connectionId: string; key: string; name: string; last4?: string; reason: string };
  /** Which loyalty program this leg credits — matched to the booked carrier/chain, with estimated accrual. */
  loyalty?: { program: string; status?: string; numberMasked?: string; kind: string; estPoints: number; reason: string };
  payment?: PaymentRecord;
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
  accountId: string;
  brief: Brief;
  status: BookingStatus;
  totalUsd: number;
  currency: string;
  components: BookedComponent[];
  /** All charges across components (one per card used), plus any Tures fee. */
  charges: PaymentRecord[];
  /** Tures concierge fee charged for this booking ($0 for subscribers). */
  feeUsd?: number;
  /** Passenger/traveler details applied from the profile (audit-friendly, no raw PII). */
  passenger?: { note: string; ktnApplied: boolean; passportOnFile: boolean; loyaltyCredited: string[] };
  /** Disruptions the Hiccup Handler has processed for this booking. */
  hiccups?: Array<{ ts: string; kind: string; detail: string; resolution: string }>;
  /** Why the gate is open / why it failed — surfaced to the client. */
  violations: string[];
  audit: AuditEntry[];
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}
