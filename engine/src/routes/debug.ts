// TEMP DIAGNOSTIC — surfaces the raw Duffel Stays response so we can see why stays fall back to
// mock. Remove once diagnosed. Never echoes the token.
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { geocode } from "../geo/index.ts";

export async function debugRoutes(app: FastifyInstance) {
  // Raw Google Geocoding probe — surfaces Google's own status/error_message (REQUEST_DENIED, etc.).
  app.get("/debug/geo", async (req) => {
    const q = String((req.query as any)?.q || "Tulum, Mexico");
    if (!config.googleMapsKey) return { error: "no_google_key" };
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${config.googleMapsKey}`;
      const res = await fetch(url);
      const j: any = await res.json();
      return {
        keyPresent: true,
        keyLen: config.googleMapsKey.length,
        httpStatus: res.status,
        googleStatus: j?.status,
        errorMessage: j?.error_message ?? null,
        firstResult: j?.results?.[0]?.formatted_address ?? null,
        loc: j?.results?.[0]?.geometry?.location ?? null,
      };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });

  app.get("/debug/stays", async (req) => {
    const q = (req.query as any) || {};
    const dest = String(q.dest || "OGG").toUpperCase();
    const checkIn = String(q.in || "2026-08-10");
    const checkOut = String(q.out || "2026-08-15");
    const version = String(q.v || "v2");
    if (!config.duffel.token) return { error: "no_duffel_token" };
    const geo = await geocode(dest);
    if (!geo) return { error: "geocode_failed", dest };

    const body = {
      data: {
        rooms: 1,
        location: { radius: 8, geographic_coordinates: { latitude: geo.lat, longitude: geo.lng } },
        check_in_date: checkIn,
        check_out_date: checkOut,
        guests: [{ type: "adult" }, { type: "adult" }],
      },
    };
    try {
      const res = await fetch(`${config.duffel.apiUrl}/stays/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.duffel.token}`,
          "Duffel-Version": version,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      const results = parsed?.data?.results;
      return {
        geo,
        version,
        status: res.status,
        ok: res.ok,
        resultCount: Array.isArray(results) ? results.length : null,
        bodyHead: text.slice(0, 1500),
      };
    } catch (e: any) {
      return { geo, version, error: String(e?.message ?? e) };
    }
  });
}
