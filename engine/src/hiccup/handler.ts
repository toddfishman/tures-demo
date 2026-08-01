// The Hiccup Handler — when a booked trip breaks, work out what it costs the traveller and do
// the smallest correct thing about it.
//
//   triage → options → authority → (rebook | propose | monitor | ignore)
//
// What changed from v1, and why:
//   • TRIAGE FIRST. Every disruption used to go straight to a rebook. A 40-minute delay now gets
//     watched, a destination closure gets reported, and only a real break gets acted on.
//   • THE REPLACEMENT CAN NEVER BE THE DISRUPTED LEG. The old `?? flights[0]` fallback could
//     rebook a cancelled flight onto itself. See options.ts.
//   • PROPOSALS ARE REAL. They persist with an expiry and can be accepted or declined later,
//     from any surface. Previously "proposed" emitted an event into the void.
//   • ONE EVENT, ONE RESPONSE. Disruptions carry a dedupe key, so three signals about one storm
//     produce one proposal — not three rebooks and three fare differences.
//   • WE DON'T MOVE WHAT WE DON'T OWN. Concierge Mode imports are advised, never rebooked.
//   • MONEY IS ORDERED SAFELY. Seat first, then the fare difference. See execute.ts.
import type { Booking } from "../booking/types.ts";
import { bookings } from "../booking/store.ts";
import { cachedOffers } from "../booking/service.ts";
import { emitEvent } from "../events/bus.ts";
import { log } from "../logger.ts";
import { remember } from "../mem0.ts";
import { observe as observeTaste } from "../taste/service.ts";
import { triage } from "./triage.ts";
import { findOptions, resolveOffer } from "./options.ts";
import { swapComponent } from "./execute.ts";
import { proposals } from "./store.ts";
import { PROPOSAL_TTL_MIN, type Disruption, type HiccupProposal, type RebookResolution } from "./types.ts";

export type { Disruption, RebookResolution } from "./types.ts";

function audit(b: Booking, action: string, detail?: string) {
  b.audit.push({ ts: new Date().toISOString(), actor: "agent", action, detail });
}

function record(booking: Booking, disruption: Disruption, resolution: RebookResolution) {
  booking.hiccups = booking.hiccups ?? [];
  booking.hiccups.push({
    ts: new Date().toISOString(),
    kind: disruption.kind,
    detail: disruption.detail ?? "",
    resolution: resolution.status,
  });
  bookings.put(booking);
  return { resolution, booking };
}

