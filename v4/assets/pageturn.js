/* Tures — page-turn transitions between chapters.
   A leather leaf hinged on the spine turns the page. Forward (next) turns
   right-to-left; back (prev) turns left-to-right. Navigate by clicking
   links, swiping (touch, anywhere), or the arrow keys. The t✦ures logo
   reverts home. Direction is carried across documents via sessionStorage
   so the arriving page peels away on the correct side. */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    if (REDUCE) { wrap.style.display = 'none'; return; }
    var dir = 'next';
    try { dir = sessionStorage.getItem('ptDir') || 'next'; sessionStorage.removeItem('ptDir'); } catch (e) {}
    wrap.style.display = '';
    leaf.className = (dir === 'prev' ? 'out-prev' : 'out-next') + ' start';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('go'); });
    });
    leaf.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      leaf.removeEventListener('transitionend', onEnd);
      wrap.style.display = 'none';
    });
  }

  // departure: leaf sweeps in to cover, then we navigate
  var leaving = false;
  function exit(href, dir) {
    if (REDUCE) { window.location.href = href; return; }
    if (leaving) return; leaving = true;
    try { sessionStorage.setItem('ptDir', dir); } catch (e) {}
    wrap.style.display = '';
    leaf.className = (dir === 'prev' ? 'in-prev' : 'in-next') + ' start';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('go'); });
    });
    setTimeout(function () { window.location.href = href; }, 470);
  }

  function go(dir) {
    var i = ORDER.indexOf(current());
    if (i === -1) return;
    if (window.__turesOnSwipe && window.__turesOnSwipe(dir)) return;  // page may intercept (cover opening)
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
