/* Tures — universal top chrome: a logo (upper-left) that opens a "Contents" dropdown
 * modelling the app as a bound book, and a Sign Up button (upper-right). The dark/light
 * toggle lives inside the dropdown. Included on every page (use ../assets/menu.js from a subfolder).
 *
 * The page model:
 *   The cover          = index.html  (the landing; write.html is the cover's own page-turn)
 *   Page 1 · What is Tures        = 01-landing.html
 *   Page 2 · Plan a trip          = 03-paste-trip.html  ▸ Taste Engine / Connections / Live execution / Hiccup Handler
 *   Page 3 · My Trips             = 07-itinerary.html
 *   Page 4 · The concierge        = 08-concierge.html
 */
(function () {
  var path = location.pathname;
  var here = path.split('/').pop().split('?')[0].split('#')[0];
  if (here === '') here = 'index.html';
  var inSub = /\/(auth|legal)\//.test(path);
  var base = inSub ? '../' : '';

  var isCover = (here === 'index.html');
  var isWrite = (here === 'write.html');
  var noTheme = isCover || isWrite;   // cover & write carry their own inline scene / no chrome theming

  // v9 theme sandbox: two switchable directions (parchment | oxblood), applied on EVERY page
  // incl. the cover. Replaces v8's dark-mode toggle. Persisted to localStorage 'tures.v9theme'.
  // v9 is Parchment all the way — the Oxblood direction was retired.
  document.documentElement.setAttribute('data-theme', 'parchment');

  // Seasonal accent: swaps the accent tokens; the parchment paper stays constant.
  var ACCENT_KEY = 'tures.v9accent';
  var accent = 'autumn';
  try { var _a = localStorage.getItem(ACCENT_KEY); if (['spring', 'summer', 'autumn', 'winter'].indexOf(_a) > -1) accent = _a; } catch (e) {}
  document.documentElement.setAttribute('data-accent', accent);

  /* Pages that wear the rotating destination backdrop behind their content.
     The cover and write.html carry their own inline scene, so they're excluded. */
  var SCENE_PAGES = {
    '01-landing.html': 1, '02-taste-engine.html': 1, '04-connections.html': 1,
    '06-hiccup-handler.html': 1, '07-itinerary.html': 1, 'been.html': 1, 'pricing.html': 1
  };
  var wantsScene = !noTheme && !inSub && SCENE_PAGES[here] === 1;
  // Add the opt-in class as early as possible so the body never flashes opaque obsidian.
  if (wantsScene) document.documentElement.classList.add('tures-scene-on');

  // 10 destinations on a 90s loop — same set as the cover (5 local + 5 Unsplash).
  // All self-hosted now (was 5 local + 5 Unsplash hotlinks): crisper, faster, no external
  // dependency. The five former hotlinks are saved under assets/img/ as webp.
  var SCENE_IMGS = [
    base + 'assets/img/tulum-1920.webp', base + 'assets/img/paris-1920.webp',
    base + 'assets/img/tokyo-1920.webp', base + 'assets/img/aurora-1920.webp',
    base + 'assets/img/nyc-1920.webp',
    base + 'assets/img/amalfi-1920.webp', base + 'assets/img/santorini-2400.webp',
    base + 'assets/img/kyoto-2400.webp', base + 'assets/img/swiss-alps-2400.webp',
    base + 'assets/img/venice-2400.webp'
  ];
  function injectScene() {
    if (!wantsScene || document.querySelector('.tures-bg')) return;
    var bg = document.createElement('div'); bg.className = 'tures-bg'; bg.setAttribute('aria-hidden', 'true');
    SCENE_IMGS.forEach(function (src, i) {
      var f = document.createElement('div'); f.className = 'fi';
      f.style.backgroundImage = "url('" + src + "')";
      f.style.animationDelay = (i * 9) + 's';
      bg.appendChild(f);
    });
    var veil = document.createElement('div'); veil.className = 'tbg-veil'; bg.appendChild(veil);
    document.body.insertBefore(bg, document.body.firstChild);
  }

  if (window.__turesChrome) return;
  window.__turesChrome = true;

  var PAGES = [
    { t: 'The cover', f: 'index.html', cover: true },
    { p: '1',  t: 'What is Tures',        f: '01-landing.html' },
    { p: '2',  t: 'Plan a trip',          f: '03-paste-trip.html' },
    { p: '3',  t: 'The Taste Engine',     f: '02-taste-engine.html' },
    { p: '4',  t: 'Tures Vault Setup',    f: '04-connections.html' },
    { p: '5',  t: 'Tures Demo',           f: '05-execution.html' },
    { p: '6',  t: 'My Trips',             f: '07-itinerary.html' },
    { p: '7',  t: 'The Tures Concierge',  f: '08-concierge.html' },
    { p: '8',  t: 'The Hiccup Handler',   f: '06-hiccup-handler.html' },
    { p: '9',  t: 'Where you’ve been',    f: 'been.html' },
    { p: '10', t: 'Pricing',              f: 'pricing.html' },
    { p: '11', t: 'About',                f: 'about.html' },
    { p: '12', t: 'Contact',              f: 'about.html#contact' },
    { p: '13', t: 'Privacy & Terms',      f: 'legal/index.html' },
    { sep: true },
    { socials: true }
  ];
  // SOCIALS: placeholder URLs — replace with the real handles.
  var SOCIALS = [
    { t: 'X', u: 'https://x.com/' },
    { t: 'Instagram', u: 'https://instagram.com/' },
    { t: 'LinkedIn', u: 'https://linkedin.com/' }
  ];

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function isHere(f) { return f.split('?')[0] === here; }
  function pageNumber() {
    for (var i = 0; i < PAGES.length; i++) {
      var it = PAGES[i];
      if (it.f && isHere(it.f)) return it.p || null;
      if (it.kids) for (var j = 0; j < it.kids.length; j++) { if (isHere(it.kids[j].f)) return it.kids[j].p || null; }
    }
    return null;
  }

  function pageLink(it, sub) {
    var a = el('a', sub ? 'sub' : null,
      (it.p ? '<span class="pg">Page ' + it.p + '</span>' : '') + '<span class="lbl">' + it.t + '</span>');
    a.href = base + it.f;
    if (isHere(it.f) || (it.cover && isWrite)) a.className = (a.className ? a.className + ' ' : '') + 'here';
    return a;
  }

  function buildMenu() {
    var menu = el('div', 'tures-menu'); menu.setAttribute('role', 'menu');
    PAGES.forEach(function (it) {
      if (it.sep) { menu.appendChild(el('div', 'sep')); return; }
      if (it.socials) {
        var row = el('div', 'socials');
        SOCIALS.forEach(function (s) { var a = el('a', null, s.t); a.href = s.u; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a); });
        menu.appendChild(row); return;
      }
      if (it.small) { var s = el('a', 'small', it.t); s.href = base + it.f; menu.appendChild(s); return; }

      if (it.kids) {
        var grp = el('div', 'grp');
        var head = el('div', 'grp-head');
        head.appendChild(pageLink(it));
        var chev = el('button', 'chev', '›'); chev.type = 'button'; chev.setAttribute('aria-label', 'Expand');
        head.appendChild(chev);
        grp.appendChild(head);
        var kids = el('div', 'kids');
        it.kids.forEach(function (k) { kids.appendChild(pageLink(k, true)); });
        grp.appendChild(kids);
        // auto-expand if we're on the parent or any child
        if (isHere(it.f) || it.kids.some(function (k) { return isHere(k.f); })) grp.classList.add('open');
        chev.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); grp.classList.toggle('open'); });
        menu.appendChild(grp);
        return;
      }
      menu.appendChild(pageLink(it));
    });

    // v9: the dark-mode toggle is retired in favour of the Parchment|Oxblood theme switch.
    return menu;
  }

  function init() {
    injectScene();

    // Site-wide motion: the scroll-reveal engine (GSAP-enhanced where present, CSS otherwise).
    // The chat page already loads motion.js in <head>, so only inject where it's missing.
    if (!window.tmotion && !document.querySelector('script[src*="assets/motion.js"]')) {
      var ms = document.createElement('script'); ms.src = base + 'assets/motion.js'; ms.async = false;
      document.head.appendChild(ms);
    }
    var nav = document.querySelector('header nav');
    if (nav) Array.prototype.slice.call(nav.children).forEach(function (c) { c.style.display = 'none'; });

    var wrap = el('div', 'tures-chrome-logo');
    var logo = el('button', 'tures-logo', 't<span class="spark">✦</span>ures<span class="car">▾</span>');
    logo.type = 'button'; logo.setAttribute('aria-label', 'Contents'); logo.setAttribute('aria-haspopup', 'true');
    var menu = buildMenu();
    wrap.appendChild(logo); wrap.appendChild(menu);
    document.body.appendChild(wrap);

    function close() { menu.classList.remove('open'); }
    logo.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    var signed = false;
    try { signed = !!(window.tures && window.tures.signedIn); } catch (e) {}
    var act = el('a', 'tures-signup', signed ? 'Account' : 'Sign Up');
    act.href = base + (signed ? 'account.html' : 'signup.html');
    document.body.appendChild(act);

    // book-style page number, lower-right
    var num = pageNumber();
    if (num) document.body.appendChild(el('div', 'tures-pageno', 'Page ' + num));

    // floating seasonal-accent picker, lower-left (Parchment is the only theme now)
    var sw = el('div', 'tures-theme-switch');
    sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Seasonal accent');
    sw.appendChild(el('span', 'ts-label', 'Season'));
    var SEASONS = [['spring', 'Spring', '#6f8f4a'], ['summer', 'Summer', '#c06a3e'], ['autumn', 'Autumn', '#bb8d3a'], ['winter', 'Winter', '#5b7790']];
    var arow = el('div', 'tures-accent');
    SEASONS.forEach(function (s) {
      var b = el('button', accent === s[0] ? 'on' : null); b.type = 'button'; b.title = s[1]; b.setAttribute('aria-label', s[1]); b.style.background = s[2];
      b.addEventListener('click', function () {
        accent = s[0];
        document.documentElement.setAttribute('data-accent', accent);
        try { localStorage.setItem(ACCENT_KEY, accent); } catch (e) {}
        Array.prototype.forEach.call(arow.children, function (c) { c.className = (c === b ? 'on' : ''); });
      });
      arow.appendChild(b);
    });
    sw.appendChild(arow);
    document.body.appendChild(sw);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
