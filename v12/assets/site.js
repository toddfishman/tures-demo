/* ============================================================
   TURES v12 — shared site chrome
   Injects a consistent top nav + slide-out page menu + footer on
   every page, so the whole funnel links together from one place.
   A page declares itself with <body data-page="plan">.
   ============================================================ */
(function () {
  /* shared travel-bg scene fades (loaded once for pages with the backdrop video) */
  if (!document.querySelector('script[src*="travel-bg.js"]')) {
    var tbg = document.createElement("script");
    tbg.src = "assets/travel-bg.js";
    tbg.defer = true;
    document.head.appendChild(tbg);
  }

  // The funnel, grouped. n = stop number in the journey.
  var GROUPS = [
    { title: "Start here", items: [
      { href: "what-is.html",   label: "What is Tures",    page: "what-is" },
      { href: "journey.html",   label: "Watch the demo",   page: "demo" },
      { href: "setup.html",     label: "Set up step by step", page: "setup" },
      { href: "telegram.html",  label: "Connect Telegram", page: "telegram" },
      { href: "plan.html",      label: "Plan a trip",      page: "plan" },
      { href: "onboard.html",   label: "Set up Tures",     page: "onboard" },
      { href: "pricing.html",   label: "Pricing",          page: "pricing" },
      { href: "signup.html",    label: "Join the waitlist", page: "signup" }
    ]},
    { title: "Features", items: [
      { href: "taste.html",     label: "The Taste Engine",  page: "taste" },
      { href: "vault.html",     label: "The Vault",         page: "vault" },
      { href: "trips.html",     label: "My Trips",          page: "trips" },
      { href: "proactive.html", label: "The Concierge",     page: "concierge" },
      { href: "hiccup.html",    label: "The Hiccup Handler", page: "hiccup" }
    ]},
    { title: "More", items: [
      { href: "about.html",     label: "About",            page: "about" },
      { href: "legal.html",     label: "Privacy & Terms",  page: "legal" }
    ]}
  ];

  var cur = document.body.getAttribute("data-page") || "";
  if (cur === "cover") document.documentElement.classList.add("px-cover");
  function on(p) { return p === cur ? " on" : ""; }
  var MARK = 't<span class="spark">✦</span>ures';

  /* ---- travel backdrop (assets/travel-bg.mp4 — portrait-cut, cover on desktop) ---- */
  (function () {
    if (document.body.getAttribute("data-no-travel-bg") === "1") return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var asset = "assets/";
    var bg = document.createElement("div");
    bg.className = "v11-travel-bg";
    bg.setAttribute("aria-hidden", "true");
    bg.innerHTML = reduce
      ? '<div class="v11-travel-vid" style="background:url(\'' + asset + 'travel-bg.jpg\') center/cover no-repeat"></div>'
      : '<video class="v11-travel-vid" autoplay muted loop playsinline preload="auto">' +
        '<source src="' + asset + 'travel-bg.mp4" type="video/mp4"></video>';
    var scrim = document.createElement("div");
    scrim.className = "v11-travel-scrim";
    scrim.setAttribute("aria-hidden", "true");
    document.documentElement.classList.add("v11-travel-on");
    document.body.insertBefore(bg, document.body.firstChild);
    document.body.insertBefore(scrim, bg.nextSibling);
  })();

  /* ---- top nav: 3 zones — logo+menu · plan input · account ---- */
  var menuHtml = GROUPS.map(function (g) {
    return '<div class="grp">' + g.title + '</div>' +
      g.items.map(function (it) {
        return '<a class="' + on(it.page).trim() + '" href="' + it.href + '">' + it.label + '</a>';
      }).join("");
  }).join("");

  var nav = document.createElement("header");
  nav.className = "v11-nav";
  nav.innerHTML =
    '<div class="in">' +
      '<div class="v11-menu-wrap">' +
        '<a class="v11-home" href="index.html" aria-label="Tures — home"><span class="mark">' + MARK + '</span></a>' +
        '<button class="v11-logo" id="v11-menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Menu"><span class="chev">▾</span></button>' +
        '<div class="v11-menu" id="v11-menu" role="menu">' + menuHtml + '</div>' +
      '</div>' +
      '<div class="v11-right">' +
        (cur === "plan" ? '' : '<a class="v11-cta" href="plan.html">Plan a trip</a>') +
        '<button class="v11-theme" id="v11-theme" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">' +
          '<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg>' +
          '<svg class="moon" viewBox="0 0 24 24"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/></svg>' +
        '</button>' +
        '<div class="v11-acct-wrap">' +
          '<button class="v11-acct" id="v11-acct-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/></svg></button>' +
          '<div class="v11-acct-menu" id="v11-acct-menu" role="menu"></div>' +
        '</div>' +
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

  /* ---- dark-mode toggle (engine.js already applied the saved/OS theme before paint) ---- */
  (function () {
    var btn = document.getElementById("v11-theme");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var dark = !document.documentElement.classList.contains("dark");
      document.documentElement.classList.toggle("dark", dark);
      try { localStorage.setItem("tures.theme", dark ? "dark" : "light"); } catch (_) {}
    });
  })();
  document.addEventListener("click", function (e) { if (!e.target.closest(".v11-menu-wrap") && !e.target.closest(".v11-acct-wrap")) closeAll(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });


  /* ---- footer ---- */
  var foot = document.createElement("footer");
  foot.className = "v11-foot";
  foot.innerHTML =
    '<div class="in">' +
      '<div><div class="mark">' + MARK + '</div>' +
        '<p class="blurb">The AI travel concierge that books, watches, and rebooks — confirmation numbers, not links.</p></div>' +
      GROUPS.map(function (g) {
        return '<div><h5>' + g.title + '</h5>' +
          g.items.map(function (it) { return '<a href="' + it.href + '">' + it.label + '</a>'; }).join("") + '</div>';
      }).join("") +
    '</div>' +
    '<div class="legal"><span>© MMXXVI Tures · Your trip, handled.</span></div>';
  document.body.appendChild(foot);

  /* ---- mobile bottom tab bar (the "this is an app" element) ---- */
  (function () {
    // Hidden on the Plan chat (full-immersion; would fight the composer) and the cover (the brand
    // front door, not an app section). Shown on the app-section pages.
    if (cur === "plan" || cur === "cover") return;
    var TABS = [
      { href: "plan.html", page: "plan", label: "Plan",
        icon: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/>' },
      { href: "trips.html", page: "trips", label: "Trips",
        icon: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>' },
      { href: "proactive.html", page: "concierge", label: "Concierge",
        icon: '<circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/>' },
      { href: "vault.html", page: "vault", label: "Vault",
        icon: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' }
    ];
    var bar = document.createElement("nav");
    bar.className = "v11-tabbar";
    bar.setAttribute("aria-label", "App sections");
    bar.innerHTML = TABS.map(function (t) {
      var act = t.page === cur ? " on" : "";
      return '<a class="v11-tab' + act + '" href="' + t.href + '"' + (act ? ' aria-current="page"' : "") + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + t.icon + '</svg>' +
        '<span>' + t.label + '</span></a>';
    }).join("");
    document.body.appendChild(bar);
    document.body.classList.add("has-tabbar");
  })();

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
      : '<a href="signup.html">Sign in</a><a class="req" href="signup.html">Join the waitlist</a>';
    menu.innerHTML = head + '<div class="sec">' + member + '</div>' + (setupRow ? '<div class="sec">' + setupRow + '</div>' : '') + '<div class="sec">' + auth + '</div>';
    var so = document.getElementById("v11-signout");
    if (so) so.addEventListener("click", function () { try { window.tures.signOut(); } catch (_) {} location.reload(); });
    document.getElementById("v11-acct-btn").classList.toggle("on", signed);
  }
  renderAcct();
  if (window.turesFunnel) window.turesFunnel.on(renderAcct);

  /* ---- styles for the new chrome (primary CTA, right cluster, onboarding bar) ---- */
  (function () {
    var s = document.createElement("style");
    s.textContent =
      '.v11-menu-wrap{display:flex;align-items:center;gap:2px;position:relative}' +
      '.v11-home{display:inline-flex;align-items:center;text-decoration:none;color:inherit;transition:opacity .2s}' +
      '.v11-home:hover{opacity:.82}' +
      '.v11-logo{background:none;border:none;cursor:pointer;padding:6px 2px;display:inline-flex;align-items:center}' +
      '.v11-right{display:flex;align-items:center;gap:14px}' +
      '.v11-cta{display:inline-flex;align-items:center;gap:7px;background:var(--acc,#ff4929);color:#fff;font:600 13.5px "Inter","DM Sans",sans-serif;border-radius:999px;padding:9px 16px;white-space:nowrap;box-shadow:0 0 0 1px rgba(255,73,41,.18);transition:transform .15s,box-shadow .2s}' +
      '.v11-cta:hover{transform:translateY(-1px);box-shadow:0 8px 20px -6px rgba(255,73,41,.45)}' +
      '.v11-onboard{display:none;background:linear-gradient(to bottom,var(--acc-dim,rgba(255,73,41,.10)),rgba(255,255,255,0));border-bottom:1px solid var(--line,rgba(26,26,26,.10))}' +
      '.v11-onboard.show{display:block}' +
      '.v11-onboard .ob-in{max-width:var(--maxw,1120px);margin:0 auto;padding:10px 24px;display:flex;align-items:center;gap:16px}' +
      '.v11-onboard .ob-lbl{font:600 12px "Inter",sans-serif;color:var(--text,#1a1a1a);white-space:nowrap}' +
      '.v11-onboard .ob-track{flex:0 0 120px;height:5px;border-radius:999px;background:var(--surface-2,#eaeaea);overflow:hidden}' +
      '.v11-onboard .ob-fill{height:100%;background:var(--acc,#ff4929);border-radius:999px;transition:width .4s}' +
      '.v11-onboard .ob-next{font:500 13px "Inter",sans-serif;color:var(--acc-deep,#cf3b1f);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}' +
      '.v11-onboard .ob-next:hover{text-decoration:underline}' +
      '.v11-onboard .ob-x{margin-left:auto;background:none;border:none;color:var(--muted,#7a7a7a);font-size:18px;line-height:1;cursor:pointer;padding:4px}' +
      '@media(max-width:620px){.v11-cta{display:none}.v11-onboard .ob-track{flex-basis:64px}.v11-onboard .ob-lbl .full{display:none}}';
    document.head.appendChild(s);
  })();

  /* ---- onboarding progress bar: surfaces funnel.js setupStatus for users who've started ---- */
  (function () {
    var F = window.turesFunnel; if (!F) return;
    // Setup progress belongs in the account/app zone — NOT on the explainer/marketing pages.
    // (Showing "2 of 6 · next: set your home airport" on "What is Tures", before the visitor has
    // consciously done anything, reads as confusing and presumptuous.)
    if (["trips", "vault", "taste"].indexOf(cur) < 0) return;
    var bar = document.createElement("div"); bar.className = "v11-onboard"; bar.id = "v11-onboard";
    nav.insertAdjacentElement("afterend", bar);
    var dismissed = false; try { dismissed = sessionStorage.getItem("tures.ob.x") === "1"; } catch (_) {}
    function started() { var st = F.setupStatus(); return st.done > 0 || F.signedIn() || !!F.taste() || !!F.pendingTrip.get(); }
    function render() {
      var st = F.setupStatus(), nx = F.nextStep();
      if (dismissed || st.complete || !nx || !started()) { bar.classList.remove("show"); return; }
      bar.innerHTML =
        '<div class="ob-in">' +
          '<span class="ob-lbl"><span class="full">Your setup · </span>' + st.done + ' of ' + st.total + '</span>' +
          '<span class="ob-track"><span class="ob-fill" style="width:' + st.percent + '%"></span></span>' +
          '<a class="ob-next" href="' + nx.href + '">Next: ' + nx.label + ' →</a>' +
          '<button class="ob-x" id="ob-x" type="button" aria-label="Dismiss">×</button>' +
        '</div>';
      bar.classList.add("show");
      var x = document.getElementById("ob-x");
      if (x) x.addEventListener("click", function () { dismissed = true; try { sessionStorage.setItem("tures.ob.x", "1"); } catch (_) {} bar.classList.remove("show"); });
    }
    render();
    F.on(render);
  })();

  /* Headings are now heavy Inter via the real stylesheets (v11.css + per-page);
     the t✦ures wordmark and concierge avatars stay Playfair by design. (The old
     runtime "force Inter on everything serif" hack was removed — it overrode the
     wordmark/avatars too.) */

  /* ---- corner concierge (loads on every page; suppresses itself on Plan) ---- */
  var cz = document.createElement("script"); cz.src = "assets/concierge.js"; cz.defer = true; document.body.appendChild(cz);
})();
