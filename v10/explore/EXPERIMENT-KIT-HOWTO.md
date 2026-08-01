# Experiment Kit — build instructions for another chat

Hand this whole file to another Claude Code session. It rebuilds the **live palette + image experiment toolkit**: a collapsible floating panel that lets you retune background / accent / text colors across every page in real time (12 presets + custom color pickers), drop in images (file or URL) you can drag/resize/layer, and it persists per-page in `localStorage`. It is a single self-contained file plus a one-line `<script>` tag per page. Nothing ships to production — it's a dev-only overlay.

---

## Step 1 — Create the toolkit file

Create a file named **`_devkit.js`** in the folder that holds the HTML pages (e.g. alongside the mockups). Paste this **verbatim**:

```js
/* ============================================================
   Explore Dev Toolkit  (experiment-only, not shipped)
   Floating panel to:
     • retune palette live (background / accent / text + presets)
     • drop in images (file or URL), drag / resize / layer / delete
   All changes persist per-page in localStorage; Reset clears them.
   Self-contained, vanilla JS. Safe to delete from the real site.
   ============================================================ */
(function () {
  if (window.__turesDevkit) return;
  window.__turesDevkit = true;

  var KEY = "tures.devkit:" + location.pathname;

  /* ---------- color math ---------- */
  function hex2rgb(h) {
    h = (h || "").trim().replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgb2hex(c) {
    function p(v) { v = Math.round(Math.max(0, Math.min(255, v))); return ("0" + v.toString(16)).slice(-2); }
    return "#" + p(c.r) + p(c.g) + p(c.b);
  }
  function mix(a, b, t) { // a,b hex; t 0..1 toward b
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }
  function rgba(h, a) { var c = hex2rgb(h); return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }

  /* ---------- presets ---------- */
  var PRESETS = [
    { n: "Obsidian · Gold",     bg: "#0A0C0F", acc: "#E6C873", tx: "#F2EEE4" },
    { n: "Centurion · Brass",   bg: "#0B0B0D", acc: "#C9A24A", tx: "#EDE9E0" },
    { n: "Deep Space · Teal",   bg: "#05080F", acc: "#5EEAD4", tx: "#EAF1F5" },
    { n: "Launch · Mint",       bg: "#06080A", acc: "#2DD4BF", tx: "#F4F1EA" },
    { n: "Ink · Electric Blue", bg: "#080A12", acc: "#5B8DEF", tx: "#EAEEF6" },
    { n: "Forest · Lime",       bg: "#07120C", acc: "#7BE08A", tx: "#EAF3EC" },
    { n: "Aubergine · Coral",   bg: "#140A12", acc: "#FF8C6B", tx: "#F4E9E6" },
    { n: "Plum · Rose",         bg: "#120912", acc: "#F0A6C8", tx: "#F3E9EF" },
    { n: "Charcoal · Amber",    bg: "#100D0A", acc: "#F5A623", tx: "#F4EFE6" },
    { n: "Slate · Ice",         bg: "#0C0F13", acc: "#9FD3FF", tx: "#EAF1F7" },
    { n: "Bone · Espresso",     bg: "#ECE7DB", acc: "#6B4E2E", tx: "#2A241C" },
    { n: "Porcelain · Pine",    bg: "#F4F1EA", acc: "#1F6F6B", tx: "#1A1A1A" }
  ];

  /* ---------- state ---------- */
  var state = { palette: null, images: [] };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved) state = saved; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast("Storage full — changes kept for this session only"); } }

  /* ---------- palette engine ----------
     Reads three inputs (bg / accent / text) and writes a whole token family.
     IMPORTANT: it writes to EVERY candidate variable name a page might use.
     If the target project uses other --var names, add them here. See HOWTO Step 3. */
  function applyPalette(p) {
    if (!p) return;
    var root = document.documentElement.style;
    var bg = p.bg, acc = p.acc, tx = p.tx;
    // backgrounds (all candidate names)
    root.setProperty("--bg", bg); root.setProperty("--canvas", bg); root.setProperty("--space", bg);
    root.setProperty("--bg-2", mix(bg, tx, .04)); root.setProperty("--canvas-2", mix(bg, tx, .04)); root.setProperty("--space-2", mix(bg, tx, .05));
    // layered surfaces (mix toward text so it works on dark OR light)
    root.setProperty("--surface", mix(bg, tx, .05));
    root.setProperty("--surface-2", mix(bg, tx, .09));
    root.setProperty("--surface-3", mix(bg, tx, .13));
    root.setProperty("--bubble-ai", mix(bg, tx, .06));
    root.setProperty("--bubble-me", mix(bg, tx, .12));
    root.setProperty("--card", rgba(tx, .03));
    root.setProperty("--card-edge", rgba(tx, .08));
    root.setProperty("--hair", rgba(tx, .06));
    // accent family
    root.setProperty("--acc", acc);
    root.setProperty("--acc-2", mix(acc, "#ffffff", .25));
    root.setProperty("--acc-light", mix(acc, "#ffffff", .25));
    root.setProperty("--acc-soft", mix(acc, "#ffffff", .18));
    root.setProperty("--acc-deep", mix(acc, "#000000", .30));
    root.setProperty("--acc-dim", rgba(acc, .14));
    root.setProperty("--acc-glow", rgba(acc, .18));
    // text
    root.setProperty("--text", tx); root.setProperty("--ink", tx); root.setProperty("--cream", tx);
    root.setProperty("--muted", mix(tx, bg, .42)); root.setProperty("--ink-soft", mix(tx, bg, .42)); root.setProperty("--ink-dim", mix(tx, bg, .42)); root.setProperty("--dim", mix(tx, bg, .42));
    root.setProperty("--faint", mix(tx, bg, .62)); root.setProperty("--ink-faint", mix(tx, bg, .62)); root.setProperty("--ink-mute", mix(tx, bg, .62));
    // hairlines (text-alpha → bg-agnostic)
    root.setProperty("--line", rgba(tx, .10)); root.setProperty("--line-2", rgba(tx, .16)); root.setProperty("--line-soft", rgba(tx, .055));
    // keep the page's own canvas color in sync even if it used a literal
    document.documentElement.style.background = bg;
  }

  /* ---------- image layer ---------- */
  var sel = null;
  function uid() { return "i" + (state.images.length + 1) + "-" + Math.round(performance.now()); }

  function renderImages() {
    Array.prototype.slice.call(document.querySelectorAll(".dvk-img")).forEach(function (n) { n.remove(); });
    document.documentElement.classList.toggle("dvk-has-bg", state.images.some(function (im) { return im.backdrop; }));
    state.images.forEach(function (im) {
      var w = document.createElement("div");
      w.className = "dvk-img dvk-node" + (im.backdrop ? " backdrop" : "") + (im.id === sel ? " sel" : "");
      w.dataset.id = im.id;
      if (im.backdrop) {
        w.style.cssText = "position:fixed;inset:0;z-index:-1;";
        w.innerHTML = '<img src="' + im.src + '" style="width:100%;height:100%;object-fit:cover;opacity:' + (im.op != null ? im.op : .5) + '">' +
          '<div class="dvk-img-bar"><button data-a="front" title="Bring to front">▦</button><button data-a="op">opacity ' + Math.round((im.op != null ? im.op : .5) * 100) + '%</button><button data-a="del" title="Remove">✕</button></div>';
      } else {
        w.style.cssText = "position:fixed;left:" + (im.x || 80) + "px;top:" + (im.y || 120) + "px;width:" + (im.w || 280) + "px;z-index:" + (2147482000 + (im.id === sel ? 500 : 0)) + ";";
        w.innerHTML = '<img src="' + im.src + '" style="width:100%;height:auto;display:block;border-radius:6px;">' +
          '<div class="dvk-img-bar"><button data-a="back" title="Send behind text (backdrop)">⤓ backdrop</button><button data-a="del" title="Delete">✕</button></div>' +
          '<div class="dvk-img-h" title="Drag to resize"></div>';
      }
      document.body.appendChild(w);
      wireImage(w, im);
    });
  }

  function wireImage(w, im) {
    var img = w.querySelector("img");
    w.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".dvk-img-bar") || e.target.classList.contains("dvk-img-h")) return;
      if (im.backdrop) { select(im.id); return; }
      select(im.id);
      var sx = e.clientX, sy = e.clientY, ox = im.x || 80, oy = im.y || 120;
      function mv(ev) { im.x = ox + (ev.clientX - sx); im.y = oy + (ev.clientY - sy); w.style.left = im.x + "px"; w.style.top = im.y + "px"; }
      function up() { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); save(); }
      document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
      e.preventDefault();
    });
    var h = w.querySelector(".dvk-img-h");
    if (h) h.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      var sx = e.clientX, ow = im.w || 280;
      function mv(ev) { im.w = Math.max(60, ow + (ev.clientX - sx)); w.style.width = im.w + "px"; }
      function up() { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); save(); }
      document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
      e.preventDefault();
    });
    w.querySelector(".dvk-img-bar").addEventListener("click", function (e) {
      var a = e.target.dataset.a; if (!a) return;
      if (a === "del") { state.images = state.images.filter(function (x) { return x.id !== im.id; }); save(); renderImages(); }
      else if (a === "back") { im.backdrop = true; save(); renderImages(); }
      else if (a === "front") { im.backdrop = false; im.x = im.x || 80; im.y = im.y || 120; im.w = im.w || 420; save(); renderImages(); }
      else if (a === "op") { im.op = (im.op == null ? .5 : im.op) + .15; if (im.op > .9) im.op = .15; save(); renderImages(); }
    });
  }
  function select(id) { sel = id; renderImages(); }
  document.addEventListener("pointerdown", function (e) { if (!e.target.closest(".dvk-img") && !e.target.closest("#dvk")) { if (sel) { sel = null; renderImages(); } } });

  function addImage(src) {
    state.images.push({ id: uid(), src: src, x: Math.round(innerWidth / 2 - 160), y: Math.round(innerHeight / 2 - 120), w: 320, backdrop: false });
    save(); renderImages();
  }

  /* ---------- panel ---------- */
  function buildPanel() {
    var css = document.createElement("style");
    css.textContent =
      '#dvk,#dvk *{box-sizing:border-box;font-family:"DM Sans",system-ui,sans-serif;}' +
      '#dvk{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;max-height:82vh;overflow:auto;background:#0d0f12;color:#eee;border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.6);font-size:12px;}' +
      '#dvk.min{width:auto;max-height:none;overflow:visible;}' +
      '#dvk .hd{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.10);position:sticky;top:0;background:#0d0f12;border-radius:14px 14px 0 0;}' +
      '#dvk.min .hd{border-bottom:none;}' +
      '#dvk .hd b{font-weight:600;letter-spacing:.02em;}#dvk .hd .sp{color:#E6C873;}#dvk .hd .car{margin-left:auto;opacity:.6;}' +
      '#dvk .bd{padding:13px;display:flex;flex-direction:column;gap:16px;}#dvk.min .bd{display:none;}' +
      '#dvk h4{margin:0 0 8px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9aa;font-weight:600;}' +
      '#dvk .swrap{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}' +
      '#dvk .sw{display:flex;align-items:center;gap:7px;padding:6px 7px;border:1px solid rgba(255,255,255,.12);border-radius:8px;cursor:pointer;background:#111418;transition:border-color .15s;}' +
      '#dvk .sw:hover{border-color:#E6C873;}#dvk .sw .dot{width:13px;height:13px;border-radius:50%;flex:0 0 auto;border:1px solid rgba(255,255,255,.25);}#dvk .sw span{font-size:10.5px;color:#cdd;line-height:1.1;}' +
      '#dvk .pk{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;}' +
      '#dvk .pk label{color:#bcc;}#dvk .pk input[type=color]{width:42px;height:26px;border:1px solid rgba(255,255,255,.2);border-radius:6px;background:none;cursor:pointer;padding:0;}' +
      '#dvk .row{display:flex;gap:7px;}' +
      '#dvk button.btn{flex:1;padding:8px;border:1px solid rgba(255,255,255,.16);background:#15191e;color:#eee;border-radius:8px;cursor:pointer;font-size:11px;transition:border-color .15s,background .15s;}' +
      '#dvk button.btn:hover{border-color:#E6C873;}#dvk button.btn.acc{background:#E6C873;color:#1a1305;border-color:#E6C873;font-weight:600;}' +
      '#dvk input[type=text]{flex:1;min-width:0;padding:8px;border:1px solid rgba(255,255,255,.16);background:#15191e;color:#eee;border-radius:8px;font-size:11px;}' +
      '#dvk .hint{font-size:10px;color:#788;line-height:1.45;}' +
      '.dvk-img{outline:0;}.dvk-img.sel:not(.backdrop){outline:2px solid #E6C873;outline-offset:2px;}' +
      '.dvk-img .dvk-img-bar{position:absolute;left:0;top:-30px;display:none;gap:4px;}' +
      '.dvk-img.sel .dvk-img-bar{display:flex;}' +
      '.dvk-img.backdrop .dvk-img-bar{top:auto;bottom:14px;left:14px;}.dvk-img.backdrop.sel .dvk-img-bar{display:flex;}' +
      '.dvk-img .dvk-img-bar button{font-size:10px;padding:4px 7px;border:1px solid rgba(255,255,255,.25);background:rgba(13,15,18,.92);color:#eee;border-radius:6px;cursor:pointer;backdrop-filter:blur(6px);}' +
      '.dvk-img .dvk-img-bar button:hover{border-color:#E6C873;}' +
      '.dvk-img .dvk-img-h{position:absolute;right:-6px;bottom:-6px;width:16px;height:16px;border-radius:50%;background:#E6C873;border:2px solid #0d0f12;cursor:nwse-resize;display:none;}' +
      '.dvk-img.sel .dvk-img-h{display:block;}' +
      '#dvk-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483647;background:#15191e;color:#eee;border:1px solid rgba(255,255,255,.2);padding:9px 15px;border-radius:8px;font:12px "DM Sans",sans-serif;opacity:0;transition:opacity .25s;pointer-events:none;}' +
      '#dvk-toast.on{opacity:1;}';
    document.head.appendChild(css);

    var p = document.createElement("div");
    p.id = "dvk"; p.className = "dvk-node min";
    var swatches = PRESETS.map(function (pr) {
      return '<div class="sw" data-bg="' + pr.bg + '" data-acc="' + pr.acc + '" data-tx="' + pr.tx + '">' +
        '<span class="dot" style="background:' + pr.acc + ';box-shadow:-7px 0 0 -2px ' + pr.bg + ',-7px 0 0 -1px rgba(255,255,255,.2);"></span><span>' + pr.n + '</span></div>';
    }).join("");
    var cur = state.palette || { bg: "#0A0C0F", acc: "#E6C873", tx: "#F2EEE4" };
    p.innerHTML =
      '<div class="hd" id="dvk-hd"><b>t<span class="sp">✦</span></b><b>Experiment kit</b><span class="car" id="dvk-car">▴</span></div>' +
      '<div class="bd">' +
      '<div><h4>Palette presets</h4><div class="swrap">' + swatches + '</div></div>' +
      '<div><h4>Custom colors</h4>' +
      '<div class="pk"><label>Background</label><input type="color" id="dvk-bg" value="' + cur.bg + '"></div>' +
      '<div class="pk"><label>Accent</label><input type="color" id="dvk-acc" value="' + cur.acc + '"></div>' +
      '<div class="pk"><label>Text</label><input type="color" id="dvk-tx" value="' + cur.tx + '"></div>' +
      '</div>' +
      '<div><h4>Images</h4>' +
      '<div class="row" style="margin-bottom:7px;"><button class="btn acc" id="dvk-file">Add image from file</button></div>' +
      '<div class="row"><input type="text" id="dvk-url" placeholder="…or paste image URL"><button class="btn" id="dvk-addurl">Add</button></div>' +
      '<p class="hint" style="margin-top:7px;">Click an image to select · drag to move · gold handle resizes · “backdrop” sends it behind the text.</p>' +
      '</div>' +
      '<div class="row"><button class="btn" id="dvk-reset">Reset page</button><button class="btn" id="dvk-copy">Copy palette</button></div>' +
      '<p class="hint">Experiment-only overlay. Nothing here ships to the live site. Changes are saved for this page on this browser.</p>' +
      '</div>' +
      '<input type="file" accept="image/*" id="dvk-fileinput" style="display:none;">';
    document.body.appendChild(p);

    document.getElementById("dvk-hd").addEventListener("click", function () {
      var min = p.classList.toggle("min");
      document.getElementById("dvk-car").textContent = min ? "▴" : "▾";
    });
    Array.prototype.forEach.call(p.querySelectorAll(".sw"), function (s) {
      s.addEventListener("click", function () {
        var pal = { bg: s.dataset.bg, acc: s.dataset.acc, tx: s.dataset.tx };
        state.palette = pal; applyPalette(pal); save();
        document.getElementById("dvk-bg").value = pal.bg; document.getElementById("dvk-acc").value = pal.acc; document.getElementById("dvk-tx").value = pal.tx;
      });
    });
    function pick() {
      var pal = { bg: document.getElementById("dvk-bg").value, acc: document.getElementById("dvk-acc").value, tx: document.getElementById("dvk-tx").value };
      state.palette = pal; applyPalette(pal); save();
    }
    ["dvk-bg", "dvk-acc", "dvk-tx"].forEach(function (id) { document.getElementById(id).addEventListener("input", pick); });
    var fi = document.getElementById("dvk-fileinput");
    document.getElementById("dvk-file").addEventListener("click", function () { fi.click(); });
    fi.addEventListener("change", function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { addImage(r.result); }; r.readAsDataURL(f); fi.value = "";
    });
    document.getElementById("dvk-addurl").addEventListener("click", function () {
      var u = document.getElementById("dvk-url").value.trim(); if (u) { addImage(u); document.getElementById("dvk-url").value = ""; }
    });
    document.getElementById("dvk-reset").addEventListener("click", function () {
      state = { palette: null, images: [] }; sel = null;
      try { localStorage.removeItem(KEY); } catch (e) {}
      location.reload();
    });
    document.getElementById("dvk-copy").addEventListener("click", function () {
      var pal = state.palette || cur;
      var t = "bg " + pal.bg + " · accent " + pal.acc + " · text " + pal.tx;
      try { navigator.clipboard.writeText(t); } catch (e) {}
      toast("Copied: " + t);
    });
  }

  var toastT;
  function toast(msg) {
    var el = document.getElementById("dvk-toast");
    if (!el) { el = document.createElement("div"); el.id = "dvk-toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("on"); }, 2200);
  }

  function start() {
    buildPanel();
    if (state.palette) applyPalette(state.palette);
    renderImages();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
```

