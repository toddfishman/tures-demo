/* Travel backdrop — hide the static poster once video plays (fixes beach ghosting)
   and dip to black between montage scenes so cuts feel intentional. No re-encode needed. */
(function () {
  if (window.__turesTravelBg) return;
  window.__turesTravelBg = true;

  var SCENES = 6;
  var DIP_MS = 720;

  function wire(root) {
    if (!root || root.__travelWired) return;
    var video = root.querySelector("video");
    if (!video) return;
    root.__travelWired = true;

    var vfade = document.createElement("div");
    vfade.className = "travel-vfade";
    vfade.setAttribute("aria-hidden", "true");
    root.appendChild(vfade);

    function markReady() {
      root.classList.add("vid-ready");
    }
    video.addEventListener("playing", markReady, { once: true });
    video.addEventListener("canplaythrough", markReady, { once: true });
    if (video.readyState >= 3) markReady();

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    var lastScene = -1;
    var dipping = false;

    function dip() {
      if (dipping) return;
      dipping = true;
      vfade.classList.add("on");
      setTimeout(function () {
        vfade.classList.remove("on");
        dipping = false;
      }, DIP_MS);
    }

    video.addEventListener("timeupdate", function () {
      if (!video.duration || video.duration < 2) return;
      var sceneLen = video.duration / SCENES;
      var scene = Math.min(SCENES - 1, Math.floor(video.currentTime / sceneLen));
      if (lastScene >= 0 && scene !== lastScene) dip();
      lastScene = scene;
    });

    video.addEventListener("seeked", function () {
      lastScene = -1;
    });
  }

  window.turesWireTravelBg = function (root) {
    if (root) wire(root);
    else {
      [].slice.call(document.querySelectorAll(".px-bg-inner, .v11-travel-bg, .hb-bg, .bg")).forEach(wire);
    }
  };

  function boot() {
    window.turesWireTravelBg();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
