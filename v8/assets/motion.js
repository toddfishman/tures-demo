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

  window.tmotion = T;
})();
