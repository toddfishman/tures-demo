/* Tures — universal top chrome: a logo (upper-left) that opens a "Contents" dropdown
 * listing every page as a page (Cover = the landing, Page 1 = Your edition, …), and a
 * Sign Up button (upper-right). The dark/light toggle lives inside the dropdown.
 * Included on every page. Self-contained — use ../assets/menu.js from a subfolder.
 *
 * The "every URL is a page" model:
 *   Cover (the landing) = index.html
 *   Page 1 · Your edition = write.html
 *   Page 2 · What is Tures = 01-landing.html  … and so on.
 */
(function () {
  var path = location.pathname;
  var here = path.split('/').pop().split('?')[0].split('#')[0];
  if (here === '') here = 'index.html';
  var inSub = /\/(auth|legal)\//.test(path);
  var base = inSub ? '../' : '';

  var isCover = (here === 'index.html');
  var isWrite = (here === 'write.html');
  var noTheme = isCover || isWrite;            // the dark "book" pages aren't themed

  // Apply the saved theme as early as possible (this script runs near </body>).
  try { if (!noTheme && localStorage.getItem('tures.theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {}

  if (window.__turesChrome) return;
  window.__turesChrome = true;

  // The contents / page list.
  var PAGES = [
    { p: 'Cover',  t: 'The landing',       f: 'index.html' },
    { p: 'Page 1', t: 'Your edition',      f: 'write.html' },
    { p: 'Page 2', t: 'What is Tures',     f: '01-landing.html' },
    { p: 'Page 3', t: 'The Taste Engine',  f: '02-taste-engine.html' },
    { p: 'Page 4', t: 'Plan a trip',       f: '03-paste-trip.html' },
    { p: 'Page 5', t: 'Connections',       f: '04-connections.html' },
    { p: 'Page 6', t: 'Live execution',    f: '05-execution.html' },
    { p: 'Page 7', t: 'The Hiccup Handler', f: '06-hiccup-handler.html' },
    { p: 'Page 8', t: 'The itinerary',     f: '07-itinerary.html' },
    { p: 'Page 9', t: 'The concierge',     f: '08-concierge.html' },
    { sep: true },
    { p: '',       t: 'Pricing',           f: 'pricing.html' }
  ];

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function buildMenu() {
    var menu = el('div', 'tures-menu'); menu.setAttribute('role', 'menu');
    PAGES.forEach(function (it) {
      if (it.sep) { menu.appendChild(el('div', 'sep')); return; }
      var a = el('a', null, '<span>' + (it.p ? '<span class="pg">' + it.p + '</span> ' : '') + it.t + '</span>');
      a.href = base + it.f;
      if (it.f === here) a.className = 'here';
      menu.appendChild(a);
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
    // hide any per-page nav so the chrome is the single, consistent header
    var nav = document.querySelector('header nav');
    if (nav) Array.prototype.slice.call(nav.children).forEach(function (c) { c.style.display = 'none'; });

    // logo + dropdown, upper-left
    var wrap = el('div', 'tures-chrome-logo');
    var logo = el('button', 'tures-logo', 't<span class="spark">✦</span>ures<span class="car">▾</span>');
    logo.type = 'button';
    logo.setAttribute('aria-label', 'Contents');
    logo.setAttribute('aria-haspopup', 'true');
    var menu = buildMenu();
    wrap.appendChild(logo); wrap.appendChild(menu);
    document.body.appendChild(wrap);

    function close() { menu.classList.remove('open'); }
    logo.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    // Sign Up (or Account when signed in), upper-right
    var signed = false;
    try { signed = !!(window.tures && window.tures.signedIn); } catch (e) {}
    var act = el('a', 'tures-signup', signed ? 'Account' : 'Sign Up');
    act.href = base + (signed ? 'account.html' : 'signup.html');
    document.body.appendChild(act);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
