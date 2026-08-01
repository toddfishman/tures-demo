/* Bring your trip — multi-step Concierge Mode import flow. */
(function () {
  if (window.__turesBytFlow) return;
  window.__turesBytFlow = true;

  var state = { step: 1, booking: null, gaps: 0, feeUsd: 99, via: "", assumptions: [], editIdx: null, files: [] };

  var steps = ["intake", "parse", "review", "fix", "pay", "done"];
  var panels = {};

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function confClass(c) {
    if (c === "high") return "high";
    if (c === "low") return "low";
    return "med";
  }

  function confLabel(c) {
    if (c === "high") return "High";
    if (c === "low") return "Needs you";
    return "Medium";
  }

  function showStep(n) {
    state.step = n;
    steps.forEach(function (s, i) {
      var el = panels[s];
      if (el) el.hidden = i + 1 !== n;
    });
    var prog = $("byt-progress");
    if (prog) {
      prog.querySelectorAll("span").forEach(function (sp, i) {
        sp.classList.remove("cur", "done");
        if (i + 1 < n) sp.classList.add("done");
        if (i + 1 === n) sp.classList.add("cur");
      });
    }
    window.scrollTo({ top: panels[steps[n - 1]] ? panels[steps[n - 1]].offsetTop - 80 : 0, behavior: "smooth" });
  }

  function legsFromBooking(b) {
    return (b.components || []).map(function (c) {
      return {
        kind: c.kind,
        title: c.title,
        supplier: c.supplier,
        detail: c.importMeta && c.importMeta.detail,
        confirmation: c.confirmation,
        confidence: (c.importMeta && c.importMeta.confidence) || "medium",
        sourceHint: c.importMeta && c.importMeta.sourceHint,
        schedule: c.importMeta && c.importMeta.schedule,
        amountUsd: c.amountUsd,
      };
    });
  }

  function renderReview() {
    var b = state.booking;
    if (!b) return;
    var dest = b.brief && b.brief.destination ? b.brief.destination : "Trip";
    $("byt-review-title").textContent = dest;
    $("byt-review-meta").textContent =
      (b.brief.origin || "?") + " ⇄ " + (b.brief.destination || "?") +
      " · " + (b.brief.departDate || "") +
      (b.brief.returnDate ? " – " + b.brief.returnDate : "");

    var gapEl = $("byt-review-gaps");
    if (state.gaps > 0) {
      gapEl.innerHTML = "<b style=\"color:var(--warn)\">" + state.gaps + " gap" + (state.gaps > 1 ? "s" : "") + "</b> needs you";
    } else {
      gapEl.textContent = "All legs look good";
    }

    var groups = { flight: [], stay: [], dining: [], activity: [], transport: [] };
    (b.components || []).forEach(function (c, i) {
      groups[c.kind] = groups[c.kind] || [];
      groups[c.kind].push({ c: c, i: i });
    });

    var html = "";
    var labels = { flight: "Flights", stay: "Lodging", dining: "Reservations", activity: "Activities", transport: "Transport" };
    Object.keys(labels).forEach(function (kind) {
      var items = groups[kind];
      if (!items || !items.length) return;
      html += "<p class=\"byt-cat\">" + labels[kind] + "</p>";
      items.forEach(function (row) {
        var c = row.c;
        var conf = (c.importMeta && c.importMeta.confidence) || "medium";
        var warn = conf === "low" || ((kind === "flight" || kind === "stay") && !c.confirmation);
        html += "<div class=\"leg" + (warn ? " warn" : "") + "\" data-idx=\"" + row.i + "\">" +
          "<span class=\"conf-dot\"></span><div style=\"flex:1;min-width:0\">" +
          "<div class=\"lb\">" + esc(c.title) + " <span class=\"conf-pill " + confClass(conf) + "\">" + confLabel(conf) + "</span></div>" +
          (c.importMeta && c.importMeta.detail ? "<div class=\"sub\">" + esc(c.importMeta.detail) + "</div>" : "") +
          "<div class=\"meta\">" +
          (c.confirmation ? "<span class=\"mono\">Conf · " + esc(c.confirmation) + "</span>" : "") +
          (c.importMeta && c.importMeta.sourceHint ? "<span>" + esc(c.importMeta.sourceHint) + "</span>" : "") +
          "</div>" +
          (warn ? "<button type=\"button\" class=\"fix byt-fix-leg\" data-idx=\"" + row.i + "\">Fix this leg →</button>" : "") +
          "</div>" +
          (c.importMeta && c.importMeta.schedule ? "<div class=\"side\">" + esc(c.importMeta.schedule) + "</div>" : "") +
          "</div>";
      });
    });
    $("byt-legs").innerHTML = html;
    document.querySelectorAll(".byt-fix-leg").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openFix(Number(btn.getAttribute("data-idx")));
      });
    });
  }

  function openFix(idx) {
    state.editIdx = idx;
    var c = state.booking.components[idx];
    if (!c) return;
    $("byt-fix-title").innerHTML = "Fix <em>" + esc(c.title.split("·")[0].trim()) + "</em>";
    $("byt-fix-venue").value = c.title;
    $("byt-fix-conf").value = c.confirmation || "";
    $("byt-fix-detail").value = (c.importMeta && c.importMeta.detail) || "";
    $("byt-fix-schedule").value = (c.importMeta && c.importMeta.schedule) || "";
    showStep(4);
  }

  function renderPay() {
    var b = state.booking;
    var fee = state.feeUsd;
    $("byt-pay-trip").textContent = (b.brief.destination || "Trip") + " · " + (b.components || []).length + " legs · Imported";
    $("byt-pay-fee-row").style.display = fee > 0 ? "" : "none";
    $("byt-pay-fee").textContent = "$" + fee.toFixed(2);
    $("byt-pay-due").textContent = "$" + fee.toFixed(2);
    var btn = $("byt-pay-btn");
    if (fee > 0) {
      btn.textContent = "Pay $" + fee + " & start watching";
    } else {
      btn.textContent = "Activate watch — included";
    }
    var sub = $("byt-pay-sub");
    if (sub) sub.style.display = fee > 0 ? "none" : "";
  }

  function renderDone() {
    var b = state.booking;
    $("byt-done-title").innerHTML = (b.brief.destination || "Your trip") + " is <em>being watched.</em>";
    $("byt-done-link").href = "trips.html#" + (b.tripId || "");
  }

  function capUsd() {
    var sel = $("byt-watch-cap");
    return sel ? Number(sel.value) || 25 : 25;
  }

  function tripWatchBody() {
    var en = $("byt-watch-enable");
    return { tripWatch: { enabled: !en || en.checked, capUsd: capUsd() } };
  }

  function doImport(text) {
    showStep(2);
    var body = { text: text, heuristic: true, tripWatch: { enabled: true, capUsd: capUsd() } };
    return window.tures.importTrip(body).then(function (r) {
      state.booking = r.booking;
      state.gaps = r.gaps || 0;
      state.feeUsd = r.feeUsd != null ? r.feeUsd : 99;
      state.assumptions = r.assumptions || [];
      state.via = r.via || "";
      if (r.booking.status === "failed" && !(r.booking.components || []).length) {
        throw new Error((r.booking.violations || []).join("; ") || "import_failed");
      }
      renderReview();
      showStep(3);
    });
  }

  function saveFix() {
    var idx = state.editIdx;
    if (idx == null || !state.booking) return;
    var legs = legsFromBooking(state.booking);
    legs[idx].title = $("byt-fix-venue").value.trim() || legs[idx].title;
    legs[idx].confirmation = $("byt-fix-conf").value.trim() || undefined;
    legs[idx].detail = $("byt-fix-detail").value.trim() || undefined;
    legs[idx].schedule = $("byt-fix-schedule").value.trim() || undefined;
    if (legs[idx].confirmation) legs[idx].confidence = "high";
    $("byt-fix-save").textContent = "Saving…";
    return window.tures.updateImport(state.booking.id, { legs: legs }).then(function (r) {
      state.booking = r.booking;
      state.gaps = r.gaps || 0;
      state.editIdx = null;
      renderReview();
      showStep(3);
    }).finally(function () { $("byt-fix-save").textContent = "Save & continue"; });
  }

  function initPanels() {
    steps.forEach(function (s) {
      panels[s] = $("byt-step-" + s);
    });
  }

  function initDrop() {
    var drop = $("byt-drop"), inp = $("byt-files"), thumbs = $("byt-thumbs");
    if (!drop || !inp) return;
    function paint() {
      if (!thumbs) return;
      thumbs.innerHTML = "";
      if (!state.files.length) { thumbs.hidden = true; return; }
      thumbs.hidden = false;
      state.files.slice(0, 10).forEach(function (f) {
        var img = document.createElement("img");
        img.className = "th"; img.alt = f.name;
        if (f.type.indexOf("image/") === 0) img.src = URL.createObjectURL(f);
        else img.src = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><text x='4' y='16' font-size='8'>PDF</text></svg>");
        thumbs.appendChild(img);
      });
    }
    function add(list) {
      for (var i = 0; i < list.length && state.files.length < 10; i++) state.files.push(list[i]);
      paint();
    }
    drop.addEventListener("click", function () { inp.click(); });
    inp.addEventListener("change", function () { add(inp.files || []); inp.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault(); drop.classList.remove("drag");
        if (ev === "drop") add(e.dataTransfer.files || []);
      });
    });
  }

  function init() {
    initPanels();
    initDrop();
    showStep(1);

    $("byt-submit") && $("byt-submit").addEventListener("click", function () {
      var text = ($("byt-text") && $("byt-text").value || "").trim();
      if (!text && !state.files.length) {
        $("byt-hint").textContent = "Add some text or at least one file to continue.";
        return;
      }
      if (state.files.length && !text) {
        text = "Imported files: " + state.files.map(function (f) { return f.name; }).join(", ") +
          ". (Image OCR coming soon — paste confirmation details in the text box for now.)";
      }
      if (!(window.tures && window.tures.signedIn)) {
        try { localStorage.setItem("tures.byt.draft", JSON.stringify({ text: text, at: new Date().toISOString() })); } catch (_) {}
        location.href = "login.html?next=" + encodeURIComponent("bring-your-trip.html");
        return;
      }
      $("byt-submit").textContent = "Reading…";
      doImport(text).catch(function (err) {
        $("byt-hint").textContent = (err && err.message) || "Could not read your trip — try adding more detail.";
        showStep(1);
      }).finally(function () { $("byt-submit").textContent = "Continue — review what we understood"; });
    });

    $("byt-review-continue") && $("byt-review-continue").addEventListener("click", function () {
      renderPay();
      showStep(5);
    });
    $("byt-review-fix") && $("byt-review-fix").addEventListener("click", function () {
      var idx = (state.booking.components || []).findIndex(function (c) {
        var conf = c.importMeta && c.importMeta.confidence;
        return conf === "low" || ((c.kind === "flight" || c.kind === "stay") && !c.confirmation);
      });
      if (idx >= 0) openFix(idx);
      else showStep(4);
    });
    $("byt-fix-save") && $("byt-fix-save").addEventListener("click", saveFix);
    $("byt-fix-skip") && $("byt-fix-skip").addEventListener("click", function () {
      state.editIdx = null;
      renderReview();
      showStep(3);
    });
    $("byt-pay-btn") && $("byt-pay-btn").addEventListener("click", function () {
      var btn = $("byt-pay-btn");
      btn.textContent = "Activating…";
      window.tures.confirmImport(state.booking.id, tripWatchBody()).then(function (r) {
        if (r.booking.status === "failed") throw new Error((r.booking.violations || []).join("; "));
        state.booking = r.booking;
        renderDone();
        showStep(6);
      }).catch(function (err) {
        $("byt-pay-err").textContent = (err && err.message) || "Could not activate — connect a card in the Vault?";
        renderPay();
      }).finally(function () { renderPay(); });
    });

    try {
      var draft = JSON.parse(localStorage.getItem("tures.byt.draft") || "null");
      if (draft && draft.text && $("byt-text") && !$("byt-text").value) $("byt-text").value = draft.text;
    } catch (_) {}

    if (window.tures && window.tures.signedIn && window.tures.me) {
      window.tures.me().then(function (u) {
        if (u && u.plan === "subscribe") state.feeUsd = 0;
      }).catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
