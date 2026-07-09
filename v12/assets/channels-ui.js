/* Telegram / channel link status — shared across vault, onboard, plan, telegram pages. */
(function () {
  if (window.__turesChannelsUi) return;
  window.__turesChannelsUi = true;

  window.turesChannelStatus = function () {
    var T = window.tures;
    if (!T || !T.configured || !T.signedIn || !T.channels) {
      return Promise.resolve({ telegram: false, channels: [] });
    }
    return T.channels.list().then(function (r) {
      var ch = (r && r.channels) || [];
      return { telegram: ch.some(function (c) { return c.channel === "telegram"; }), channels: ch };
    }).catch(function () {
      return { telegram: false, channels: [] };
    });
  };

  function linkTelegram(onStatus) {
    var T = window.tures;
    if (!T || !T.configured || !T.channels) {
      if (onStatus) onStatus("Telegram is rolling out shortly.");
      return Promise.resolve(false);
    }
    if (!T.signedIn) {
      if (onStatus) onStatus("Sign in first — then Telegram links to your account.");
      return Promise.resolve(false);
    }
    if (onStatus) onStatus("Starting the link…");
    return T.channels.linkCode().then(function (r) {
      if (r && r.telegramDeepLink) {
        window.open(r.telegramDeepLink, "_blank");
        if (onStatus) onStatus("Opening Telegram — tap Start to link this chat.");
        return true;
      }
      if (onStatus) onStatus("Bot is not live yet — try again soon.");
      return false;
    }).catch(function (e) {
      if (onStatus) {
        onStatus((e && e.status === 401) ? "Sign in first, then connect Telegram." : "Could not start the link — try again.");
      }
      return false;
    });
  }

  window.turesLinkTelegram = linkTelegram;

  window.turesWireTelegramUi = function (opts) {
    opts = opts || {};
    var btn = opts.button;
    var sub = opts.subtitle;
    var onLinked = opts.onLinked;

    function paint(st) {
      if (sub) {
        sub.textContent = st.telegram
          ? "Telegram linked — same Tures on your phone."
          : (opts.subtitleDefault || "Text Tures on your phone — same memory as here.");
      }
      if (btn) {
        btn.textContent = st.telegram ? "Linked ✓" : (opts.buttonLabel || "Connect");
        btn.disabled = !!st.telegram;
      }
      if (st.telegram && onLinked) onLinked(st);
    }

    if (btn) {
      btn.addEventListener("click", function () {
        linkTelegram(function (msg) { if (sub) sub.textContent = msg; }).then(function () {
          return window.turesChannelStatus().then(paint);
        });
      });
    }

    return window.turesChannelStatus().then(paint);
  };

  window.turesWirePlanTextTures = function () {
    var el = document.getElementById("text-tures");
    var T = window.tures;
    if (!el || !T) return;

    function paint(st) {
      var label = st.telegram ? "Telegram linked" : "Text Tures";
      var svg = el.querySelector("svg");
      el.innerHTML = "";
      if (svg) el.appendChild(svg);
      el.appendChild(document.createTextNode(" " + label));
      el.title = st.telegram
        ? "Your Telegram is linked — opens your Tures chat"
        : "Open Tures on Telegram (same account)";
    }

    if (T.configured && T.channels) {
      el.setAttribute("href", "#");
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (!T.signedIn) {
          location.href = "login.html?next=" + encodeURIComponent("plan.html");
          return;
        }
        linkTelegram(function (msg) {
          if (window.bubble) window.bubble(msg, "t");
        }).then(function () { return window.turesChannelStatus().then(paint); });
      });
      return window.turesChannelStatus().then(paint);
    }
    return Promise.resolve();
  };
})();
