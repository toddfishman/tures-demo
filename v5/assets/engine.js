/* Tures Engine client — bridge from the static site to the backend.
 *
 * Engine URL defaults to the live deploy; override with ?engine= or tures.use(), clear with
 * tures.forget(). Accounts use real email+password auth: tures.signUp / tures.login return a
 * session token (stored), and every call rides Authorization: Bearer <token>, so a signed-in
 * visitor's cards/profile/trips are their own and persist server-side.
 */
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
  var DEFAULT_ENGINE = "https://tures-engine-tf.fly.dev";
  var url = localStorage.getItem(KEY) || DEFAULT_ENGINE;
  var token = localStorage.getItem(TOKEN) || "";
  var account = null;
  try { account = JSON.parse(localStorage.getItem(ACCT) || "null"); } catch (_) {}

  function acctId() { return (account && account.id) || "demo"; }
  function setSession(t, u) { token = t || ""; account = u || null; if (token) localStorage.setItem(TOKEN, token); else localStorage.removeItem(TOKEN); if (account) localStorage.setItem(ACCT, JSON.stringify(account)); else localStorage.removeItem(ACCT); }

  function api(path, opts) {
    opts = opts || {};
    var h = Object.assign({}, opts.headers || {});
    if (opts.body && !h["Content-Type"]) h["Content-Type"] = "application/json";
    if (token && !h["Authorization"]) h["Authorization"] = "Bearer " + token;
    opts.headers = h;
    return fetch(url + path, opts).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status, body: body });
        return body;
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
        .then(function (r) { setSession(r.token, r.user); return r.user; });
    },
    login: function (email, password) {
      return api("/auth/login", { method: "POST", body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { setSession(r.token, r.user); return r.user; });
    },
    me: function () { return api("/auth/me").then(function (r) { account = r.user; localStorage.setItem(ACCT, JSON.stringify(account)); return r.user; }); },
    signOut: function () { setSession("", null); },

    /* ----- public ----- */
    waitlist: function (email, name) { return api("/waitlist", { method: "POST", body: JSON.stringify({ email: email, name: name }) }); },
    health: function () { return api("/health"); },

    /* ----- planning (free) ----- */
    parse: function (text) { return api("/parse", { method: "POST", body: JSON.stringify({ text: text }) }); },
    plan: function (brief) { return api("/plan", { method: "POST", body: JSON.stringify(brief) }); },

    /* ----- booking (session-scoped) ----- */
    book: function (body) { body = body || {}; if (!body.accountId) body.accountId = acctId(); return api("/book", { method: "POST", body: JSON.stringify(body) }); },
    confirm: function (id) { return api("/book/" + id + "/confirm", { method: "POST" }); },
    bookings: function () { return api("/bookings?accountId=" + acctId()); },
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
    wallet: {
      catalog: function () { return api("/wallet/catalog"); },
      recommend: function (category, amount) { return api("/wallet/recommend?accountId=" + acctId() + "&category=" + category + "&amount=" + amount); },
    },
    billing: {
      checkout: function () { return api("/billing/checkout", { method: "POST", body: JSON.stringify({ accountId: acctId() }) }); },
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

    /* Voice: POST a recorded audio Blob to Deepgram (via the engine) → { transcript }. */
    voice: {
      transcribe: function (blob) {
        var h = { "Content-Type": blob.type || "audio/webm" };
        if (token) h["Authorization"] = "Bearer " + token;
        return fetch(url + "/voice/transcribe", { method: "POST", headers: h, body: blob }).then(function (r) {
          return r.json().then(function (b) { if (!r.ok) throw Object.assign(new Error(b.error || r.status), { status: r.status, body: b }); return b; });
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