export async function handleDisruption(
  bookingId: string,
  disruption: Disruption,
): Promise<{ resolution: RebookResolution; booking: Booking } | null> {
  const booking = bookings.get(bookingId);
  if (!booking) return null;
  const tripId = booking.tripId;

  // ── 1. Triage ─────────────────────────────────────────────────────────────────────────
  const t = triage(booking, disruption);

  if (t.action === "ignore") {
    emitEvent(tripId, "hiccup", "Disruption noted, no action needed", { detail: t.reason, data: { bookingId } });
    return record(booking, disruption, { status: "no_action", disruption, reason: t.reason, ripple: t.ripple });
  }

  emitEvent(tripId, "hiccup", `Disruption: ${disruption.kind.replace(/_/g, " ")}`, {
    detail: t.reason,
    data: { bookingId, action: t.action, severity: disruption.severity, adviseOnly: t.adviseOnly },
  });
  audit(booking, "disruption_detected", `${disruption.kind}: ${t.reason}`);

  if (t.action === "monitor") {
    // Real, but not worth moving anyone over. Tell them, keep watching. This is the branch that
    // used to rebook people over a forty-minute delay.
    emitEvent(tripId, "notify", "Watching this one", {
      detail: [t.reason, ...t.ripple].join(" · "),
      data: { bookingId, monitoring: true },
    });
    audit(booking, "hiccup_monitoring", t.reason);
    return record(booking, disruption, { status: "monitoring", disruption, reason: t.reason, ripple: t.ripple, adviseOnly: t.adviseOnly });
  }

  const componentIndex = t.componentIndex;
  const component = booking.components[componentIndex];
  if (!component) {
    return record(booking, disruption, { status: "no_action", disruption, reason: "the affected component disappeared mid-flight", ripple: t.ripple });
  }

  // ── 2. Dedupe ─────────────────────────────────────────────────────────────────────────
  // One underlying event gets one response. Without this the watcher's escalations stack.
  const key = proposals.dedupeKey(bookingId, disruption, componentIndex);
  const live = proposals.liveForKey(bookingId, key);
  if (live) {
    log.info("hiccup deduped onto existing proposal", { bookingId, proposalId: live.id });
    return record(booking, disruption, {
      status: "proposed",
      disruption,
      reason: `already asked you about this — ${live.options[0]?.title ?? "the alternatives"} is still waiting on your word`,
      proposalId: live.id,
      ripple: t.ripple,
      adviseOnly: t.adviseOnly,
    });
  }

  // ── 3. Find real replacements ─────────────────────────────────────────────────────────
  const cached = cachedOffers(bookingId);
  const disruptedOffer = component.kind === "stay" ? cached?.stay : cached?.flight;
  const { options, empty, searched } = await findOptions(booking, component, disruptedOffer);

  if (empty || !options.length) {
    const reason = searched > 0
      ? `nothing available that isn't the ${component.kind} that just fell through (${searched} searched)`
      : "no alternatives came back from the supplier";
    emitEvent(tripId, "error", "No replacement found", { detail: reason, data: { bookingId } });
    audit(booking, "rebook_failed", reason);
    return record(booking, disruption, { status: "no_action", disruption, reason, ripple: t.ripple, adviseOnly: t.adviseOnly });
  }

  const best = options[0]!;

  // ── 4. Standing authority ─────────────────────────────────────────────────────────────
  const rb = booking.brief.rebooking ?? { mode: "propose" as const };
  const newTotal = booking.totalUsd - component.amountUsd + best.priceUsd;
  const withinBudget = !booking.brief.budgetUsd || newTotal <= booking.brief.budgetUsd;
  const withinUpcharge = rb.maxUpchargeUsd === undefined || best.upchargeUsd <= rb.maxUpchargeUsd;
  const autoOk = t.action === "rebook" && !t.adviseOnly && rb.mode === "auto" && withinBudget && withinUpcharge;

  if (!autoOk) {
    const askReason = t.adviseOnly
      ? "this trip came from your own booking — Tures can find the fix but cannot change someone else's reservation for you"
      : t.action === "propose"
        ? t.reason
        : rb.mode !== "auto"
          ? "your standing authority is propose-only"
          : !withinBudget
            ? `it would push the trip to $${newTotal.toLocaleString()}, over your $${booking.brief.budgetUsd?.toLocaleString()} budget`
            : `the $${best.upchargeUsd.toLocaleString()} fare difference is over your $${rb.maxUpchargeUsd?.toLocaleString()} cap`;

    const proposal = createProposal(booking, componentIndex, disruption, options, askReason, t.ripple);
    proposals.supersedeOthers(bookingId, componentIndex, proposal.id);

    emitEvent(tripId, "hiccup", "Rebooking needs your OK", {
      detail: `${best.title} (${best.upchargeUsd >= 0 ? "+" : "−"}$${Math.abs(best.upchargeUsd).toLocaleString()}) — ${askReason}`,
      data: { bookingId, proposalId: proposal.id, options: proposal.options, ripple: t.ripple, adviseOnly: t.adviseOnly, expiresAt: proposal.expiresAt },
    });
    for (const r of t.ripple) emitEvent(tripId, "notify", "Knock-on effect", { detail: r, data: { bookingId, proposalId: proposal.id } });
    audit(booking, "rebook_proposed", `${options.length} option(s), best ${best.title} — ${askReason}`);

    return record(booking, disruption, {
      status: "proposed",
      disruption,
      from: component.title,
      to: best.title,
      upchargeUsd: best.upchargeUsd,
      reason: `proposed ${best.title} — ${askReason}`,
      proposalId: proposal.id,
      ripple: t.ripple,
      adviseOnly: t.adviseOnly,
    });
  }

  // ── 5. Auto-rebook, within the authority the brief granted ────────────────────────────
  return applyOption(booking, componentIndex, disruption, best.offerId, { auto: true, ripple: t.ripple });
}

