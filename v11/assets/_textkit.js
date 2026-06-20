/* ============================================================
   TURES — Text kit  (experiment-only, landing page)
   A floating panel to audition heading/body FONTS and SIZES live,
   the way the palette kit auditions colors. Loads Google Fonts on
   demand; persists per-page in localStorage; Reset restores.
   Self-contained, vanilla JS. Safe to delete before launch.
   ============================================================ */
(function () {
  if (window.__turesTextkit) return; window.__turesTextkit = true;
  var KEY = "tures.textkit:" + location.pathname;

  // family -> Google Fonts axis string (kept conservative so the request never 400s)
  var SERIF = {
    "Playfair Display": "wght@400;500;600;700",
    "Fraunces": "wght@400;500;600;700",
    "Cormorant Garamond": "wght@400;500;600;700",
    "DM Serif Display": "",
    "Libre Baskerville": "wght@400;700",
    "Bodoni Moda": "wght@400;500;600;700",
    "Spectral": "wght@400;500;600;700",
    "Lora": "wght@400;500;600;700"
  };
  var SANS = {
    "DM Sans": "wght@300;400;500;600",
    "Inter": "wght@300;400;500;600;700",
    "Manrope": "wght@400;500;600;700",
    "Work Sans": "wght@300;400;500;600",
    "Figtree": "wght@400;500;600;700",
    "Albert Sans": "wght@400;500;600"
  };
  var PAIRS = [
    { n: "Playfair · DM Sans",    s: "Playfair Display",   b: "DM Sans" },
    { n: "Fraunces · Inter",      s: "Fraunces",           b: "Inter" },
    { n: "Cormorant · Work Sans", s: "Cormorant Garamond", b: "Work Sans" },
    { n: "Bodoni · Manrope",      s: "Bodoni Moda",        b: "Manrope" },
    { n: "DM Serif · DM Sans",    s: "DM Serif Display",   b: "DM Sans" },
    { n: "Baskerville · Figtree", s: "Libre Baskerville",  b: "Figtree" },
    { n: "Spectral · Albert",     s: "Spectral",           b: "Albert Sans" },
    { n: "Lora · Inter",          s: "Lora",               b: "Inter" }
  ];

  var DEF = { serif: "Playfair Display", sans: "DM Sans", head: 1, body: 1 };
  var state = Object.assign({}, DEF);
  try { var s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) state = Object.assign({}, DEF, s); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---- load fonts on demand ---- */
  var loaded = {};
  function loadFont(fam) {
    if (loaded[fam]) return;
    var axis = (SERIF[fam] != null ? SERIF[fam] : SANS[fam]) || "";
    var href = "https://fonts.googleapis.com/css2?family=" + fam.replace(/ /g, "+") + (axis ? ":" + axis : "") + "&display=swap";
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
    loaded[fam] = true;
  }

  /* ---- capture base sizes once (so scaling is reversible) ---- */
  var headEls = [], bodyEls = [];
  function inChrome(el) { return el.closest(".v11-nav") || el.closest(".v11-foot") || el.closest("#tk"); }
  function collect() {
    // tag every serif (Playfair/Georgia) element outside the shared chrome for the font swap,
    // and record base size on the text-bearing leaves so size scaling stays reversible
    Array.prototype.forEach.call(document.querySelectorAll("body *"), function (el) {
      if (inChrome(el)) return;
      if (!/Playfair|Georgia/i.test(getComputedStyle(el).fontFamily || "")) return;
      el.classList.add("tk-h");
      if (el.children.length === 0 && el.textContent && el.textContent.trim()) headEls.push([el, parseFloat(getComputedStyle(el).fontSize)]);
    });
    var bodySel = "main p, .lead, .arc-hero .sub, .arc-note, .stat .v, .card p, .ao-lead, .arc-hero .b, .reassure span";
    Array.prototype.forEach.call(document.querySelectorAll(bodySel), function (el) {
      if (inChrome(el)) return; bodyEls.push([el, parseFloat(getComputedStyle(el).fontSize)]);
    });
  }

  var styleEl;
  function apply() {
    loadFont(state.serif); loadFont(state.sans);
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "tk-style"; document.head.appendChild(styleEl); }
    styleEl.textContent =
      'body,button,input,textarea,select,.btn,.field,.hero-q{font-family:"' + state.sans + '",system-ui,sans-serif}' +
      '.tk-h{font-family:"' + state.serif + '",Georgia,serif !important}';
    headEls.forEach(function (p) { p[0].style.fontSize = (p[1] * state.head).toFixed(2) + "px"; });
    bodyEls.forEach(function (p) { p[0].style.fontSize = (p[1] * state.body).toFixed(2) + "px"; });
  }

  /* ---- panel ---- */
  function build() {
    var css = document.createElement("style");
    css.textContent =
      '#tk,#tk *{box-sizing:border-box;font-family:"DM Sans",system-ui,sans-serif}' +
      '#tk{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:286px;max-height:84vh;overflow:auto;background:#0d0f12;color:#eee;border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.6);font-size:12px}' +
      '#tk.min{width:auto;overflow:visible}' +
      '#tk .hd{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.1);position:sticky;top:0;background:#0d0f12;border-radius:14px 14px 0 0}' +
      '#tk.min .hd{border-bottom:none}#tk .hd b{font-weight:600}#tk .hd .sp{color:#ff7a5c}#tk .hd .car{margin-left:auto;opacity:.6}' +
      '#tk .bd{padding:13px;display:flex;flex-direction:column;gap:15px}#tk.min .bd{display:none}' +
      '#tk h4{margin:0 0 8px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9aa;font-weight:600}' +
      '#tk .pairs{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
      '#tk .pair{border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 8px;cursor:pointer;background:#111418;font-size:11px;line-height:1.2}' +
      '#tk .pair:hover{border-color:#ff7a5c}' +
      '#tk select{width:100%;padding:8px;border:1px solid rgba(255,255,255,.16);background:#15191e;color:#eee;border-radius:8px;font-size:12px}' +
      '#tk .row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}#tk label{color:#bcc;font-size:11px}' +
      '#tk input[type=range]{width:100%;accent-color:#ff4929}' +
      '#tk .val{font-family:"Space Mono",monospace;font-size:11px;color:#cdd;min-width:34px;text-align:right}' +
      '#tk button.bt{flex:1;padding:8px;border:1px solid rgba(255,255,255,.16);background:#15191e;color:#eee;border-radius:8px;cursor:pointer;font-size:11px}#tk button.bt:hover{border-color:#ff7a5c}' +
      '#tk .br{display:flex;gap:7px}#tk .hint{font-size:10px;color:#788;line-height:1.45}';
    document.head.appendChild(css);

    var p = document.createElement("div"); p.id = "tk"; p.className = "min";
    p.innerHTML =
      '<div class="hd" id="tk-hd"><b>t<span class="sp">✦</span></b><b>Text kit</b><span class="car" id="tk-car">▴</span></div>' +
      '<div class="bd">' +
      '<div><h4>Pairings</h4><div class="pairs">' +
        PAIRS.map(function (pr, i) { return '<div class="pair" data-i="' + i + '">' + pr.n + '</div>'; }).join("") +
      '</div></div>' +
      '<div><h4>Heading font</h4><select id="tk-serif">' + Object.keys(SERIF).map(function (f) { return '<option>' + f + '</option>'; }).join("") + '</select>' +
        '<div class="row"><label>Heading size</label><span class="val" id="tk-hv"></span></div><input type="range" id="tk-hs" min="0.8" max="1.45" step="0.01"></div>' +
      '<div><h4>Body font</h4><select id="tk-sans">' + Object.keys(SANS).map(function (f) { return '<option>' + f + '</option>'; }).join("") + '</select>' +
        '<div class="row"><label>Body size</label><span class="val" id="tk-bv"></span></div><input type="range" id="tk-bs" min="0.85" max="1.25" step="0.01"></div>' +
      '<div class="br"><button class="bt" id="tk-reset">Reset</button><button class="bt" id="tk-copy">Copy</button></div>' +
      '<p class="hint">Landing-only experiment. Heading = serif elements; body = the copy. Saved for this page.</p>' +
      '</div>';
    document.body.appendChild(p);

    var serifSel = document.getElementById("tk-serif"), sansSel = document.getElementById("tk-sans");
    var hs = document.getElementById("tk-hs"), bs = document.getElementById("tk-bs");
    var hv = document.getElementById("tk-hv"), bv = document.getElementById("tk-bv");
    function sync() { serifSel.value = state.serif; sansSel.value = state.sans; hs.value = state.head; bs.value = state.body; hv.textContent = Math.round(state.head * 100) + "%"; bv.textContent = Math.round(state.body * 100) + "%"; }
    sync();
    document.getElementById("tk-hd").addEventListener("click", function () { var m = p.classList.toggle("min"); document.getElementById("tk-car").textContent = m ? "▴" : "▾"; });
    Array.prototype.forEach.call(p.querySelectorAll(".pair"), function (el) {
      el.addEventListener("click", function () { var pr = PAIRS[+el.dataset.i]; state.serif = pr.s; state.sans = pr.b; loadFont(pr.s); loadFont(pr.b); sync(); apply(); save(); });
    });
    serifSel.addEventListener("change", function () { state.serif = serifSel.value; apply(); save(); });
    sansSel.addEventListener("change", function () { state.sans = sansSel.value; apply(); save(); });
    hs.addEventListener("input", function () { state.head = +hs.value; hv.textContent = Math.round(state.head * 100) + "%"; apply(); save(); });
    bs.addEventListener("input", function () { state.body = +bs.value; bv.textContent = Math.round(state.body * 100) + "%"; apply(); save(); });
    document.getElementById("tk-reset").addEventListener("click", function () { state = Object.assign({}, DEF); try { localStorage.removeItem(KEY); } catch (e) {} headEls.forEach(function (x) { x[0].style.fontSize = ""; }); bodyEls.forEach(function (x) { x[0].style.fontSize = ""; }); sync(); apply(); });
    document.getElementById("tk-copy").addEventListener("click", function () {
      var t = "heading " + state.serif + " @ " + Math.round(state.head * 100) + "% · body " + state.sans + " @ " + Math.round(state.body * 100) + "%";
      try { navigator.clipboard.writeText(t); } catch (e) {} var b = document.getElementById("tk-copy"); var o = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = o; }, 1500);
    });
  }

  function start() { collect(); build(); apply(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
