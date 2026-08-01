/* Tures — GSAP-powered motion helpers (PROGRESSIVE ENHANCEMENT).
   If GSAP is absent or the visitor prefers reduced motion, every helper is a
   safe no-op that returns false, and the caller falls back to the page's own
   CSS animation. Helpers never leave content hidden: they animate FROM a
   hidden state TO visible and clear their inline transforms when done. */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ok() { return !!window.gsap && !REDUCE; }

  var T = {
    available: ok,

    /* Cascade a set of cards in with a spring-eased rise. Returns true if it
       handled the animation — the caller should then NOT add its CSS '.in'. */
    revealStagger: function (nodes, opts) {
      if (!ok() || !nodes) return false;
      nodes = Array.prototype.slice.call(nodes);
      if (!nodes.length) return false;
      opts = opts || {};
      gsap.killTweensOf(nodes);
      gsap.fromTo(nodes,
        { opacity: 0, y: (opts.y != null ? opts.y : 16) },
        {
          opacity: 1, y: 0,
          duration: opts.duration || 0.62,
          ease: opts.ease || 'power3.out',
          stagger: opts.stagger || 0.07,
          clearProps: 'transform'
        });
      return true;
    },

    /* A single element rising in. Returns true if handled. */
    reveal: function (node, opts) {
      if (!ok() || !node) return false;
      opts = opts || {};
      gsap.killTweensOf(node);
      gsap.fromTo(node,
        { opacity: 0, y: (opts.y != null ? opts.y : 12) },
        {
          opacity: 1, y: 0,
          duration: opts.duration || 0.5,
          ease: opts.ease || 'power3.out',
          clearProps: 'transform'
        });
      return true;
    }
  };

  /* ---- SCROLL REVEAL (site-wide, FOUC-proof) ----------------------------------
     Elements marked [data-reveal] rise + fade as they scroll into view. We only hide
     elements that START below the viewport, so anything already on screen never flashes.
     GSAP provides the spring where loaded; otherwise a CSS transition (.tm-pre → .tm-in)
     does it. Skipped entirely under reduced motion, with a failsafe so nothing can stay
     stuck hidden. */
  function revealOne(el) {
    if (window.gsap && !REDUCE) {
      el.classList.remove('tm-pre');
      gsap.fromTo(el, { opacity: 0, y: 22 },
        { opacity: 1, y: 0, duration: 0.72, ease: 'power3.out', clearProps: 'transform' });
    } else {
      el.classList.add('tm-in');   // CSS transition out of .tm-pre
    }
  }

  function initReveal() {
    if (REDUCE || !('IntersectionObserver' in window)) return;
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    var vh = window.innerHeight || 800;
    var armed = [];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { revealOne(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    [].forEach.call(els, function (el) {
      // Already on (or near) screen at load → leave visible, never hide/flash it.
      if (el.getBoundingClientRect().top < vh * 0.92) return;
      el.classList.add('tm-pre');
      io.observe(el);
      armed.push(el);
    });

    // Backup paths so content can NEVER stay stuck hidden if the observer misses:
    // a passive scroll sweep + a one-shot timeout. Both reveal any armed, in-view element.
    function isRevealed(el) { return !el.classList.contains('tm-pre') || el.classList.contains('tm-in'); }
    function sweep() {
      var remaining = false;
      armed.forEach(function (el) {
        if (isRevealed(el)) return;
        if (el.getBoundingClientRect().top < vh * 0.9) { revealOne(el); io.unobserve(el); }
        else remaining = true;
      });
      if (!remaining) window.removeEventListener('scroll', onScroll);
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      (window.requestAnimationFrame || window.setTimeout)(function () { ticking = false; sweep(); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(sweep, 2600);
  }

  function boot() { if (window.__tmRevealBooted) return; window.__tmRevealBooted = true; initReveal(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.tmotion = T;
})();
