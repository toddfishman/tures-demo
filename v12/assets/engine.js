/* Tures Engine client — bridge from the static site to the backend.
 *
 * Engine URL defaults to the live deploy; override with ?engine= or tures.use(), clear with
 * tures.forget(). Accounts use real email+password auth: tures.signUp / tures.login return a
 * session token (stored), and every call rides Authorization: Bearer <token>, so a signed-in
 * visitor's cards/profile/trips are their own and persist server-side.
 */
// Theme bootstrap — runs synchronously in <head> before the body paints, so dark mode never flashes.
// Default follows the OS preference until the user picks one (persisted as tures.theme). site.js
// renders the toggle that writes this key.
(function () {
  try {
    var t = localStorage.getItem("tures.theme");
    if (!t) t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    if (t === "dark") document.documentElement.classList.add("dark");
  } catch (_) {}
})();

// PWA / app-shell bootstrap — make every page installable + standalone-capable without editing each
// <head>. Injects the manifest link, Apple web-app meta, and viewport-fit=cover (for safe-area
// insets) once, in <head>, at load. No-op if the page already declares them.
(function () {
  try {
    var head = document.head || document.documentElement;
    function addMeta(name, content) {
      if (document.querySelector('meta[name="' + name + '"]')) return;
      var m = document.createElement("meta"); m.name = name; m.content = content; head.appendChild(m);
    }
    function addLink(rel, href) {
      if (document.querySelector('link[rel="' + rel + '"]')) return;
      var l = document.createElement("link"); l.rel = rel; l.href = href; head.appendChild(l);
    }
    addLink("manifest", "manifest.webmanifest");
    addLink("apple-touch-icon", "assets/img/app-icon.svg");
    addMeta("apple-mobile-web-app-capable", "yes");
    addMeta("mobile-web-app-capable", "yes");
    addMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    addMeta("apple-mobile-web-app-title", "Tures");
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && vp.content.indexOf("viewport-fit") < 0) vp.content = vp.content + ", viewport-fit=cover";
  } catch (_) {}
})();

