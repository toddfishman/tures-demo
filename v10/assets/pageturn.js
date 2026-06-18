/* Tures — page-turn transitions between chapters.
   A leather leaf hinged on the spine turns the page. Forward (next) turns
   right-to-left; back (prev) turns left-to-right. Navigate by clicking
   links, swiping (touch, anywhere), or the arrow keys. The t✦ures logo
   reverts home. Direction is carried across documents via sessionStorage
   so the arriving page peels away on the correct side. */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* When the browser supports cross-document View Transitions, the navigation itself is
     tweened on the GPU (see tures.css @view-transition) — so the leaf overlay is suppressed
     to avoid stacking two transitions. Departure still uses location.href, which triggers the
     native transition; this script keeps handling keyboard/swipe nav + demo-param carry. */
  // Gate on CROSS-DOCUMENT support specifically: CSSViewTransitionRule (the @view-transition
  // at-rule) + the pageswap event both shipped together with cross-doc VT (Chrome/Edge 126+,
  // Safari 18.2+). Same-document-only browsers (Chrome 111–125) lack these, so they keep the
  // leaf — never suppress it without a real transition to replace it.
  var VT = false;
  try { VT = (typeof window.CSSViewTransitionRule !== 'undefined') && ('onpageswap' in window); } catch (e) {}

  var ORDER = [
    'index.html', '01-landing.html', '02-taste-engine.html', '03-paste-trip.html',
    '04-connections.html', '05-execution.html', '06-hiccup-handler.html',
    '07-itinerary.html', '08-concierge.html', 'about.html'
  ];
  function current() {
    var p = location.pathname.split('/').pop().split('?')[0].split('#')[0];
    if (!p || p === '.') return 'index.html';
    if (!/\.html?$/.test(p)) p += '.html';   // clean-URL servers drop the .html
    return p;
  }

  var wrap = document.createElement('div'); wrap.id = 'pt-wrap';
  var leaf = document.createElement('div'); leaf.id = 'pt-leaf';
  wrap.appendChild(leaf);

  // arrival: the covering leaf peels away on the side matching how we arrived
  function enter() {
    if (REDUCE || VT) { wrap.style.display = 'none'; return; }
    var dir = null;
    try { dir = sessionStorage.getItem('ptDir'); sessionStorage.removeItem('ptDir'); } catch (e) {}
    // Cold arrival (typed URL, refresh, external link, or the auto-revealing cover): there is no
    // previous page to turn from, so skip the leaf — it otherwise flashes a stray turn on landing.
    if (!dir) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    leaf.className = (dir === 'prev' ? 'out-prev' : 'out-next') + ' start';
    var reveal = function () { leaf.classList.add('go'); };
    requestAnimationFrame(function () { requestAnimationFrame(reveal); });
    setTimeout(reveal, 24);  // failsafe: rAF is throttled in background/headless contexts
    var hide = function () { wrap.style.display = 'none'; };
    leaf.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      leaf.removeEventListener('transitionend', onEnd);
      hide();
    });
    setTimeout(hide, 520);  // hard failsafe: the cover can never stay up
  }

  // departure: navigate immediately. The single, fast reveal happens on the *arrival* side
  // (enter), so there's one quick motion per page change instead of a cover-then-reveal pair.
  var leaving = false;
  function exit(href, dir) {
    if (leaving) return; leaving = true;
    try { sessionStorage.setItem('ptDir', dir); } catch (e) {}
    window.location.href = href;
  }

  function go(dir) {
    var i = ORDER.indexOf(current());
    if (i === -1) return;
    if (window.__turesOnSwipe && window.__turesOnSwipe(dir)) return;  // page may intercept (cover opening)
    var j = dir === 'next' ? i + 1 : i - 1;
    if (j < 0 || j >= ORDER.length) return;            // clamp at the ends
    var href = ORDER[j];
    // Carry demo mode through the guided tour (chapter-to-chapter), so Andy stays consistent.
    if (/[?&]demo=1\b/.test(location.search)) href += '?demo=1';
    exit(href, dir);
  }

  function isInternal(a, href) {
    if (!href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (href[0] === '#' || /^(https?:|mailto:|tel:)/i.test(href)) return false;
    return /\.html?($|[?#])/.test(href) || href === '' || href === '.';
  }

  document.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!isInternal(a, href)) return;
    if (a.getAttribute('onclick')) return;   // let inline handlers (e.g. closeBook) run
    e.preventDefault();
    // animate in the conceptual direction: earlier chapter → back, later → forward
    var target = href.split('/').pop().split('?')[0].split('#')[0];
    if (!/\.html?$/.test(target)) target = (target || 'index') + (target ? '.html' : '');
    var ti = ORDER.indexOf(target), ci = ORDER.indexOf(current());
    var dir = (ti !== -1 && ci !== -1 && ti < ci) ? 'prev' : 'next';
    exit(href, dir);
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') go('prev');
    else if (e.key === 'ArrowRight') go('next');
  });

  // touch swipe — works anywhere except while editing a text field
  var sx = 0, sy = 0, st = 0, swiping = false;
  function blocked(el) { return el && el.closest && el.closest('textarea, input, [data-noswipe]'); }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || blocked(e.target)) { swiping = false; return; }
    var t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); swiping = true;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!swiping) return; swiping = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
    if (dt > 900) return;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    go(dx < 0 ? 'next' : 'prev');   // swipe right-to-left → next; left-to-right → previous
  }, { passive: true });

  function mount() { document.body.appendChild(wrap); enter(); }
  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; enter(); } });
})();