---

## Step 2 — Inject the script into every page

Add this line right before the closing `</body>` tag of **each** HTML page (use a relative path if pages sit in subfolders):

```html
<script src="_devkit.js"></script>
```

Don't do it by hand — run one of these from the folder with the pages. Both are idempotent (skip files that already have it):

**bash / git-bash:**
```bash
for f in *.html; do
  grep -q "_devkit.js" "$f" || perl -0pi -e 's{</body>}{<script src="_devkit.js"></script>\n</body>}' "$f"
done
```

**PowerShell:**
```powershell
Get-ChildItem *.html | ForEach-Object {
  $c = Get-Content $_ -Raw
  if ($c -notmatch '_devkit\.js') {
    ($c -replace '</body>', "<script src=`"_devkit.js`"></script>`n</body>") | Set-Content $_ -Encoding utf8
  }
}
```

If a page has no `</body>` tag, just append the `<script>` line at the end of the file.

---

## Step 3 — Adapt the palette to the target project's CSS variables (the only real tuning)

The kit drives the page by setting **CSS custom properties** on `:root`. It already writes to a wide set of common names (`--bg`, `--canvas`, `--space`, `--surface`, `--acc`, `--text`, `--ink`, `--line`, etc.). For the recolor to be complete, those names must match what the pages actually use.

