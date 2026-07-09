/* Travel backdrop — one live video layer only (no stacked posters).
   Removes static poster images + the video poster attribute so the beach JPG
   cannot bleed through. No scene dips — footage plays continuously. */
(function () {
  if (window.__turesTravelBg) return;
  window.__turesTravelBg = true;

  function killPosters(root, video) {
    try { video.removeAttribute("poster"); } catch (_) {}
    [].slice.call(root.querySelectorAll(".px-poster, .v11-travel-poster, .hb-poster, .poster")).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function wire(root) {
    if (!root || root.__travelWired) return;
    var video = root.querySelector("video");
    if (!video) return;
    root.__travelWired = true;
    root.style.background = "#0a0c10";

    function markReady() {
      killPosters(root, video);
      root.classList.add("vid-ready");
    }
    video.addEventListener("playing", markReady, { once: true });
    video.addEventListener("canplay", markReady, { once: true });
    if (video.readyState >= 2) markReady();
  }

  window.turesWireTravelBg = function (root) {
    if (root) wire(root);
    else {
      [].slice.call(document.querySelectorAll(".px-bg-inner, .v11-travel-bg, .hb-bg, .bg")).forEach(wire);
    }
  };

  function boot() {
    if (window.turesApplyTravelVideoPref) window.turesApplyTravelVideoPref();
    if (document.documentElement.classList.contains("travel-video-off")) return;
    window.turesWireTravelBg();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
