// Run a single adaptive scan — fast, news, deep, or always-on alerts.
import type { Booking } from "../booking/types.ts";
import { gatherSignals } from "../signals/service.ts";
import { emitEvent } from "../events/bus.ts";
import { handleDisruption } from "../hiccup/handler.ts";
import { log } from "../logger.ts";
import { config } from "../config.ts";
import type { Signal } from "../signals/types.ts";
import type { TripWatch, ScanKind } from "./types.ts";
import { recordUsage, atCap, effectiveCap } from "./meter.ts";
import { assessRisk } from "./risk.ts";
import { pollXAlerts } from "./x.ts";
import { watches } from "./store.ts";

function inputFromBooking(b: Booking) {
  return {
    destination: b.brief.destination,
    origin: b.brief.origin,
    departDate: b.brief.departDate,
    returnDate: b.brief.returnDate,
  };
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function surfaceNewSignals(w: TripWatch, b: Booking, signals: Signal[]): number {
  const set = new Set(w.surfacedSignalIds);
  let n = 0;
  for (const s of signals) {
    if (set.has(s.id)) continue;
    set.add(s.id);
    n++;
    const kind = s.severity === "critical" || s.severity === "warning" ? "hiccup" : "notify";
    emitEvent(b.tripId, kind, s.title, {
      detail: s.detail,
      data: {
        bookingId: b.id,
        signalId: s.id,
        category: s.category,
        severity: s.severity,
        travelImpacting: !!s.travelImpacting,
        source: s.source,
        url: s.url,
        watch: true,
      },
    });
    if (s.travelImpacting && (s.severity === "critical" || s.severity === "warning")) {
      const disruptKind = s.category === "weather" ? ("delay" as const) : ("schedule_change" as const);
      void handleDisruption(b.id, { kind: disruptKind, detail: s.detail ?? s.title }).catch((e) =>
        log.warn("watch hiccup escalation failed", { bookingId: b.id, err: String(e) }),
      );
    }
  }
  w.surfacedSignalIds = [...set].slice(-500);
  return n;
}

async function pollNews(ctx: { label: string; lat: number; lng: number; departDate?: string; returnDate?: string; destination: string }): Promise<Signal[]> {
  if (!config.signals.newsApiKey) return [];
  const q = encodeURIComponent(`${ctx.label} travel OR airport OR strike OR weather`);
  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${config.signals.newsApiKey}`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { articles?: Array<{ title?: string; description?: string; url?: string }> };
    return (body.articles ?? []).slice(0, 5).map((a, i) => ({
      id: `news:${ctx.label}:${i}:${String(a.title || i).slice(0, 30)}`,
      category: "news" as const,
      severity: /strike|cancel|storm|closure|delay/i.test(String(a.title)) ? "warning" : "watch",
      title: String(a.title || "News").slice(0, 100),
      detail: a.description ? String(a.description).slice(0, 200) : undefined,
      source: "newsapi",
      url: a.url,
      travelImpacting: /strike|cancel|storm|airport|flight/i.test(String(a.title ?? "") + String(a.description ?? "")),
    }));
  } catch {
    return [];
  }
}

export async function runScan(w: TripWatch, b: Booking, kind: ScanKind): Promise<TripWatch> {
  if (!w.enabled) return w;
  if (atCap(w) && kind !== "alerts") {
    if (!w.pendingCapUsd) {
      w.pendingCapUsd = 5;
      w.updatedAt = new Date().toISOString();
      watches.put(w);
      emitEvent(b.tripId, "notify", "Trip Watch paused at cap", {
        detail: `Scan spend reached your $${effectiveCap(w)} cap. Approve $5 more to keep deep scans running, or alerts stay on.`,
        data: { bookingId: b.id, watch: true, pendingCapUsd: w.pendingCapUsd, atCap: true },
      });
    }
    return w;
  }
  const now = new Date().toISOString();
  const inp = inputFromBooking(b);
  let surfaced = 0;

  if (kind === "brief" || kind === "fast") {
    const r = await gatherSignals(inp, { deep: false });
    recordUsage(w, "open_meteo", 2);
    if (kind === "brief" && r.signals.length) {
      const a = assessRisk(r.signals, b.brief.departDate);
      w.riskScore = a.score;
      w.riskLevel = a.level;
      w.scansBudgetToday = a.scansBudget;
      w.scansToday = 0;
      w.deepScansToday = 0;
      w.lastBriefAt = now;
      w.lastBriefDay = utcDay();
      emitEvent(b.tripId, "notify", "Morning brief", {
        detail: `Risk ${a.level} (${a.score}) — ${a.scansBudget} scan${a.scansBudget === 1 ? "" : "s"} scheduled today${a.reasons.length ? ": " + a.reasons.join("; ") : ""}`,
        data: { bookingId: b.id, riskScore: a.score, riskLevel: a.level, watch: true },
      });
    }
    surfaced += surfaceNewSignals(w, b, r.signals);
    if (kind === "fast") w.scansToday++;
  }

  if (kind === "news") {
    const geo = await gatherSignals(inp, { deep: false });
    if (geo.context) {
      const news = await pollNews({ ...geo.context, destination: inp.destination! });
      recordUsage(w, "news_query", 1);
      surfaced += surfaceNewSignals(w, b, news);
    }
    w.scansToday++;
  }

  if (kind === "deep") {
    if (w.deepScansToday >= 1 && w.riskLevel !== "critical") return watches.put(w);
    const r = await gatherSignals(inp, { deep: true });
    recordUsage(w, "deep_scout", 1);
    surfaced += surfaceNewSignals(w, b, r.signals);
    w.deepScansToday++;
    w.scansToday++;
  }

  if (kind === "alerts" && w.alertsOn) {
    const fast = await gatherSignals(inp, { deep: false });
    recordUsage(w, "open_meteo", 1);
    surfaced += surfaceNewSignals(w, b, fast.signals.filter((s) => s.severity === "warning" || s.severity === "critical"));

    if (w.xQuery) {
      const ctx = fast.context;
      if (ctx) {
        const x = await pollXAlerts(ctx, w.xQuery, w.xSinceId);
        if (x.reads) recordUsage(w, "x_read", x.reads);
        w.xSinceId = x.sinceId;
        surfaced += surfaceNewSignals(w, b, x.signals);
      }
    }
    w.lastAlertsAt = now;
  }

  w.lastScanAt = now;
  w.updatedAt = now;
  if (surfaced) log.info("watch scan", { bookingId: b.id, kind, surfaced, billable: w.meter.billableUsd });
  return watches.put(w);
}

export { utcDay };
