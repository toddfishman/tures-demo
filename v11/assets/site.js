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
      { href: "proactive.html", label: "The Concierge",    page: "concierge", n: "7" }
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

  /* ---- top nav ---- */
  var nav = document.createElement("header");
  nav.className = "v11-nav";
  nav.innerHTML =
    '<div class="in">' +
      '<a class="mark" href="index.html">' + MARK + '</a>' +
      '<nav class="links">' +
        PRIMARY.map(function (l) { return '<a class="' + on(l.page).trim() + '" href="' + l.href + '">' + l.label + '</a>'; }).join("") +
      '</nav>' +
      '<div class="right">' +
        '<button class="btn ghost sm" id="v11-pages" type="button">☰ Pages</button>' +
        '<a class="signin" href="signup.html">Sign in</a>' +
        '<a class="btn sm" href="signup.html">Request access</a>' +
      '</div>' +
    '</div>';
  document.body.insertBefore(nav, document.body.firstChild);

  /* ---- slide-out full page menu ---- */
  var drawer = document.createElement("div");
  drawer.className = "v11-drawer";
  drawer.innerHTML =
    '<div class="panel">' +
      '<div class="dh"><span class="mark serif" style="font-size:22px;font-weight:600">' + MARK + '</span><button class="x" id="v11-x" aria-label="Close">×</button></div>' +
      GROUPS.map(function (g) {
        return '<div class="grp">' + g.title + '</div>' +
          g.items.map(function (it) {
            return '<a class="' + on(it.page).trim() + '" href="' + it.href + '">' +
              (it.n ? '<span class="n">' + it.n + '</span>' : '<span class="n"></span>') + it.label + '</a>';
          }).join("");
      }).join("") +
    '</div>';
  document.body.appendChild(drawer);

  function openD() { drawer.classList.add("open"); }
  function closeD() { drawer.classList.remove("open"); }
  document.getElementById("v11-pages").addEventListener("click", openD);
  document.getElementById("v11-x").addEventListener("click", closeD);
  drawer.addEventListener("click", function (e) { if (e.target === drawer) closeD(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeD(); });

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
})();