(function () {
  var KEY = "tures.engineUrl";
  var TOKEN = "tures.token";
  var ACCT = "tures.account";

  var qs = new URLSearchParams(location.search);
  var fromQuery = qs.get("engine");
  if (fromQuery !== null) {
    if (fromQuery) localStorage.setItem(KEY, fromQuery.replace(/\/$/, ""));
    else localStorage.removeItem(KEY);
  }
  var DEFAULT_ENGINE = "https://tures-engine.onrender.com";
  var url = localStorage.getItem(KEY) || DEFAULT_ENGINE;
  var token = localStorage.getItem(TOKEN) || "";
  var account = null;
  try { account = JSON.parse(localStorage.getItem(ACCT) || "null"); } catch (_) {}

  function acctId() { return (account && account.id) || "demo"; }
  // Stable memory id — the same one the conversational agent uses (turesFunnel.uid), so the planner
  // shares the traveler's mem0 memory. Undefined when the funnel isn't loaded.
  function memId() { try { return (window.turesFunnel && window.turesFunnel.uid) ? window.turesFunnel.uid() : undefined; } catch (_) { return undefined; } }
  function setSession(t, u) { token = t || ""; account = u || null; if (token) localStorage.setItem(TOKEN, token); else localStorage.removeItem(TOKEN); if (account) localStorage.setItem(ACCT, JSON.stringify(account)); else localStorage.removeItem(ACCT); }
  function maybeMergeGuestMem(accountId) {
    try {
      var g = localStorage.getItem("tures.uid");
      if (!g || g.indexOf("guest-") !== 0 || g === accountId || !token) return Promise.resolve();
      return api("/mem0/merge", { method: "POST", body: JSON.stringify({ fromUserId: g }) }).then(function () {
        localStorage.removeItem("tures.uid");
      }).catch(function () {});
    } catch (_) { return Promise.resolve(); }
  }

  function retriableStatus(s) { return s === 502 || s === 503 || s === 504; }
  /** Retry cold-start / gateway blips — Render wakes on first request. */
  function withRetry(fn, retries) {
    retries = retries == null ? 1 : retries;
    return fn().catch(function (err) {
      var st = err && err.status;
      if (retries > 0 && (!st || retriableStatus(st))) {
        return new Promise(function (res, rej) {
          setTimeout(function () { withRetry(fn, retries - 1).then(res, rej); }, 1800);
        });
      }
      throw err;
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var h = Object.assign({}, opts.headers || {});
    if (opts.body && !h["Content-Type"]) h["Content-Type"] = "application/json";
    if (token && !h["Authorization"]) h["Authorization"] = "Bearer " + token;
    opts.headers = h;
    return withRetry(function () {
      return fetch(url + path, opts).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status, body: body });
          return body;
        }, function () {
          if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
          throw new Error("invalid_json");
        });
      });
    });
  }

  var tures = {
    get url() { return url; },
    get configured() { return !!url; },
    get account() { return account; },
    get signedIn() { return !!(token && account); },
    get accountId() { return acctId(); },

    use: function (u) { url = (u || "").replace(/\/$/, ""); localStorage.setItem(KEY, url); return url; },
    forget: function () { url = ""; setSession("", null); localStorage.removeItem(KEY); },

    /* ----- real auth ----- */
    signUp: function (name, email, password) {
      return api("/auth/signup", { method: "POST", body: JSON.stringify({ name: name, email: email, password: password }) })
        .then(function (r) { setSession(r.token, r.user); return maybeMergeGuestMem(r.user.id).then(function () { return r.user; }); });
    },
    login: function (email, password) {
      return api("/auth/login", { method: "POST", body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { setSession(r.token, r.user); return maybeMergeGuestMem(r.user.id).then(function () { return r.user; }); });
    },
    me: function () { return api("/auth/me").then(function (r) { account = r.user; localStorage.setItem(ACCT, JSON.stringify(account)); return r.user; }); },
    signOut: function () { setSession("", null); },

    /* ----- public ----- */
    waitlist: function (email, name) { return api("/waitlist", { method: "POST", body: JSON.stringify({ email: email, name: name }) }); },
    health: function () { return api("/health"); },

    /* ----- planning (free) ----- */
    parse: function (text) { return api("/parse", { method: "POST", body: JSON.stringify({ text: text }) }); },
    plan: function (brief) { var body = Object.assign({}, brief || {}); var u = memId(); if (u) body.userId = u; return api("/plan", { method: "POST", body: JSON.stringify(body) }); },
    /* Real trip extras: hotels + restaurants + things-to-do (Google Places) + transport estimate. */
    discover: function (brief) { var body = Object.assign({}, brief || {}); var u = memId(); if (u) body.userId = u; return api("/discover", { method: "POST", body: JSON.stringify(body) }); },
    /* Situational awareness — weather/air/events/advisories/transit for this trip. deep=true adds the
       live web scout (slower). The "Trip Radar": this is the always-on watch, made visible. */
    signals: function (brief, deep) { var b = brief || {}; return api("/signals", { method: "POST", body: JSON.stringify({ destination: b.destination, origin: b.origin, departDate: b.departDate, returnDate: b.returnDate, deep: !!deep }) }); },

    /* Cross-channel — link another surface (Telegram, …) to this account so the same Tures (memory,
       Vault, trips) reaches you there. linkCode() mints a one-time code + a ready Telegram deep link. */
    channels: {
      linkCode: function () { return api("/channels/link-code", { method: "POST" }); },
      list: function () { return api("/channels"); },
      unlink: function (channel) { return api("/channels/" + channel + "/unlink", { method: "POST" }); },
    },
    /* Simulated reservation of an extra → { confirmation, simulated, note }. */
    reserve: function (item) { return api("/reserve", { method: "POST", body: JSON.stringify(item || {}) }); },

    /* ----- booking (session-scoped) ----- */
    book: function (body) { body = body || {}; if (!body.accountId) body.accountId = acctId(); return api("/book", { method: "POST", body: JSON.stringify(body) }); },
    confirm: function (id) { return api("/book/" + id + "/confirm", { method: "POST" }); },
    bookings: function () { return api("/bookings?accountId=" + acctId()); },
    watchCapabilities: function () { return api("/watch/capabilities"); },
    getWatch: function (bookingId) { return api("/watch/" + bookingId); },
    enableWatch: function (bookingId, capUsd) { return api("/watch/" + bookingId + "/enable", { method: "POST", body: JSON.stringify({ capUsd: capUsd }) }); },
    approveWatchCap: function (bookingId, additionalUsd) { return api("/watch/" + bookingId + "/approve-cap", { method: "POST", body: JSON.stringify({ additionalUsd: additionalUsd || 5 }) }); },

    /* Action Executor — permissioned browser actions + human handoff for CAPTCHA/login. */
    actions: {
      capabilities: function () { return api("/actions/capabilities"); },
      permissions: function () { return api("/actions/permissions"); },
      grants: function () { return api("/actions/grants"); },
      grant: function (permission, label, scope) {
        return api("/actions/grants", { method: "POST", body: JSON.stringify({ permission: permission, label: label, scope: scope }) });
      },
      revokeGrant: function (id) { return api("/actions/grants/" + id + "/revoke", { method: "POST" }); },
      run: function (body) { return api("/actions/run", { method: "POST", body: JSON.stringify(body || {}) }); },
      listRuns: function () { return api("/actions/runs"); },
      getRun: function (id) { return api("/actions/runs/" + id); },
      getHandoff: function (token) { return api("/actions/handoff/" + encodeURIComponent(token)); },
      continueHandoff: function (token) { return api("/actions/handoff/" + encodeURIComponent(token) + "/continue", { method: "POST" }); },
      abortHandoff: function (token) { return api("/actions/handoff/" + encodeURIComponent(token) + "/abort", { method: "POST" }); },
    },

    disrupt: function (bookingId, kind, detail) { return api("/disruptions", { method: "POST", body: JSON.stringify({ bookingId: bookingId, kind: kind, detail: detail }) }); },

    connections: {
      connect: function (c) { c = c || {}; if (!c.accountId) c.accountId = acctId(); return api("/connections", { method: "POST", body: JSON.stringify(c) }); },
      list: function () { return api("/connections?accountId=" + acctId()); },
      revoke: function (id) { return api("/connections/" + id + "/revoke", { method: "POST" }); },
    },
    profile: {
      set: function (profile) { return api("/profile", { method: "POST", body: JSON.stringify({ accountId: acctId(), profile: profile }) }); },
      get: function () { return api("/profile?accountId=" + acctId()); },
    },
    /* Standing preferences the planner reads: Taste Print, cabin default, avoid, dietary. */
    prefs: {
      set: function (prefs) { return api("/prefs", { method: "POST", body: JSON.stringify({ accountId: acctId(), prefs: prefs }) }); },
      get: function () { return api("/prefs?accountId=" + acctId()); },
    },
    wallet: {
      catalog: function () { return api("/wallet/catalog"); },
      recommend: function (category, amount) { return api("/wallet/recommend?accountId=" + acctId() + "&category=" + category + "&amount=" + amount); },
    },
    billing: {
      checkout: function () { return api("/billing/checkout", { method: "POST", body: JSON.stringify({ accountId: acctId() }) }); },
      setupIntent: function () { return api("/billing/setup-intent", { method: "POST" }); },
      saveCard: function (body) { return api("/billing/save-card", { method: "POST", body: JSON.stringify(body) }); },
    },
    travelers: {
      add: function (t) { return api("/travelers", { method: "POST", body: JSON.stringify({ traveler: t }) }); },
      list: function () { return api("/travelers"); },
      remove: function (id) { return api("/travelers/" + id, { method: "DELETE" }); },
    },
    places: {
      upsert: function (p) { return api("/places", { method: "POST", body: JSON.stringify({ place: p }) }); },
      list: function () { return api("/places"); },
      remove: function (name) { return api("/places/" + encodeURIComponent(name), { method: "DELETE" }); },
    },

    /* Conversational Tures. messages: prior turns; text: new user turn; context: known profile/
       Taste Print so the agent skips what it already knows. → { reply, ready?, brief?, slots? } */
    converse: function (messages, text, context, userId) {
      return api("/converse", { method: "POST", body: JSON.stringify({ messages: messages || [], text: text, context: context, userId: userId }) });
    },

    /* "Handle anything" — researches the web, proposes permissioned actions Tures can take. */
    assist: function (history, text, context, userId) {
      return api("/assist", { method: "POST", body: JSON.stringify({ history: history || [], text: text, context: context, userId: userId }) });
    },

    /* Voice: transcribe a recorded Blob (Deepgram STT) and speak text (Deepgram Aura TTS → mp3 Blob). */
    voice: {
      transcribe: function (blob) {
        var h = { "Content-Type": blob.type || "audio/webm" };
        if (token) h["Authorization"] = "Bearer " + token;
        return withRetry(function () {
          return fetch(url + "/voice/transcribe", { method: "POST", headers: h, body: blob }).then(function (r) {
            return r.json().then(function (b) { if (!r.ok) throw Object.assign(new Error(b.error || r.status), { status: r.status, body: b }); return b; });
          });
        });
      },
      speak: function (text) {
        var h = { "Content-Type": "application/json" };
        if (token) h["Authorization"] = "Bearer " + token;
        return withRetry(function () {
          return fetch(url + "/voice/speak", { method: "POST", headers: h, body: JSON.stringify({ text: text }) }).then(function (r) {
            if (!r.ok) throw Object.assign(new Error("tts " + r.status), { status: r.status });
            return r.blob();
          });
        });
      },
    },

    stream: function (tripId, onEvent) {
      var es = new EventSource(url + "/stream/" + tripId + (token ? "?token=" + encodeURIComponent(token) : ""));
      es.onmessage = function (e) { try { onEvent(JSON.parse(e.data)); } catch (_) {} };
      return es;
    },
  };

  window.tures = tures;
  if (tures.configured) console.info("[tures] engine →", url, account ? "· " + account.email : "· (signed out)");
})();
