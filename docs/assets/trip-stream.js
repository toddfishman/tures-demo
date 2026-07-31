/* SSE /stream client — live trip watch + hiccup proposals from the engine. */
(function () {
  if (window.__turesTripStream) return;
  window.__turesTripStream = true;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function tsShort(iso) {
    return iso ? String(iso).slice(11, 19) : "";
  }
  function rowClass(kind) {
    if (kind === "hiccup" || kind === "error") return "warn";
    if (kind === "notify" || kind === "book" || kind === "confirm") return "good";
    return "info";
  }

  var hub = {
    connections: {},
    listeners: {},
    recent: [],
  };

  function key(ev) {
    return (ev.ts || "") + "|" + (ev.kind || "") + "|" + (ev.label || "");
  }

  function notify(tripId, ev) {
    var k = key(ev);
    if (hub.listeners[tripId]) {
      hub.listeners[tripId].seen = hub.listeners[tripId].seen || new Set();
      if (hub.listeners[tripId].seen.has(k)) return;
      hub.listeners[tripId].seen.add(k);
    }
    hub.recent.unshift({ tripId: tripId, ev: ev, at: Date.now() });
    if (hub.recent.length > 12) hub.recent.length = 12;
    document.dispatchEvent(new CustomEvent("tures:stream", { detail: { tripId: tripId, ev: ev } }));
    if (hub.listeners[tripId] && hub.listeners[tripId].onEvent) hub.listeners[tripId].onEvent(ev);
  }

  function renderRow(feed, ev, opts) {
    if (!feed) return null;
    opts = opts || {};
    var row = document.createElement("div");
    row.className = "ts-row " + rowClass(ev.kind);
    var tag = (ev.data && ev.data.simulated) ? ' <span class="demo-tag">Sample</span>' : "";
    var live = (ev.data && ev.data.signalId) ? ' <span class="demo-tag">Live</span>' : "";
    row.innerHTML =
      '<div class="ts-k"><span>' + esc(ev.kind || "event") + live + '</span><span class="ts-t">' + esc(tsShort(ev.ts)) + "</span></div>" +
      '<div class="ts-l">' + esc(ev.label) + tag + "</div>" +
      (ev.detail ? '<div class="ts-d">' + esc(ev.detail) + "</div>" : "");
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
    if (opts.onRow) opts.onRow(row, ev);
    return row;
  }

  function renderProposal(feed, ev, opts) {
    var bid = ev.data && ev.data.bookingId;
    if (!feed || !bid) return;
    if (feed.querySelector('[data-proposal="' + bid + '"]')) return;

    var box = document.createElement("div");
    box.className = "ts-proposal";
    box.dataset.proposal = bid;
    box.innerHTML =
      '<div class="ts-p-h">' + esc(ev.label) + "</div>" +
      (ev.detail ? '<div class="ts-p-d">' + esc(ev.detail) + "</div>" : "") +
      '<div class="ts-p-act"><button type="button" class="btn sm" data-ok="1">Approve the swap</button>' +
      '<button type="button" class="btn ghost sm" data-hold="1">Hold</button></div>';

    box.querySelector("[data-ok]").addEventListener("click", function (btnEv) {
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) { b.disabled = true; });
      box.querySelector(".ts-p-act").innerHTML = '<div class="ts-p-d" style="color:var(--good)">Approved — rebooked on the alternative. <span class="demo-tag">Sample</span></div>';
      if (opts && opts.onProposal) opts.onProposal(ev, { approved: true });
    });
    box.querySelector("[data-hold]").addEventListener("click", function () {
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) { b.disabled = true; });
      box.querySelector(".ts-p-act").innerHTML = '<div class="ts-p-d">Held — still watching the original.</div>';
    });
    feed.appendChild(box);
    feed.scrollTop = feed.scrollHeight;
  }

  window.turesTripStream = {
    watch: function (tripId, opts) {
      opts = opts || {};
      var T = window.tures;
      if (!T || !T.configured || !tripId) return { close: function () {} };

      if (hub.connections[tripId]) hub.connections[tripId].close();

      var state = { seen: new Set(), onEvent: opts.onEvent, feed: opts.feed };
      hub.listeners[tripId] = state;

      function handle(ev) {
        notify(tripId, ev);
        if (opts.feed) renderRow(opts.feed, ev, opts);
        if (ev.label === "Rebooking needs your OK") {
          renderProposal(opts.feed, ev, opts);
        }
      }

      var es = T.stream(tripId, handle);
      hub.connections[tripId] = {
        es: es,
        close: function () {
          try { es.close(); } catch (_) {}
          delete hub.connections[tripId];
          delete hub.listeners[tripId];
        },
      };
      return hub.connections[tripId];
    },

    watchBookings: function (bookings, opts) {
      opts = opts || {};
      var list = (bookings || []).filter(function (b) {
        return b && b.tripId && (b.status === "booked" || b.status === "booking");
      });
      var conns = list.map(function (b) {
        var feed = opts.feedFor ? opts.feedFor(b) : null;
        return window.turesTripStream.watch(b.tripId, {
          feed: feed,
          onEvent: opts.onEvent ? function (ev) { opts.onEvent(b, ev); } : undefined,
          onProposal: opts.onProposal,
        });
      });
      if (opts.onReady) opts.onReady(list.length);
      return {
        close: function () { conns.forEach(function (c) { c.close(); }); },
        count: list.length,
      };
    },

    recent: function () { return hub.recent.slice(); },

    closeAll: function () {
      Object.keys(hub.connections).forEach(function (id) { hub.connections[id].close(); });
    },

    renderRow: renderRow,
    renderProposal: renderProposal,
  };
})();
