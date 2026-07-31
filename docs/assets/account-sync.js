/* Pull masked profile + connections from the engine into funnel localStorage.
   Call turesAccountSync() after sign-in or on vault/onboard/trips load. */
(function () {
  if (window.__turesAccountSync) return;
  window.__turesAccountSync = true;

  function mergeVaultFromEngine(profileConn, connections) {
    var F = window.turesFunnel;
    if (!F) return;
    var v = F.vault() || {};
    var pay = (v.payment || []).slice();
    var loyalty = (v.loyalty || []).slice();
    var identity = Object.assign({}, v.identity || {});

    (connections || []).forEach(function (c) {
      if (!c || c.status === "revoked") return;
      if (c.kind === "payment") {
        var last4 = (c.meta && c.meta.last4) || String(c.label || "").replace(/\D/g, "").slice(-4);
        var key = (c.meta && c.meta.cardKey) || (c.meta && c.meta.key);
        var brand = (c.meta && c.meta.brand) || "Card";
        var label = c.label || (brand + " ···· " + last4);
        var exists = pay.some(function (p) { return p.label === label || (p.label && p.label.slice(-4) === last4); });
        if (!exists) pay.push({ label: label, name: c.label, brand: brand, key: key, engineId: c.id });
      }
      if (c.kind === "loyalty") {
        loyalty.push({ program: c.label, number: (c.meta && c.meta.numberMasked) || "••••", engineId: c.id });
      }
    });

    if (profileConn && profileConn.meta) {
      var m = profileConn.meta;
      if (m.passportMasked || m.hasPassport) identity.passport = m.passportMasked || "•••• on file";
      if (m.ktnMasked || m.ktnOnFile) identity.ktn = m.ktnMasked || "•••• on file";
      if (m.memberships && m.memberships.length) {
        m.memberships.forEach(function (mb) {
          var exists = loyalty.some(function (l) { return l.program === mb.program; });
          if (!exists) loyalty.push({ program: mb.program, number: mb.numberMasked || "••••", status: mb.status });
        });
      }
    }

    var patch = {};
    if (pay.length) patch.payment = pay;
    if (loyalty.length) patch.loyalty = loyalty;
    if (Object.keys(identity).length) patch.identity = identity;
    if (Object.keys(patch).length) F.setVault(patch);
  }

  function mergeTravelerFromEngine(profileConn) {
    var F = window.turesFunnel;
    var T = window.tures;
    if (!F) return;
    var patch = {};
    var tr = F.traveler();
    if (T && T.account) {
      if (T.account.email && !tr.email) patch.email = T.account.email;
      if (T.account.name && !tr.name) patch.name = T.account.name;
    }
    if (profileConn) {
      if (profileConn.label && !tr.name) patch.name = profileConn.label;
    }
    if (Object.keys(patch).length) F.setTraveler(patch);
  }

  window.turesAccountSync = function () {
    var T = window.tures;
    var F = window.turesFunnel;
    if (!T || !T.configured || !F) return Promise.resolve(false);
    if (!T.signedIn) return Promise.resolve(false);

    return Promise.all([
      T.profile.get().catch(function (e) { return (e && e.status === 404) ? null : null; }),
      T.connections.list().catch(function () { return { connections: [] }; })
    ]).then(function (res) {
      var profileConn = res[0];
      var connections = (res[1] && res[1].connections) || [];
      mergeTravelerFromEngine(profileConn);
      mergeVaultFromEngine(profileConn, connections);
      return true;
    });
  };
})();