1. **Discover the names the project uses.** Search the stylesheets / `:root` blocks for color variable declarations:
   ```bash
   grep -rnoE -- "--[a-zA-Z][\w-]*\s*:\s*(#|rgb|hsl)" .  | sort -u
   ```
2. **Map them into `applyPalette()`** (in `_devkit.js`). For each variable, add a `root.setProperty("--yourname", value)` line in the right group:
   - **background base** → `bg`
   - **slightly raised surfaces / cards** → `mix(bg, tx, 0.05..0.13)` (mixes toward text, so it works on dark *and* light backgrounds)
   - **primary accent** → `acc`; lighter/darker accent variants → `mix(acc,"#ffffff",t)` / `mix(acc,"#000000",t)`; translucent accent → `rgba(acc, a)`
   - **body text** → `tx`; muted/faint text → `mix(tx, bg, 0.42..0.62)`
   - **hairlines / borders** → `rgba(tx, 0.05..0.16)` (bg-agnostic)
3. **If a page hardcodes colors** (literal hex instead of `var(--x)`), the kit can't reach them. Either (a) refactor that page to use variables, or (b) accept that one element won't recolor. The `document.documentElement.style.background = bg` line already covers the base page background even if it was a literal.
4. **Edit the `PRESETS` array** at the top to taste — each entry is just `{ n: "Name", bg, acc, tx }`.

