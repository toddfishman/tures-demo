/* Tures — universal ✦ home button + dark/light toggle.
 *
 * A gold star (returns to the cover) and a small theme toggle, fixed upper-right on every
 * page EXCEPT the dark "book" pages (the cover index.html and write.html), which are dark
 * by design. The theme choice persists in localStorage ('tures.theme').
 * Self-contained: include this script on any page (use ../assets/menu.js from a subfolder).
 */
(function () {
  var here = location.pathname.split('/').pop().split('?')[0].split('#')[0];
  var isCover = (here === '' || here === 'index.html');       // the cover IS home — no home button
  var noTheme = isCover || here === 'write.html';             // the dark "book" pages aren't themed/toggled

  // Apply the saved theme as early as possible (this script runs near </body>).
  try { if (!noTheme && localStorage.getItem('tures.theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {}

  if (window.__turesHome) return;
  window.__turesHome = true;

  function makeToggle() {
    var b = document.createElement('button');
    b.className = 'tures-theme-toggle';
    b.type = 'button';
    b.setAttribute('aria-label', 'Toggle dark mode');
    b.setAttribute('title', 'Dark / light');
    b.textContent = document.documentElement.classList.contains('dark') ? '☀' : '☾';
    b.addEventListener('click', function () {
      var on = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('tures.theme', on ? 'dark' : 'light'); } catch (e) {}
      b.textContent = on ? '☀' : '☾';
    });
    return b;
  }

  function init() {
    if (isCover) return;                                  // cover: no home button, no toggle

    if (!noTheme) document.body.appendChild(makeToggle()); // write.html keeps its logo but no toggle

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
