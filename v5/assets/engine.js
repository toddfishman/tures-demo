/* Tures Engine client — the bridge from the static demo to the real backend.
 *
 * The demo works with NO engine (scripted fallback). To point it at a running engine:
 *   • add ?engine=https://your-engine.fly.dev to any v5 URL (persists), or
 *   • run in console:  tures.use('http://localhost:8788')   /  tures.forget()
 *
 * Accounts: tures.signUp(name,email) creates a per-browser account; every engine call is then
 * namespaced to that account id, so a signed-up visitor's cards/profile/trips are their own.
 * window.tures.configured tells each page whether to call the engine or run its scripted demo.
 */
(function () {
  var KEY = "tures.engineUrl";
  var AUTH = "tures.engineKey";
  var ACCT = "tures.account";

  var qs = new URLSearchParams(location.search);
  var fromQuery = qs.get("engine");
  if (fromQuery !== null) {
    if (fromQuery) localStorage.setItem(KEY, fromQuery.replace(/\/$/, ""));
    else localStorage.removeItem(KEY);
  }
  var fromKey = qs.get("key");
  if (fromKey !== null) {
    if (fromKey) localStorage.setItem(AUTH, fromKey);
    else localStorage.removeItem(AUTH);
  }
  // Default to the live engine so the deployed site is real for every visitor (override with
  // ?engine= or tures.use(); clear with tures.forget()).
  var DEFAULT_ENGINE = "https://tures-engine-tf.fly.dev";
  var url = localStorage.getItem(KEY) || DEFAULT_ENGINE;
  var apiKey = localStorage.getItem(AUTH) || "";
  var account = null;
  try { account = JSON.parse(localStorage.getItem(ACCT) || "null"); } catch (_) {}

  function acctId() { return (account && account.id) || "demo"; }
  function saveAccount() { localStorage.setItem(ACCT, JSON.stringify(account)); }

  function api(path, opts) {
    opts = opts || {};
    var h = Object.assign({}, opts.headers || {});
    // Only declare JSON when we actually send a body — Fastify 400s on an empty JSON body.
    if (opts.body && !h["Content-Type"]) h["Content-Type"] = "application/json";
    if (apiKey) h["Authorization"] = "Bearer " + apiKey;
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
    get signedIn() { return !!account; },
    get accountId() { return acctId(); },

    use: function (u, k) { url = (u || "").replace(/\/$/, ""); localStorage.setItem(KEY, url); if (k !== undefined) { apiKey = k || ""; if (apiKey) localStorage.setItem(AUTH, apiKey); else localStorage.removeItem(AUTH); } return url; },
    forget: function () { url = ""; apiKey = ""; localStorage.removeItem(KEY); localStorage.removeItem(AUTH); },

    /* ----- accounts (demo-grade: per-browser, no password) ----- */
    signUp: function (name, email, plan) {
      var rand = Math.random().toString(36).slice(2, 8);
      account = { id: "acct_" + rand, name: name || "Traveler", email: email || "", plan: plan || "free", createdAt: new Date().toISOString() };
      saveAccount();
      return account;
    },
    setPlan: function (plan) { if (account) { account.plan = plan; saveAccount(); } return account; },
    signOut: function () { account = null; localStorage.removeItem(ACCT); },

    /* ----- public ----- */
    waitlist: function (email, name) { return api("/waitlist", { method: "POST", body: JSON.stringify({ email: email, name: name }) }); },
    health: function () { return api("/health"); },

    /* ----- planning (free) ----- */
    parse: function (text) { return api("/parse", { method: "POST", body: JSON.stringify({ text: text }) }); },
    plan: function (brief) { return api("/plan", { method: "POST", body: JSON.stringify(brief) }); },

    /* ----- booking (account-scoped) ----- */
    book: function (body) { body = body || {}; if (!body.accountId) body.accountId = acctId(); return api("/book", { method: "POST", body: JSON.stringify(body) }); },
    confirm: function (id) { return api("/book/" + id + "/confirm", { method: "POST" }); },

    connections: {
      connect: function (c) { c = c || {}; if (!c.accountId) c.accountId = acctId(); return api("/connections", { method: "POST", body: JSON.stringify(c) }); },
      list: function (accountId) { return api("/connections?accountId=" + (accountId || acctId())); },
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

    disrupt: function (bookingId, kind, detail) { return api("/disruptions", { method: "POST", body: JSON.stringify({ bookingId: bookingId, kind: kind, detail: detail }) }); },

    /* live execution stream (key rides as ?token= since EventSource can't send headers) */
    stream: function (tripId, onEvent) {
      var es = new EventSource(url + "/stream/" + tripId + (apiKey ? "?token=" + encodeURIComponent(apiKey) : ""));
      es.onmessage = function (e) { try { onEvent(JSON.parse(e.data)); } catch (_) {} };
      return es;
    },
  };

  window.tures = tures;
  if (tures.configured) console.info("[tures] engine →", url, account ? "· " + account.email : "· (not signed in)");
})();
