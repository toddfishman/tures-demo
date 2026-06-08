/* Tures — page-turn transitions between chapters.
   A leather leaf hinged on the spine swings in to cover the page before
   navigating, and peels away on arrival. Click links, swipe (touch), or
   use the arrow keys. Clicking the t✦ures logo reverts home. */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // chapter order for swipe / arrow navigation
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

  // arrival: leaf starts flat (covering), then turns away over the spine
  function enter() {
    if (REDUCE) { wrap.style.display = 'none'; return; }
    leaf.className = 'cover'; wrap.style.display = '';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('turn-out'); });
    });
    leaf.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      leaf.removeEventListener('transitionend', onEnd);
      wrap.style.display = 'none';
    });
  }

  // departure: leaf swings in to cover, then we navigate. dir 'next' (from right) | 'prev' (from left)
  var leaving = false;
  function exit(href, dir) {
    if (REDUCE) { window.location.href = href; return; }
    if (leaving) return; leaving = true;
    wrap.style.display = '';
    leaf.className = 'incoming' + (dir === 'prev' ? ' rev' : '');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('turn-in'); });
    });
    setTimeout(function () { window.location.href = href; }, 480);
  }

  function go(dir) {
    var i = ORDER.indexOf(current());
    if (i === -1) return;
    // let a page intercept (e.g. the cover opening on the index)
    if (window.__turesOnSwipe && window.__turesOnSwipe(dir)) return;
    var j = dir === 'next' ? i + 1 : i - 1;
    if (j < 0 || j >= ORDER.length) return;            // clamp at the ends
    exit(ORDER[j], dir);
  }

  function isInternal(a, href) {
    if (!href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (href[0] === '#' || /^(https?:|mailto:|tel:)/i.test(href)) return false;
    return /\.html?($|[?#])/.test(href) || href === '' || href === '.';
  }

  // link clicks (logo links to index.html → reverts home)
  document.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!isInternal(a, href)) return;
    if (a.getAttribute('onclick')) return;   // let inline handlers (e.g. closeBook) run
    e.preventDefault();
    exit(href, 'next');
  });

  // arrow keys
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') go('prev');
    else if (e.key === 'ArrowRight') go('next');
  });

  // touch swipe
  var sx = 0, sy = 0, st = 0, swiping = false;
  function noSwipe(el) {
    return el && el.closest && el.closest('.overflow-x-auto, textarea, input, [data-noswipe]');
  }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || noSwipe(e.target)) { swiping = false; return; }
    var t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); swiping = true;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!swiping) return; swiping = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
    if (dt > 800) return;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 'next' : 'prev');   // swipe left → next page, swipe right → previous
  }, { passive: true });

  function mount() { document.body.appendChild(wrap); enter(); }
  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; enter(); } });
})();
