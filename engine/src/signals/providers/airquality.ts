// Air-quality signals from Open-Meteo's Air Quality API — REAL data, no key, free. AQI is only
// forecast a few days out, so this speaks to trips departing soon (or in progress). Beyond the
// horizon it stays silent rather than guessing.
import type { Signal, SignalContext, SignalProvider } from "../types.ts";
import { log } from "../../logger.ts";

const AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

function startsSoon(depart?: string): boolean {
  if (!depart) return true; // no dates → treat as "now" (on-trip radar)
  const start = new Date(depart + "T00:00:00Z").getTime();
  if (isNaN(start)) return false;
  const days = (start - Date.now()) / 86400000;
  return days <= 3; // AQI forecast horizon
}

export const airQualityProvider: SignalProvider = {
  name: "Open-Meteo (air quality)",
  category: "air",
  configured: () => true, // keyless + free
  async fetch(ctx: SignalContext): Promise<Signal[]> {
    if (!startsSoon(ctx.departDate)) return [];
    try {
      const url = `${AQ}?latitude=${ctx.lat}&longitude=${ctx.lng}&hourly=us_aqi&forecast_days=3&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) {
        log.warn("air signal non-OK", { status: res.status });
        return [];
      }
      const j: any = await res.json();
      const vals: number[] = (j?.hourly?.us_aqi ?? []).filter((n: any) => typeof n === "number");
      if (!vals.length) return [];
      const peak = Math.round(Math.max(...vals));
      if (peak >= 150) {
        return [{ id: `air:${ctx.label}:unhealthy`, category: "air", severity: "warning", title: "Unhealthy air quality", detail: `${ctx.label}: US AQI peaking near ${peak} in the next few days — sensitive travelers should limit time outdoors.`, source: "Open-Meteo", travelImpacting: false }];
      }
      if (peak >= 101) {
        return [{ id: `air:${ctx.label}:moderate`, category: "air", severity: "watch", title: "Elevated air quality index", detail: `${ctx.label}: US AQI peaking near ${peak} — worth noting for sensitive groups.`, source: "Open-Meteo" }];
      }
      return [];
    } catch (e) {
      log.warn("air signal failed", { err: String(e) });
      return [];
    }
  },
};
