/* My Trips — load real bookings from the engine when signed in. */
(function () {
  if (window.__turesTripsLive) return;
  window.__turesTripsLive = true;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function money(n) {
    return "$" + Number(n || 0).toLocaleString("en-US");
  }
  function initial(dest) {
    var d = String(dest || "T").trim();
    return d.charAt(0).toUpperCase() || "T";
  }
  function statusLabel(st) {
    if (st === "booked") return "Booked";
    if (st === "booking") return "Booking";
    if (st === "confirmation_required") return "Held";
    if (st === "failed") return "Failed";
    return st || "Trip";
  }
  function statusClass(st) {
    if (st === "booked") return "good";
    if (st === "confirmation_required") return "watch";
    return "info";
  }
  function fmtDates(brief) {
    if (!brief) return "";
    if (brief.departDate && brief.returnDate) return brief.departDate + " – " + brief.returnDate;
    if (brief.departDate) return "From " + brief.departDate;
    return "";
  }
  function route(brief) {
    if (!brief) return "";
    var o = brief.origin || "";
    var d = brief.destination || "";
    return o && d ? esc(o) + " ⇄ " + esc(d) : esc(d || o || "Trip");
  }

  function itemRow(c, simulated) {
    var tag = simulated ? ' <span class="demo-tag">Sample</span>' : "";
    var conf = c.confirmation ? '<span class="mono">' + esc(c.confirmation) + "</span>" : "";
    return '<div class="item"><span class="idot"></span><div class="ibody">' +
      '<div class="it1">' + esc(c.title || c.kind) + tag + "</div>" +
      '<div class="it2">' + esc(c.kind) + " · " + money(c.amountUsd) + "</div>" +
      (conf ? '<div class="iconf">' + conf + "</div>" : "") +
      "</div><div class="side">" + esc(c.status || "") + "</div></div>";
  }

  function renderDetail(bk) {
    var brief = bk.brief || {};
    var dest = brief.destination || "Trip";
    var sim = (bk.components || []).some(function (c) { return c.simulated; });
    var flights = [], stays = [], other = [];
    (bk.components || []).forEach(function (c) {
      if (c.kind === "flight") flights.push(c);
      else if (c.kind === "stay") stays.push(c);
      else other.push(c);
    });
    var id = "trip-" + bk.id;
    var html = '<section class="section tight" id="' + id + '" style="scroll-margin-top:var(--nav-h)">' +
      '<div class="wrap"><div class="detail-hero">' +
      '<div class="dh-initial">' + esc(initial(dest)) + "</div>" +
      '<div class="dh-t"><span class="tag" style="margin-bottom:10px">' + esc(statusLabel(bk.status)) + "</span>" +
      "<h2>" + esc(dest) + " · <em>your trip</em></h2>" +
      '<div class="dh-meta"><span class="mono">' + route(brief) + "</span>" +
      (fmtDates(brief) ? "<span>" + esc(fmtDates(brief)) + "</span>" : "") +
      "<span>" + money(bk.totalUsd) + " all in</span></div></div></div>";

    if (stays.length) {
      html += '<div class="cat" id="' + id + '-lodging"><div class="cat-h"><span class="cn">Lodging</span></div>';
      stays.forEach(function (c) { html += itemRow(c, sim); });
      html += "</div>";
    }
    if (flights.length) {
      html += '<div class="cat" id="' + id + '-flights"><div class="cat-h"><span class="cn">Flights &amp; transport</span></div>';
      flights.forEach(function (c) { html += itemRow(c, sim); });
      html += "</div>";
    }
    if (other.length) {
      html += '<div class="cat" id="' + id + '-more"><div class="cat-h"><span class="cn">More</span></div>';
      other.forEach(function (c) { html += itemRow(c, sim); });
      html += "</div>";
    }
    if (bk.status === "booked" || bk.status === "booking") {
      html += '<div class="trip-stream" id="stream-' + esc(bk.id) + '" data-trip-id="' + esc(bk.tripId || "") + '">' +
        '<div class="ts-head"><span class="pulse"></span><span>Live watch</span><span class="demo-tag" style="margin-left:auto">Live</span></div>' +
        '<div class="ts-feed"><div class="ts-empty">Connected — waiting for signals from the engine watcher.</div></div></div>' +
        '<div class="watch-meter" id="watch-' + esc(bk.id) + '" data-booking-id="' + esc(bk.id) + '"></div>';
    }
    html += "</div></section><hr class=\"rule\">";
    return { id: id, html: html };
  }

  function renderCard(bk) {
    var brief = bk.brief || {};
    var dest = brief.destination || "Trip";
    var dates = fmtDates(brief);
    var href = "#trip-" + bk.id;
    return '<a href="' + href + '" class="card hover trip-card">' +
      '<div class="trip-head" style="background:linear-gradient(135deg,var(--acc-2),var(--acc) 55%,var(--acc-deep))">' +
      '<span class="initial">' + esc(initial(dest)) + '</span><span class="tag">' + esc(statusLabel(bk.status)) + "</span></div>" +
      '<div class="trip-body"><div class="tname">' + esc(dest) + "</div>" +
      '<div class="tsub">' + route(brief) + "</div>" +
      (dates ? '<div class="tdates">' + esc(dates.toUpperCase()) + "</div>" : "") +
      '<span class="topen">Open trip <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>' +
      "</div></a>";
  }

  function hydrateWatchMeters(list) {
    if (!window.tures || !window.tures.getWatch) return;
    list.forEach(function (bk) {
      if (bk.status !== "booked" && bk.status !== "booking") return;
      var el = document.getElementById("watch-" + bk.id);
      if (!el) return;
      window.tures.getWatch(bk.id).then(function (w) {
        if (!w || !w.enabled) {
          el.innerHTML = '<div class="ts-empty" style="padding:12px 0">Trip Watch off for this trip.</div>';
          return;
        }
        var pr = w.pricing || {};
        var capHtml = "";
        if (pr.atCap && pr.pendingCapUsd && window.tures.approveWatchCap) {
          capHtml = '<div class="it2" style="margin-top:8px"><button type="button" class="btn sm watch-cap-btn" data-id="' + esc(bk.id) + '">Approve $' + esc(String(pr.pendingCapUsd)) + ' more scans</button></div>';
        }
        el.innerHTML = '<div class="cat" style="margin-top:0"><div class="cat-h"><span class="cn">Trip Watch</span><span class="demo-tag">Live</span></div>' +
          '<div class="item"><span class="idot"></span><div class="ibody"><div class="it1">Risk · ' + esc(w.riskLevel || "clear") + " (" + esc(String(w.riskScore || 0)) + ')</div>' +
          '<div class="it2">Alerts on · ' + esc(String(w.scansToday || 0)) + "/" + esc(String(w.scansBudgetToday || 0)) + " scans today</div>" +
          '<div class="it2">Spend · $" + esc(String((pr.billableUsd || 0).toFixed(2))) + " of $" + esc(String(pr.effectiveCapUsd || pr.capUsd || w.capUsd)) + " cap (pass-through +" + esc(String(pr.marginPercent || 20)) + "%)</div>" +
          capHtml + "</div></div></div>";
        var capBtn = el.querySelector(".watch-cap-btn");
        if (capBtn) {
          capBtn.addEventListener("click", function () {
            capBtn.disabled = true;
            window.tures.approveWatchCap(bk.id, pr.pendingCapUsd || 5).then(function () { hydrateWatchMeters([bk]); }).catch(function () { capBtn.disabled = false; });
          });
        }
      }).catch(function () {});
    });
  }

  function boot() {
    var wrap = document.getElementById("live-trips-wrap");
    var details = document.getElementById("live-trips-details");
    var examples = document.getElementById("example-trips-section");
    var T = window.tures;
    if (!wrap || !T || !T.configured) return;

    function showExamples(show) {
      if (examples) examples.style.display = show ? "" : "none";
    }

    if (!T.signedIn) {
      wrap.innerHTML = '<p class="lead" style="font-size:14px;color:var(--muted);margin-bottom:20px">Sign in to see trips you have held or booked. <a href="login.html" style="color:var(--acc-deep);font-weight:600">Sign in →</a></p>';
      showExamples(true);
      return;
    }

    wrap.innerHTML = '<p class="lead" style="font-size:14px;color:var(--muted)">Loading your trips…</p>';

    var sync = window.turesAccountSync ? window.turesAccountSync() : Promise.resolve();
    sync.then(function () { return T.bookings(); }).then(function (r) {
      var list = (r && r.bookings) || [];
      if (!list.length) {
        wrap.innerHTML = '<p class="lead" style="font-size:14px;color:var(--muted);margin-bottom:20px">No held or booked trips yet — plan one and Tures will list it here. <a href="plan.html" style="color:var(--acc-deep);font-weight:600">Plan a trip →</a></p>';
        showExamples(true);
        return;
      }
      wrap.innerHTML = '<span class="eyebrow" style="margin-bottom:14px;display:block"><span class="dot"></span> Your trips</span>' +
        '<div class="grid-3">' + list.map(renderCard).join("") + "</div>";
      if (details) {
        details.innerHTML = list.map(function (bk) { return renderDetail(bk).html; }).join("");
      }
      if (window.turesTripStream) {
        var bar = document.getElementById("trip-live-bar");
        var barText = document.getElementById("trip-live-text");
        var streamHub = turesTripStream.watchBookings(list, {
          feedFor: function (bk) {
            var el = document.getElementById("stream-" + bk.id);
            return el ? el.querySelector(".ts-feed") : null;
          },
          onEvent: function (bk, ev) {
            var feed = document.querySelector("#stream-" + bk.id + " .ts-feed");
            if (feed && feed.querySelector(".ts-empty")) feed.innerHTML = "";
            if (bar) {
              bar.hidden = false;
              if (ev.kind === "hiccup") bar.classList.add("warn");
              if (barText) {
                barText.textContent = ev.kind === "hiccup"
                  ? "Hiccup flagged on " + (bk.brief && bk.brief.destination ? bk.brief.destination : "your trip")
                  : "Watching " + list.filter(function (b) { return b.status === "booked"; }).length + " trip(s)";
              }
            }
          },
          onReady: function (n) {
            if (bar && n > 0) {
              bar.hidden = false;
              if (barText) barText.textContent = "Watching " + n + " trip" + (n === 1 ? "" : "s") + " · live stream";
            }
          },
        });
        window.__turesTripsStream = streamHub;
      }
      hydrateWatchMeters(list);
      showExamples(true);
      if (examples) {
        var ey = examples.querySelector(".examples-eyebrow");
        if (!ey) {
          var h = document.createElement("span");
          h.className = "eyebrow examples-eyebrow";
          h.style.cssText = "display:block;margin:32px 0 18px";
          h.innerHTML = '<span class="dot"></span> Example trips <span class="demo-tag" style="margin-left:8px">Sample</span>';
          examples.parentNode.insertBefore(h, examples);
        }
      }
    }).catch(function () {
      wrap.innerHTML = '<p class="lead" style="font-size:14px;color:var(--muted)">Could not load trips just now. <a href="plan.html" style="color:var(--acc-deep)">Plan a trip →</a></p>';
      showExamples(true);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
