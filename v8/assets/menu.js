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
  var noTheme = isCover || isWrite;

  try { if (!noTheme && localStorage.getItem('tures.theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {}

  if (window.__turesChrome) return;
  window.__turesChrome = true;

  var PAGES = [
    { t: 'The cover', f: 'index.html', cover: true },
    { p: '1', t: 'What is Tures', f: '01-landing.html' },
    { p: '2', t: 'Plan a trip', f: '03-paste-trip.html', kids: [
        { t: 'The Taste Engine', f: '02-taste-engine.html' },
        { t: 'Connections',      f: '04-connections.html' },
        { t: 'Live execution',   f: '05-execution.html' },
        { t: 'The Hiccup Handler', f: '06-hiccup-handler.html' }
    ]},
    { p: '3', t: 'My Trips', f: '07-itinerary.html' },
    { p: '4', t: 'The concierge', f: '08-concierge.html' },
    { t: 'Where you’ve been', f: 'been.html' },
    { sep: true },
    { small: true, t: 'Watch the demo', f: '05-execution.html?demo=1' },
    { small: true, t: 'Pricing', f: 'pricing.html' },
    { small: true, t: 'About', f: 'about.html' },
    { small: true, t: 'Contact', f: 'about.html#contact' },
    { small: true, t: 'Privacy', f: 'legal/privacy.html' },
    { small: true, t: 'Terms', f: 'legal/terms.html' },
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

    if (!noTheme) {
      menu.appendChild(el('div', 'sep'));
      var dark = document.documentElement.classList.contains('dark');
      var tg = el('button', 'theme-item', '<span>Dark mode</span><span class="sw">' + (dark ? '☀' : '☾') + '</span>');
      tg.type = 'button';
      tg.addEventListener('click', function (e) {
        e.stopPropagation();
        var on = document.documentElement.classList.toggle('dark');
        try { localStorage.setItem('tures.theme', on ? 'dark' : 'light'); } catch (er) {}
        tg.querySelector('.sw').textContent = on ? '☀' : '☾';
      });
      menu.appendChild(tg);
    }
    return menu;
  }

  function init() {
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
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