function createProposal(
  booking: Booking,
  componentIndex: number,
  disruption: Disruption,
  options: HiccupProposal["options"],
  askReason: string,
  ripple: string[],
): HiccupProposal {
  const now = new Date();
  const proposal: HiccupProposal = {
    id: proposals.nextProposalId(),
    bookingId: booking.id,
    tripId: booking.tripId,
    accountId: booking.accountId,
    componentIndex,
    disruption,
    options,
    status: "pending",
    askReason,
    ripple,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MIN * 60_000).toISOString(),
  };
  return proposals.put(proposal);
}

/**
 * Commit a specific replacement — the shared path for an auto-rebook and for a traveler accepting
 * a proposal. Re-resolves the offer against a fresh search first: an option quoted forty minutes
 * ago may no longer exist, and booking a stale id would be exactly the fake success we forbid.
 */
export async function applyOption(
  booking: Booking,
  componentIndex: number,
  disruption: Disruption,
  offerId: string,
  opts: { auto: boolean; ripple?: string[]; proposalId?: string },
): Promise<{ resolution: RebookResolution; booking: Booking }> {
  const tripId = booking.tripId;
  const component = booking.components[componentIndex];
  const ripple = opts.ripple ?? [];

  if (!component) {
    return record(booking, disruption, { status: "no_action", disruption, reason: "that leg is no longer on the booking", ripple });
  }

  const replacement = await resolveOffer(booking, component.kind, offerId);
  if (!replacement) {
    const reason = "that option is gone — fares move, and Tures will not book an id it can no longer see";
    emitEvent(tripId, "error", "That option is no longer available", { detail: reason, data: { bookingId: booking.id, offerId, proposalId: opts.proposalId } });
    audit(booking, "rebook_failed", reason);
    if (opts.proposalId) proposals.resolve(opts.proposalId, "expired", { failure: reason });
    return record(booking, disruption, { status: "no_action", disruption, reason, ripple, proposalId: opts.proposalId });
  }

  const previousTitle = component.title;
  const upchargeUsd = Math.round((replacement.priceUsd - component.amountUsd) * 100) / 100;
  const swap = await swapComponent(booking, componentIndex, replacement, { idemSuffix: opts.proposalId ?? Date.now().toString(36) });

  if (!swap.ok) {
    if (opts.proposalId) proposals.resolve(opts.proposalId, "pending", { failure: swap.error });
    return record(booking, disruption, { status: "no_action", disruption, reason: `could not secure ${replacement.title}: ${swap.error}`, ripple, proposalId: opts.proposalId });
  }

  const money = upchargeUsd === 0 ? "no fare difference" : `${upchargeUsd > 0 ? "+" : "−"}$${Math.abs(upchargeUsd).toLocaleString()}`;
  emitEvent(tripId, "hiccup", `Rebooked: ${replacement.title}`, {
    detail: `${swap.confirmation} · ${money}${opts.auto ? " — handled automatically" : " — on your OK"}${swap.paymentIssue ? " · fare difference unpaid" : ""}`,
    data: { bookingId: booking.id, confirmation: swap.confirmation, simulated: swap.simulated, proposalId: opts.proposalId },
  });
  emitEvent(tripId, "notify", swap.paymentIssue ? "Disruption handled — one thing to fix" : "Disruption handled", {
    detail: swap.paymentIssue
      ? `You're on ${replacement.title}. The fare difference needs a working card.`
      : `You're rebooked on ${replacement.title}. Nothing for you to do.`,
    data: { bookingId: booking.id },
  });
  for (const r of ripple) emitEvent(tripId, "notify", "Still worth handling", { detail: r, data: { bookingId: booking.id } });

  if (opts.proposalId) proposals.resolve(opts.proposalId, "accepted", { chosenOfferId: offerId });

  // Memory + taste. An accepted rebooking is a genuine choice between real alternatives, so it
  // teaches the Taste Print the same way a booking does — just more weakly, since the traveler
  // was picking under duress rather than freely.
  if (booking.accountId && booking.accountId !== "demo") {
    void remember(booking.accountId, [
      { role: "user", content: `Trip disruption: ${disruption.kind}${disruption.detail ? ` — ${disruption.detail}` : ""}` },
      { role: "assistant", content: `Rebooked ${previousTitle} → ${replacement.title} (${swap.confirmation})${swap.simulated ? " [sample]" : ""}` },
    ]);
    if (!opts.auto) observeTaste(booking.accountId, { type: "booked", chosen: replacement, note: `chose ${replacement.title} after a ${disruption.kind.replace(/_/g, " ")}` });
  }

  return record(booking, disruption, {
    status: "rebooked",
    disruption,
    from: previousTitle,
    to: replacement.title,
    upchargeUsd,
    reason: opts.auto ? `auto-rebooked on ${replacement.title} (${money})` : `rebooked on ${replacement.title} (${money}) on your approval`,
    ripple,
    proposalId: opts.proposalId,
  });
}

