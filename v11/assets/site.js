/* ============================================================
   TURES v11 — shared site chrome
   Injects a consistent top nav + slide-out page menu + footer on
   every page, so the whole funnel links together from one place.
   A page declares itself with <body data-page="plan">.
   ============================================================ */
(function () {
  // The funnel, grouped. n = stop number in the journey.
  var GROUPS = [
    { title: "The journey", items: [
      { href: "index.html",     label: "Cover",            page: "cover",     n: "0" },
      { href: "what-is.html",   label: "What is Tures",    page: "what-is",   n: "1" },
      { href: "plan.html",      label: "Plan a trip",      page: "plan",      n: "2" },
      { href: "taste.html",     label: "The Taste Engine", page: "taste",     n: "3" },
      { href: "vault.html",     label: "The Vault",        page: "vault",     n: "4" },
      { href: "app.html",       label: "Live demo",        page: "demo",      n: "5" },
      { href: "trips.html",     label: "My Trips",         page: "trips",     n: "6" },
      { href: "proactive.html", label: "The Concierge",    page: "concierge", n: "7" },
      { href: "hiccup.html",    label: "The Hiccup Handler", page: "hiccup",    n: "·" }
    ]},
    { title: "Decide", items: [
      { href: "pricing.html",   label: "Pricing",          page: "pricing",   n: "8" },
      { href: "signup.html",    label: "Get started",      page: "signup",    n: "9" }
    ]},
    { title: "More", items: [
      { href: "about.html",     label: "About",            page: "about" },
      { href: "about.html#contact", label: "Contact",      page: "contact" },
      { href: "legal.html",     label: "Privacy & Terms",  page: "legal" },
      { href: "funnel.html",    label: "Funnel map",       page: "funnel" }
    ]}
  ];
  var PRIMARY = [
    { href: "what-is.html", label: "How it works", page: "what-is" },
    { href: "plan.html",    label: "Plan a trip",  page: "plan" },
    { href: "pricing.html", label: "Pricing",      page: "pricing" }
  ];

  var cur = document.body.getAttribute("data-page") || "";
  function on(p) { return p === cur ? " on" : ""; }
  var MARK = 't<span class="spark">✦</span>ures';

  /* ---- top nav: 3 zones — logo+menu · plan input · account ---- */
  var menuHtml = GROUPS.map(function (g) {
    return '<div class="grp">' + g.title + '</div>' +
      g.items.map(function (it) {
        return '<a class="' + on(it.page).trim() + '" href="' + it.href + '"><span class="n">' + (it.n || '') + '</span>' + it.label + '</a>';
      }).join("");
  }).join("");

  var nav = document.createElement("header");
  nav.className = "v11-nav";
  nav.innerHTML =
    '<div class="in">' +
      '<div class="v11-menu-wrap">' +
        '<button class="v11-logo" id="v11-menu-btn" type="button" aria-haspopup="true" aria-expanded="false">' +
          '<span class="mark">' + MARK + '</span><span class="chev">▾</span></button>' +
        '<div class="v11-menu" id="v11-menu" role="menu">' + menuHtml + '</div>' +
      '</div>' +
      '<form class="v11-plan" id="v11-plan" role="search">' +
        '<input id="v11-q" autocomplete="off" placeholder="Where to? Describe your trip and Tures plans it…" aria-label="Plan a trip">' +
        '<button type="submit" aria-label="Plan it"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
      '</form>' +
      '<div class="v11-acct-wrap">' +
        '<button class="v11-acct" id="v11-acct-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/></svg></button>' +
        '<div class="v11-acct-menu" id="v11-acct-menu" role="menu"></div>' +
      '</div>' +
    '</div>';
  document.body.insertBefore(nav, document.body.firstChild);

  /* ---- dropdown open/close (logo menu + account menu) ---- */
  var drops = [];
  function closeAll() { drops.forEach(function (d) { d.panel.classList.remove("open"); d.btn.setAttribute("aria-expanded", "false"); }); }
  function wireDrop(btnId, panelId) {
    var btn = document.getElementById(btnId), panel = document.getElementById(panelId);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = !panel.classList.contains("open"); closeAll();
      if (willOpen) { panel.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
    });
    drops.push({ btn: btn, panel: panel });
  }
  wireDrop("v11-menu-btn", "v11-menu");
  wireDrop("v11-acct-btn", "v11-acct-menu");
  document.addEventListener("click", function (e) { if (!e.target.closest(".v11-menu-wrap") && !e.target.closest(".v11-acct-wrap")) closeAll(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });

  /* ---- the one CTA: type a trip → seed the chat ---- */
  document.getElementById("v11-plan").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = (document.getElementById("v11-q").value || "").trim();
    if (typeof window.turesPlanSeed === "function") { window.turesPlanSeed(q); document.getElementById("v11-q").value = ""; return; }
    if (q) { try { localStorage.setItem("tures.seed", q); } catch (_) {} }
    location.href = "plan.html";
  });

  /* ---- footer ---- */
  var foot = document.createElement("footer");
  foot.className = "v11-foot";
  foot.innerHTML =
    '<div class="in">' +
      '<div><div class="mark">' + MARK + '</div>' +
        '<p class="blurb">The AI travel concierge that books, watches, and rebooks — so you get confirmation numbers, not links.</p></div>' +
      '<div><h5>The journey</h5>' +
        GROUPS[0].items.slice(1).map(function (it) { return '<a href="' + it.href + '">' + it.label + '</a>'; }).join("") +
      '</div>' +
      '<div><h5>Decide</h5>' +
        GROUPS[1].items.map(function (it) { return '<a href="' + it.href + '">' + it.label + '</a>'; }).join("") +
        '<a href="about.html">About</a><a href="about.html#contact">Contact</a>' +
      '</div>' +
      '<div><h5>The map</h5>' +
        '<a href="funnel.html">Funnel map</a><a href="legal.html">Privacy</a><a href="legal.html">Terms</a>' +
      '</div>' +
    '</div>' +
    '<div class="legal"><span>© MMXXVI Tures · Your trip, handled.</span><span>Mockup · sample data throughout</span></div>';
  document.body.appendChild(foot);

  /* ---- account menu (the umbrella): My Trips · Vault · Taste · setup · auth ---- */
  function renderAcct() {
    var f = window.turesFunnel;
    var signed = f ? f.signedIn() : !!(window.tures && window.tures.signedIn);
    var acct = (window.tures && window.tures.account) || null;
    var st = f ? f.setupStatus() : null;
    var nx = f ? f.nextStep() : null;
    var menu = document.getElementById("v11-acct-menu");
    var head = '<div class="ah">' + (signed && acct ? (acct.name || acct.email) : "Your account") + '</div>';
    var member =
      '<a class="' + on("trips").trim() + '" href="trips.html">My Trips</a>' +
      '<a class="' + on("vault").trim() + '" href="vault.html">The Vault</a>' +
      '<a class="' + on("taste").trim() + '" href="taste.html">The Taste Engine</a>';
    var setupRow = st ? '<a class="setup" href="' + ((nx && nx.href) || "trips.html") + '"><span>Your setup</span><span class="pct">' + st.percent + '%</span></a>' : '';
    var auth = signed
      ? '<button class="signout" id="v11-signout" type="button">Sign out</button>'
      : '<a href="signup.html">Sign in</a><a class="req" href="signup.html">Request access</a>';
    menu.innerHTML = head + '<div class="sec">' + member + '</div>' + (setupRow ? '<div class="sec">' + setupRow + '</div>' : '') + '<div class="sec">' + auth + '</div>';
    var so = document.getElementById("v11-signout");
    if (so) so.addEventListener("click", function () { try { window.tures.signOut(); } catch (_) {} location.reload(); });
    document.getElementById("v11-acct-btn").classList.toggle("on", signed);
  }
  renderAcct();
  if (window.turesFunnel) window.turesFunnel.on(renderAcct);
})();
