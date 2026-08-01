/* v12 — lightweight scroll parallax for the cover (index). Respects reduced motion. */
(function () {
  if (!document.querySelector(".px-root")) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* reveal panels as they enter the viewport */
  var reveals = [].slice.call(document.querySelectorAll(".px-reveal"));
  if (reveals.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  if (reduce) return;

  var nav = document.querySelector(".v11-nav");
  function navSolid() {
    if (!nav) return;
    var solid = window.scrollY > window.innerHeight * 0.42;
    nav.classList.toggle("nav-solid", solid);
    nav.classList.toggle("px-nav-solid", solid);
  }

  var bgs = [].slice.call(document.querySelectorAll(".px-bg-inner"));
  var ticking = false;
  function update() {
    ticking = false;
    var vh = window.innerHeight;
    bgs.forEach(function (bg) {
      var panel = bg.closest(".px-panel");
      if (!panel) return;
      var rect = panel.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh * 1.2) return;
      var speed = parseFloat(bg.getAttribute("data-speed") || "0.38");
      var shift = (rect.top - vh * 0.15) * speed * -1;
      bg.style.transform = "translate3d(0," + shift.toFixed(1) + "px,0) scale(1.08)";
    });
  }
  function onScroll() { navSolid(); if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  navSolid();
  update();
})();
