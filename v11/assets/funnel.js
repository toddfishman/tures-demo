/* ============================================================
   TURES v11 — funnel state (progressive profiling)
   One small layer over the shared localStorage keys so every
   entry door (sign up / taste / plan) threads into one journey,
   and the agent/nav can nudge the next best setup step.
   Depends on engine.js (window.tures) for account/signed-in;
   degrades gracefully if it is not present.
   ============================================================ */
(function () {
  var K = {
    taste:    "tures.tastePrint",   // {dims, placeTypes, tags, signature}  (set by Taste Engine)
    traveler: "tures.traveler",     // {name,email,phone,homeAirport}       (contact + home town)
    vault:    "tures.vault",        // {payment:[], identity:{passport,ktn,...}, loyalty:[], access:{}}
    pending:  "tures.pendingTrip",  // {brief, hotel, ...}                   (carries a trip to checkout)
    uid:      "tures.uid"           // stable guest id (mem0 / analytics)
  };

  function read(k, fallback) { try { return JSON.parse(localStorage.getItem(k) || "null") || fallback; } catch (_) { return fallback; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} emit(); }

  var T = (window.tures || null);
  function account() { return T && T.account; }
  function signedIn() { return !!(T && T.signedIn); }

  function uid() {
    var a = account();
    if (a && a.id) return a.id;
    var g = localStorage.getItem(K.uid);
    if (!g) { g = "guest-" + Math.random().toString(36).slice(2, 9); localStorage.setItem(K.uid, g); }
    return g;
  }

  function taste()    { return read(K.taste, null); }
  function traveler() { return read(K.traveler, {}); }
  function vault()    { return read(K.vault, {}); }

  // The six things that make the funnel "complete". Ordered = nudge priority.
  var STEPS = [
    { key: "taste",   label: "Build your Taste Print",     href: "taste.html",  why: "so every pick is in your register" },
    { key: "home",    label: "Set your home airport",      href: "vault.html#basics", why: "so Tures never has to guess where you start" },
    { key: "contact", label: "Add a way to reach you",     href: "vault.html#basics", why: "so it can send the one calm message" },
    { key: "payment", label: "Add a card to your Vault",   href: "vault.html#payment", why: "so it can actually book, not just hold" },
    { key: "docs",    label: "Add your travel documents",  href: "vault.html#docs", why: "passport and Known Traveler, tokenized" },
    { key: "loyalty", label: "Connect loyalty programs",   href: "vault.html#loyalty", why: "so your miles and status apply automatically" }
  ];

  function done(key) {
    var tr = traveler(), v = vault();
    switch (key) {
      case "taste":   return !!taste();
      case "home":    return !!tr.homeAirport;
      case "contact": return !!(tr.email || (account() && account().email));
      case "payment": return !!(v.payment && v.payment.length);
      case "docs":    return !!(v.identity && (v.identity.passport || v.identity.ktn));
      case "loyalty": return !!(v.loyalty && v.loyalty.length);
    }
    return false;
  }

  function setupStatus() {
    var out = { done: 0, total: STEPS.length, steps: {} };
    STEPS.forEach(function (s) { var d = done(s.key); out.steps[s.key] = d; if (d) out.done++; });
    out.percent = Math.round((out.done / out.total) * 100);
    out.complete = out.done === out.total;
    return out;
  }

  function nextStep() {
    for (var i = 0; i < STEPS.length; i++) { if (!done(STEPS[i].key)) return STEPS[i]; }
    return null;
  }

  // Context string for /converse so the agent skips what it already knows.
  function context() {
    var bits = [], tp = taste(), tr = traveler();
    if (tp && tp.signature) bits.push("Taste Print: " + tp.signature);
    else if (tp && tp.tags && tp.tags.length) bits.push("Taste: " + tp.tags.slice(0, 5).join(", "));
    if (tr.homeAirport) bits.push("Home airport: " + tr.homeAirport);
    if (tr.name) bits.push("Name: " + tr.name);
    var a = account();
    if (a && a.email) bits.push("Signed-in account: " + a.email);
    return bits.length ? bits.join(" · ") : undefined;
  }

  // simple change bus so the nav chip can refresh after a save
  var subs = [];
  function emit() { subs.forEach(function (f) { try { f(); } catch (_) {} }); }

  window.turesFunnel = {
    K: K,
    uid: uid,
    signedIn: signedIn,
    account: account,
    taste: taste,
    traveler: traveler,
    vault: vault,
    setupStatus: setupStatus,
    nextStep: nextStep,
    context: context,
    steps: STEPS,
    // setters (each persists + emits)
    setTaste:    function (tp) { write(K.taste, tp); },
    setTraveler: function (patch) { write(K.traveler, Object.assign(traveler(), patch || {})); },
    setVault:    function (patch) { write(K.vault, Object.assign(vault(), patch || {})); },
    pendingTrip: {
      get: function () { var t = read(K.pending, null); if (t && t._ts && (Date.now() - t._ts > 12 * 3600 * 1000)) { localStorage.removeItem(K.pending); return null; } return t; },
      set: function (t) { t = t || {}; t._ts = Date.now(); write(K.pending, t); },
      clear: function () { localStorage.removeItem(K.pending); emit(); }
    },
    on: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; }
  };
})();
