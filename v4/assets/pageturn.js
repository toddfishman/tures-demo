/* Tures — page-turn transitions between chapters.
   A leather leaf, hinged on the left spine, swings in to cover the page
   before navigating, and peels away on arrival to reveal the next chapter. */
(function () {
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var wrap = document.createElement('div'); wrap.id = 'pt-wrap';
  var leaf = document.createElement('div'); leaf.id = 'pt-leaf';
  wrap.appendChild(leaf);

  function reset() { leaf.className = ''; wrap.style.display = ''; }

  // arrival: leaf starts flat (covering), then turns away over the spine
  function enter() {
    if (REDUCE) { wrap.style.display = 'none'; return; }
    reset();
    leaf.classList.add('cover');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('turn-out'); });
    });
    leaf.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      leaf.removeEventListener('transitionend', onEnd);
      wrap.style.display = 'none';
    });
  }

  // departure: leaf swings in from the right edge to cover, then we navigate
  var leaving = false;
  function exit(href) {
    if (REDUCE) { window.location.href = href; return; }
    if (leaving) return; leaving = true;
    wrap.style.display = '';
    leaf.className = 'incoming';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { leaf.classList.add('turn-in'); });
    });
    // screen is opaque ~220ms in; navigate once it's fully covered
    setTimeout(function () { window.location.href = href; }, 480);
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
    e.preventDefault();
    exit(href);
  });

  function mount() { document.body.appendChild(wrap); enter(); }
  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // restoring from back/forward cache: clear any leftover cover and replay enter
  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; enter(); } });
})();
