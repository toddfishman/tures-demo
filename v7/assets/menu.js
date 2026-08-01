/* Tures — universal ✦ home button.
 *
 * A single gold star, fixed in the upper-right of every page, that returns to the cover
 * (index.html). Replaces the old overlay menu so there is always one obvious way home.
 * Self-contained: just include this script on any page (use ../assets/menu.js from a subfolder).
 */
(function () {
  if (window.__turesHome) return;
  window.__turesHome = true;

  function init() {
    var here = location.pathname.split('/').pop().split('?')[0].split('#')[0];
    // The cover itself IS home — it doesn't need a home button.
    if (here === '' || here === 'index.html') return;

    // Pages in a subfolder (auth/, legal/) reach the cover one level up.
    var inSub = /\/(auth|legal)\//.test(location.pathname);
    var home = inSub ? '../index.html' : 'index.html';

    var a = document.createElement('a');
    a.href = home;
    a.className = 'tures-home-star';
    a.setAttribute('aria-label', 'Home');
    a.setAttribute('title', 'Home');
    a.innerHTML = 't<span class="spark">✦</span>';
    document.body.appendChild(a);

    // Retire any inline nav links for the clean look (the wordmark, if present, stays).
    var nav = document.querySelector('header nav');
    if (nav) {
      var wm = nav.querySelector('.wordmark');
      Array.prototype.slice.call(nav.children).forEach(function (c) {
        if (!wm || !c.contains(wm)) c.style.display = 'none';
      });
    }
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
