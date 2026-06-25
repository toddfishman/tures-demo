// Weather signals from Open-Meteo — REAL data, no API key, free. Open-Meteo gives a daily forecast
// up to ~16 days out, so we can only speak to days inside that horizon; beyond it we stay silent
// (we don't guess). For each trip day in range we derive at most the few most significant signals
// (storms, heavy rain, damaging wind, snow, extreme heat/cold) so the stream stays useful, not noisy.
import type { Signal, SignalContext, SignalProvider } from "../types.ts";
import { log } from "../../logger.ts";

const FORECAST = "https://api.open-meteo.com/v1/forecast";

// WMO weather codes → a short label + whether they're travel-impacting.
function codeMeaning(code: number): { label: string; impacting: boolean } | null {
  if ([95, 96, 99].includes(code)) return { label: "thunderstorms", impacting: true };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "snow", impacting: true };
  if ([65, 67, 82].includes(code)) return { label: "heavy rain", impacting: true };
  if ([45, 48].includes(code)) return { label: "fog", impacting: true };
  if ([63, 81].includes(code)) return { label: "rain", impacting: false };
  return null;
}

function daysInRange(depart?: string, ret?: string): string[] {
  if (!depart) return [];
  const start = new Date(depart + "T00:00:00Z");
  const end = ret ? new Date(ret + "T00:00:00Z") : start;
  if (isNaN(start.getTime())) return [];
  const out: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > 30) break; // safety
  }
  return out;
}

export const weatherProvider: SignalProvider = {
  name: "Open-Meteo (weather)",
  category: "weather",
  configured: () => true, // keyless + free
  async fetch(ctx: SignalContext): Promise<Signal[]> {
    const days = daysInRange(ctx.departDate, ctx.returnDate);
    if (!days.length) return [];
    try {
      const url =
        `${FORECAST}?latitude=${ctx.lat}&longitude=${ctx.lng}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
        `&forecast_days=16&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) {
        log.warn("weather signal non-OK", { status: res.status });
        return [];
      }
      const j: any = await res.json();
      const d = j?.daily;
      if (!d?.time) return [];
      const idx: Record<string, number> = {};
      d.time.forEach((t: string, i: number) => (idx[t] = i));

      const out: Signal[] = [];
      for (const day of days) {
        const i = idx[day];
        if (i === undefined) continue; // beyond the forecast horizon — stay silent, don't guess
        const code = d.weather_code?.[i] ?? 0;
        const tmax = d.temperature_2m_max?.[i];
        const tmin = d.temperature_2m_min?.[i];
        const precip = d.precipitation_sum?.[i] ?? 0;
        const pprob = d.precipitation_probability_max?.[i] ?? 0;
        const wind = d.wind_speed_10m_max?.[i] ?? 0;

        const m = codeMeaning(code);
        if (m && (m.impacting || precip >= 10 || pprob >= 70)) {
          out.push({
            id: `weather:${day}:${m.label}`,
            category: "weather",
            severity: m.impacting ? "warning" : "watch",
            title: `${m.label.charAt(0).toUpperCase()}${m.label.slice(1)} expected ${day}`,
            detail: `${ctx.label}: ${m.label}${pprob ? `, ${pprob}% chance of precip` : ""}${wind >= 40 ? `, winds to ${Math.round(wind)} km/h` : ""}.`,
            source: "Open-Meteo",
            when: { from: day, to: day },
            travelImpacting: m.impacting,
          });
        }
        if (wind >= 60) {
          out.push({ id: `weather:${day}:wind`, category: "weather", severity: "warning", title: `High wind ${day}`, detail: `${ctx.label}: gusts to ~${Math.round(wind)} km/h — possible flight knock-on.`, source: "Open-Meteo", when: { from: day, to: day }, travelImpacting: true });
        }
        if (typeof tmax === "number" && tmax >= 38) {
          out.push({ id: `weather:${day}:heat`, category: "health", severity: "warning", title: `Extreme heat ${day}`, detail: `${ctx.label}: high near ${Math.round(tmax)}°C — plan indoor midday.`, source: "Open-Meteo", when: { from: day, to: day } });
        }
        if (typeof tmin === "number" && tmin <= -12) {
          out.push({ id: `weather:${day}:cold`, category: "health", severity: "watch", title: `Hard freeze ${day}`, detail: `${ctx.label}: low near ${Math.round(tmin)}°C.`, source: "Open-Meteo", when: { from: day, to: day } });
        }
      }
      // Cap to the 4 most relevant so a long trip doesn't flood the stream.
      return out.slice(0, 4);
    } catch (e) {
      log.warn("weather signal failed", { err: String(e) });
      return [];
    }
  },
};
