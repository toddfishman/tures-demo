/* Tures — shared app behaviors (vanilla, no deps).
   Auto-wires: count-up numerals, scroll fade-rise, bottom sheets,
   iOS segmented controls, and tap-to-expand cards. Markup-driven:
     data-countup="14208"        → counts 0→target when scrolled into view
     class="rise"                → fades up from below on view entry
     data-sheet="sheetId"        → opens #sheetId as a bottom sheet
     data-sheet-close            → closes the nearest open sheet
     class="seg" data-seg        → segmented control (buttons carry data-v)
     class="exp" + .exp-head     → tap header to expand .exp-body
*/
(function () {
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- count-up ---------- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-countup')) || 0;
    var dur = parseInt(el.getAttribute('data-countup-dur') || '1500', 10);
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    function fmt(v) { return prefix + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suffix; }
    if (RM) { el.textContent = fmt(target); return; }
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- reveal + count-up on viewport entry ----------
     IntersectionObserver drives scroll reveals, but we never want
     content stuck at opacity:0 if IO is slow/blocked (some headless
     or backgrounded contexts). So: reveal anything already in view
     immediately, and add a failsafe that reveals everything left. */
  function reveal(el) {
    if (el.__revealed) return; el.__revealed = true;
    if (el.hasAttribute('data-countup')) countUp(el);
    el.classList.add('in');
  }
  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top < (window.innerHeight * 0.92) && r.bottom > 0;
  }
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (ents) {
    var k = 0;  // stagger items that cross into view together (a row/grid) by 70ms each
    ents.forEach(function (e) {
      if (!e.isIntersecting) return;
      var t = e.target, d = k * 70; k++;
      if (!RM) { t.style.transitionDelay = d + 'ms'; setTimeout(function () { t.style.transitionDelay = ''; }, 900 + d); }
      reveal(t);
      io.unobserve(t);
    });
  }, { threshold: 0.18 }) : null;

  var pending = [].slice.call(document.querySelectorAll('[data-countup], .rise'));
  function watch(el) {
    if (inView(el)) { reveal(el); return; }   // already visible → reveal now
    if (io) io.observe(el); else reveal(el);
  }
  pending.forEach(watch);
  window.turesWatch = watch;
  // failsafe: nothing should ever remain invisible
  window.addEventListener('load', function () { pending.forEach(function (el) { if (inView(el)) reveal(el); }); });
  setTimeout(function () { pending.forEach(reveal); }, 2600);

  /* ---------- bottom sheets ---------- */
  function openSheet(id) {
    var s = document.getElementById(id);
    if (!s) return;
    s.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet(s) {
    if (!s) return;
    s.classList.remove('open');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    var trig = e.target.closest && e.target.closest('[data-sheet]');
    if (trig) { e.preventDefault(); openSheet(trig.getAttribute('data-sheet')); return; }
    var closer = e.target.closest && e.target.closest('[data-sheet-close]');
    if (closer) { closeSheet(closer.closest('.sheet')); return; }
    if (e.target.classList && e.target.classList.contains('sheet-backdrop')) {
      closeSheet(e.target.closest('.sheet'));
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var open = document.querySelector('.sheet.open'); if (open) closeSheet(open); }
  });
  // drag the handle down to dismiss
  document.querySelectorAll('.sheet-panel').forEach(function (panel) {
    panel.setAttribute('data-noswipe', '');
    var handle = panel.querySelector('.sheet-handle');
    if (!handle) return;
    var y0 = 0, dy = 0, dragging = false;
    handle.addEventListener('touchstart', function (ev) {
      dragging = true; y0 = ev.touches[0].clientY; panel.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', function (ev) {
      if (!dragging) return;
      dy = Math.max(0, ev.touches[0].clientY - y0);
      panel.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    handle.addEventListener('touchend', function () {
      dragging = false; panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 90) closeSheet(panel.closest('.sheet'));
      dy = 0;
    });
  });

  /* ---------- segmented controls ---------- */
  document.querySelectorAll('.seg').forEach(function (seg) {
    var btns = [].slice.call(seg.querySelectorAll('button'));
    if (!btns.length) return;
    var thumb = seg.querySelector('.thumb');
    if (!thumb) { thumb = document.createElement('span'); thumb.className = 'thumb'; seg.appendChild(thumb); }
    function move(btn) {
      thumb.style.left = btn.offsetLeft + 'px';
      thumb.style.width = btn.offsetWidth + 'px';
    }
    function select(btn, fire) {
      btns.forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      move(btn);
      if (fire !== false) seg.dispatchEvent(new CustomEvent('segchange', { detail: { value: btn.getAttribute('data-v'), button: btn } }));
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { select(b); }); });
    var init = seg.querySelector('button.on') || btns[0];
    init.classList.add('on');
    // position once layout is ready
    requestAnimationFrame(function () { select(init, false); });
    function reposition() { var on = seg.querySelector('button.on'); if (on && on.offsetWidth) move(on); }
    window.addEventListener('resize', reposition);
    // reposition whenever the control changes size (e.g. revealed from display:none)
    if ('ResizeObserver' in window) new ResizeObserver(reposition).observe(seg);
  });

  /* ---------- subtle scroll parallax (data-parallax="0.2") ---------- */
  var plx = [].slice.call(document.querySelectorAll('[data-parallax]'));
  if (plx.length && !RM) {
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        var y = window.pageYOffset;
        plx.forEach(function (el) {
          var f = parseFloat(el.getAttribute('data-parallax')) || 0.2;
          el.style.transform = 'translateY(' + (y * f) + 'px)';
        });
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- gentle bounded parallax on decorative numerals (.ghost-num) ----------
     Skips any numeral that already uses transform for layout, so centering never breaks. */
  var ghosts = [].slice.call(document.querySelectorAll('.ghost-num')).filter(function (el) {
    return getComputedStyle(el).transform === 'none';
  });
  if (ghosts.length && !RM) {
    var gtick = false;
    function gloop() {
      if (gtick) return; gtick = true;
      requestAnimationFrame(function () {
        var vh = window.innerHeight || 800;
        ghosts.forEach(function (el) {
          var r = el.getBoundingClientRect();
          var center = (r.top + r.height / 2) - vh / 2;
          el.style.transform = 'translateY(' + (-center * 0.06).toFixed(1) + 'px)';
        });
        gtick = false;
      });
    }
    window.addEventListener('scroll', gloop, { passive: true });
    window.addEventListener('resize', gloop);
    gloop();
  }

  /* ---------- tap-to-expand cards ---------- */
  document.addEventListener('click', function (e) {
    var head = e.target.closest && e.target.closest('.exp-head');
    if (!head) return;
    if (e.target.closest('a, button:not(.exp-head)')) return; // let nested controls work
    var card = head.closest('.exp');
    if (card) card.classList.toggle('open');
  });
})();