That's it. Accent is the easy one (almost everything uses a single `--acc`-style token); backgrounds and text names vary most between projects, so focus your mapping there.

---

## Step 4 — Verify

Serve the folder (any static server) and open a page. You should see a collapsed **"t✦ Experiment kit"** tab at bottom-right. Then:

- Expand it; click a preset → background + accent + text should change across the whole page.
- Drag the custom color pickers → live retune.
- Add an image (file or URL) → it appears centered; click to select, drag to move, gold corner handle to resize, **backdrop** sends it behind the text.
- Reload → your last palette + images persist (per page).
- **Reset page** → clears that page back to original.

Quick headless sanity check (in devtools or an eval tool), confirms the engine drives the page:
```js
document.querySelector('#dvk .sw').click();
getComputedStyle(document.documentElement).getPropertyValue('--acc'); // should be a preset accent
```

**Note for automated previews:** screenshot tools on a *hidden* tab sometimes time out on pages with looping CSS animations. Verify via computed styles / DOM checks (as above) and judge the look on a real foreground tab.

---

## How it behaves (for reference)

- **Storage key:** `tures.devkit:<pathname>` in `localStorage` — separate per page. Rename the `KEY` prefix if you want a different namespace.
- **Persistence:** palette + placed images (positions, sizes, data URLs) are saved on every change. Large images can exceed the ~5MB quota; it falls back to session-only and toasts a warning.
- **Footprint:** one file + one `<script>` tag per page. To remove for production, delete `_devkit.js` and strip the script tags (reverse the Step 2 command).
- **No dependencies, no build step, vanilla JS.** The panel lives at a very high z-index; placed images sit above content, backdrop images at `z-index:-1`.
```