/** Accept a pending proposal — from the app, a Telegram reply, or a voice "yes". */
export async function acceptProposal(proposalId: string, offerId?: string): Promise<{ resolution: RebookResolution; booking: Booking } | null> {
  const p = proposals.get(proposalId);
  if (!p) return null;
  if (p.status !== "pending") {
    const booking = bookings.get(p.bookingId);
    if (!booking) return null;
    return { resolution: { status: "no_action", disruption: p.disruption, reason: `that proposal is already ${p.status}` }, booking };
  }
  if (Date.parse(p.expiresAt) <= Date.now()) {
    proposals.resolve(p.id, "expired");
    const booking = bookings.get(p.bookingId);
    if (!booking) return null;
    return {
      resolution: { status: "no_action", disruption: p.disruption, reason: "those fares have expired — reporting the disruption again will pull fresh options" },
      booking,
    };
  }
  const booking = bookings.get(p.bookingId);
  if (!booking) return null;

  const chosen = offerId ?? p.options[0]?.offerId;
  if (!chosen) return { resolution: { status: "no_action", disruption: p.disruption, reason: "that proposal has no options left" }, booking };
  // Only options we actually offered may be accepted — never an arbitrary id from the client.
  if (!p.options.some((o) => o.offerId === chosen)) {
    return { resolution: { status: "no_action", disruption: p.disruption, reason: "that option was not one of the ones offered" }, booking };
  }

  booking.audit.push({ ts: new Date().toISOString(), actor: "user", action: "rebook_approved", detail: `accepted ${chosen}` });
  return applyOption(booking, p.componentIndex, p.disruption, chosen, { auto: false, ripple: p.ripple, proposalId: p.id });
}

/** Decline a proposal. The disruption stands — we just aren't moving anyone over it. */
export function declineProposal(proposalId: string, note?: string): HiccupProposal | undefined {
  const p = proposals.resolve(proposalId, "declined", { failure: note });
  if (!p) return undefined;
  const booking = bookings.get(p.bookingId);
  if (booking) {
    booking.audit.push({ ts: new Date().toISOString(), actor: "user", action: "rebook_declined", detail: note ?? "traveler declined the proposed fix" });
    bookings.put(booking);
    emitEvent(booking.tripId, "notify", "Left as is", {
      detail: `Keeping ${booking.components[p.componentIndex]?.title ?? "the original booking"}. Tures is still watching it.`,
      data: { bookingId: booking.id, proposalId: p.id },
    });
  }
  return p;
}

export { proposals };
