/* Tures — shared ✦ menu.
 *
 * Replaces the inline nav links on every page with a single star (✦) trigger and an
 * elegant full-screen overlay that EXPLAINS what Tures can do (Taste Engine, live
 * execution, Hiccup Handler, the travel map) and how to reach it from anywhere
 * (WhatsApp / Telegram / Web & App). Self-contained: just include this script.
 */
(function () {
  if (window.__turesMenu) return;
  window.__turesMenu = true;

  var TPL =
    '<div class="scrim" data-close></div>' +
    '<div class="menu-panel">' +
      '<div class="menu-inner">' +
        '<div class="menu-top">' +
          '<a href="01-landing.html" class="wordmark foil text-3xl quiet">t<span class="spark">✦</span>ures</a>' +
          '<button class="menu-close" type="button" aria-label="Close menu" data-close>×</button>' +
        '</div>' +

        '<a class="menu-cta" href="03-paste-trip.html">' +
          '<span><span class="menu-cta-k">Plan a trip</span>' +
          '<span class="menu-cta-s">Describe it in a sentence · pay only when it books</span></span>' +
          '<span class="menu-arrow">→</span>' +
        '</a>' +

        '<div class="menu-group">' +
          '<div class="menu-label">What Tures does</div>' +
          '<a class="menu-item" href="02-taste-engine.html"><span class="mi-t">Taste Engine</span><span class="mi-d">Six swipes become a working model of how you travel.</span><span class="mi-c">›</span></a>' +
          '<a class="menu-item" href="05-execution.html"><span class="mi-t">Watch it execute</span><span class="mi-d">A live agent stream, booking your trip leg by leg.</span><span class="mi-c">›</span></a>' +
          '<a class="menu-item" href="06-hiccup-handler.html"><span class="mi-t">Hiccup Handler</span><span class="mi-d">Watches your trip around the clock — and rebooks before you even notice.</span><span class="mi-c">›</span></a>' +
          '<a class="menu-item" href="been.html"><span class="mi-t">Where you’ve been</span><span class="mi-d">Your travel map — the places you loved, feeding your taste.</span><span class="mi-c">›</span></a>' +
        '</div>' +

        '<div class="menu-group">' +
          '<div class="menu-label">Plan from anywhere</div>' +
          '<div class="menu-channels"><span class="chan">WhatsApp</span><span class="chan">Telegram</span><span class="chan">Web &amp; App</span></div>' +
          '<p class="menu-note">Brief Tures the way you’d text a friend — a message, a voice memo, or a forwarded email. Same concierge, wherever you already are.</p>' +
        '</div>' +

        '<div class="menu-foot">' +
          '<a href="pricing.html">Pricing</a>' +
          '<a href="index.html#contents">All chapters</a>' +
          '<a href="signup.html">Sign in</a>' +
        '</div>' +
      '</div>' +
    '</div>';

  function init() {
    var nav = document.querySelector('header nav');
    if (!nav) return;
    var wm = nav.querySelector('.wordmark');

    // Retire the old-school inline links: hide every nav child except the wordmark's.
    Array.prototype.slice.call(nav.children).forEach(function (c) {
      if (!wm || !c.contains(wm)) c.style.display = 'none';
    });

    // ✦ trigger
    var btn = document.createElement('button');
    btn.className = 'menu-star';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = '✦';
    nav.appendChild(btn);

    // overlay
    var ov = document.createElement('div');
    ov.className = 'menu-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Menu');
    ov.innerHTML = TPL;
    document.body.appendChild(ov);

    function open() { ov.classList.add('open'); document.body.style.overflow = 'hidden'; btn.setAttribute('aria-expanded', 'true'); }
    function close() { ov.classList.remove('open'); document.body.style.overflow = ''; btn.setAttribute('aria-expanded', 'false'); }

    btn.addEventListener('click', open);
    ov.addEventListener('click', function (e) {
      // Close on the scrim / close button / empty panel space; let real links navigate.
      if (e.target.hasAttribute('data-close')) { close(); return; }
      if (!e.target.closest('.menu-inner')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ov.classList.contains('open')) close();
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
