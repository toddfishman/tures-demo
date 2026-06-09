/* Tures Engine client — the bridge from the static demo to the real backend.
 *
 * The demo works with NO engine (scripted fallback). To point it at a running engine:
 *   • add ?engine=https://your-engine.fly.dev to any v5 URL (persists), or
 *   • run in console:  tures.use('http://localhost:8788')   /  tures.forget()
 *
 * window.tures.configured tells each page whether to call the engine or run its scripted demo.
 * CORS for the GitHub Pages origin is allowed in the engine's fly.toml.
 */
(function () {
  var KEY = "tures.engineUrl";

  // Resolve the engine URL: ?engine= wins (and is remembered), else localStorage.
  var qs = new URLSearchParams(location.search);
  var fromQuery = qs.get("engine");
  if (fromQuery !== null) {
    if (fromQuery) localStorage.setItem(KEY, fromQuery.replace(/\/$/, ""));
    else localStorage.removeItem(KEY); // ?engine= (empty) clears it
  }
  var url = localStorage.getItem(KEY) || "";

  function api(path, opts) {
    return fetch(url + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status, body: body });
          return body;
        });
      });
  }

  var tures = {
    get url() { return url; },
    get configured() { return !!url; },

    use: function (u) { url = (u || "").replace(/\/$/, ""); localStorage.setItem(KEY, url); return url; },
    forget: function () { url = ""; localStorage.removeItem(KEY); },

    health: function () { return api("/health"); },
    parse: function (text) { return api("/parse", { method: "POST", body: JSON.stringify({ text: text }) }); },
    plan: function (brief) { return api("/plan", { method: "POST", body: JSON.stringify(brief) }); },
    book: function (body) { return api("/book", { method: "POST", body: JSON.stringify(body) }); },
    confirm: function (id) { return api("/book/" + id + "/confirm", { method: "POST" }); },

    connections: {
      connect: function (c) { return api("/connections", { method: "POST", body: JSON.stringify(c) }); },
      list: function (accountId) { return api("/connections?accountId=" + (accountId || "demo")); },
      revoke: function (id) { return api("/connections/" + id + "/revoke", { method: "POST" }); },
    },

    /* Open the live execution stream. Returns the EventSource so callers can close it. */
    stream: function (tripId, onEvent) {
      var es = new EventSource(url + "/stream/" + tripId);
      es.onmessage = function (e) {
        try { onEvent(JSON.parse(e.data)); } catch (_) {}
      };
      return es;
    },
  };

  window.tures = tures;
  if (tures.configured) {
    // tiny breadcrumb so it's obvious the page is live, not scripted
    console.info("[tures] engine configured →", url);
  }
})();
