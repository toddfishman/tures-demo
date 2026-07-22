/* Tures — when /assist proposes actions, show clear "Allow & go" buttons + handoff links. */
(function () {
  if (window.turesAssistUi) return;
  window.turesAssistUi = true;

  var css = document.createElement("style");
  css.textContent =
    ".act-wrap{align-self:flex-start;max-width:92%;display:flex;flex-direction:column;gap:8px;margin:4px 0 2px}" +
    ".act-card{background:#fff;border:1px solid var(--line-2,rgba(26,26,26,.16));border-radius:14px;padding:12px 14px;font:14px/1.45 'DM Sans',system-ui,sans-serif;color:var(--text,#1a1a1a);box-shadow:0 8px 24px -16px rgba(0,0,0,.12)}" +
    ".act-card h4{font:600 14px 'DM Sans',sans-serif;margin:0 0 4px;color:var(--text,#1a1a1a)}" +
    ".act-card p{margin:0 0 8px;font-size:13px;color:var(--muted,#6f6f6f)}" +
    ".act-card .perm{font:500 11px 'Space Mono',monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--silver-deep,#79828f);margin-bottom:8px}" +
    ".act-card .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
    ".act-card .go{background:var(--acc,#ff4929);color:#fff;border:none;border-radius:999px;padding:8px 14px;font:600 13px 'DM Sans',sans-serif;cursor:pointer}" +
    ".act-card .go:disabled{opacity:.55;cursor:default}" +
    ".act-card .go.ghost{background:transparent;border:1px solid var(--line-2);color:var(--text)}" +
    ".act-card .note{font-size:12px;color:var(--good,#2e9e5b);margin-top:6px}" +
    ".act-card .warn{font-size:12px;color:var(--warn,#c77a00);margin-top:6px}" +
    ".act-card .handoff{display:inline-flex;align-items:center;gap:6px;margin-top:8px;color:var(--acc-deep,#cf3b1f);font-weight:600;font-size:13px;text-decoration:none}" +
    ".act-card .alt{display:inline-block;margin:8px 0 0 12px;color:var(--muted,#6f6f6f);font-size:12.5px;text-decoration:underline}" +
    ".act-card .alt:hover{color:var(--acc-deep,#cf3b1f)}" +
    ".plan .act-card{background:var(--surface,#f6f6f6)}" +
    ".cz-thread .act-card{background:var(--surface,#f6f6f6)}" +
    "html.dark .act-card{background:var(--surface,#1a1a1e);border-color:var(--line)}";
  document.head.appendChild(css);

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function handoffUrl(token) {
    var base = location.href.replace(/[^/]+$/, "");
    return base + "handoff.html?id=" + encodeURIComponent(token);
  }

  /** Auth that returns the traveler to this exact page (login.html honors ?next= and ?create=1). */
  function authUrl(create) {
    var here = "plan.html";
    try {
      here = location.pathname.replace(/^.*\//, "") + location.search + location.hash;
    } catch (_) {}
    return "login.html?" + (create ? "create=1&" : "") + "next=" + encodeURIComponent(here || "plan.html");
  }
  function loginUrl() { return authUrl(false); }

  /** An anonymous visitor most likely has no account yet, so lead with creating one and offer
   *  sign-in as the smaller, secondary path for people who already have a seat. */
  function accountPrompt(lead) {
    return (
      '<p class="warn">' + lead + "</p>" +
      '<a class="handoff" href="' + esc(authUrl(true)) + '">Create an account &rarr;</a>' +
      '<a class="alt" href="' + esc(loginUrl()) + '">or sign in</a>'
    );
  }

  function signedIn() {
    return !!(window.tures && window.tures.signedIn);
  }

  /** Say what actually went wrong. Acting on someone's behalf needs an account, so a 401 is a
   *  sign-in prompt — not a connection error, and never "try again" (retrying can't fix it). */
  function failureFor(e) {
    var st = e && e.status;
    var code = (e && e.body && e.body.error) || "";
    if (e && e.offline) {
      return { html: '<p class="warn">I can\'t reach Tures from this page right now.</p>' };
    }
    if (st === 401) {
      // The engine tells us WHY an account is needed — use its words when it does.
      var why = (e && e.body && e.body.reason) || "doing things on your behalf needs an account";
      return { signin: true, html: accountPrompt("I can take this one from here &mdash; " + esc(why) + ".") };
    }
    if (st === 402 || st === 403) {
      return { html: '<p class="warn">Your account does not have permission for this one yet.</p>' };
    }
    if (st === 429 && code === "free_limit_reached") {
      // The free lookups are spent. An account is the fix — so offer that warmly, not "try again".
      return {
        signin: true,
        html: accountPrompt(
          "That is the last of today's free lookups. Make an account and I'll keep going &mdash; and I'll remember what you like.",
        ),
      };
    }
    if (st === 429) {
      return { html: '<p class="warn">That is a lot at once — give me a minute and try again.</p>' };
    }
    if (st >= 500) {
      return { html: '<p class="warn">Something broke on my end, not yours. Try again in a moment.</p>' };
    }
    // No status at all — a genuine network failure, where "try again" is honest advice.
    return { html: '<p class="warn">Could not reach Tures just now. Try again in a moment.</p>' };
  }

  function grantAndRun(action, tripId) {
    var T = window.tures;
    if (!T || !T.actions) return Promise.reject(Object.assign(new Error("offline"), { offline: true }));
    var chain = action.readonly
      ? T.actions.run({ permission: action.permission, title: action.title, detail: action.detail, tripId: tripId })
      : T.actions.grant(action.permission, action.title).then(function (r) {
          return T.actions.run({
            permission: action.permission,
            title: action.title,
            detail: action.detail,
            grantId: r.grant.id,
            tripId: tripId,
          });
        });
    return chain;
  }

  /** Append action cards below the last message in a chat thread. */
  function renderActions(container, actions, opts) {
    if (!actions || !actions.length) return;
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "act-wrap";
    actions.forEach(function (action) {
      var card = document.createElement("div");
      card.className = "act-card";
      var btnLabel = action.readonly ? "Do this for me" : "Allow & go";
      card.innerHTML =
        '<h4>' + esc(action.title) + "</h4>" +
        (action.detail ? "<p>" + esc(action.detail) + "</p>" : "") +
        (action.permissionLabel && !action.readonly
          ? '<div class="perm">Needs your OK: ' + esc(action.permissionLabel) + "</div>"
          : "") +
        '<div class="row"><button type="button" class="go">' + btnLabel + "</button></div>" +
        '<div class="status"></div>';
      var btn = card.querySelector(".go");
      var status = card.querySelector(".status");

      // One click handler, one mode — so a button that has become "Sign in" or "Open your step"
      // navigates instead of silently re-running the action underneath.
      var mode = "run"; // run | signin | handoff
      var handoffHref = "";

      // Read-only lookups run for anonymous visitors (the engine caps cost + a daily quota), so
      // leave those clickable. Anything that acts on your behalf needs an account — say so up
      // front rather than letting them click into a guaranteed failure.
      if (!signedIn() && !action.readonly) {
        mode = "signin";
        btn.textContent = "Sign in to run this";
        btn.classList.add("ghost");
      }

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        if (mode === "signin") { location.href = loginUrl(); return; }
        if (mode === "handoff") { window.open(handoffHref, "_blank", "noopener"); return; }
        btn.disabled = true;
        btn.textContent = "Working…";
        grantAndRun(action, opts.tripId)
          .then(function (res) {
            var run = res && res.run;
            if (run && run.status === "needs_human" && run.handoffToken) {
              status.innerHTML =
                '<p class="warn">I need you for a moment — a quick sign-in or security check.</p>' +
                '<a class="handoff" href="' +
                esc(handoffUrl(run.handoffToken)) +
                '" target="_blank" rel="noopener">Your turn → open this step</a>';
              mode = "handoff";
              handoffHref = handoffUrl(run.handoffToken);
              btn.classList.add("ghost");
              btn.disabled = false;
              btn.textContent = "Open your step";
              return;
            }
            if (run && run.status === "completed") {
              var sim = run.result && run.result.simulated;
              var free = res && res.freeTier;
              // Warn as the free runs run out, so the wall is never a surprise.
              var heads = "";
              if (free && free.remaining === 0) {
                heads = '<p class="warn">That was your last free lookup today. ' +
                  '<a class="handoff" href="' + esc(authUrl(true)) + '">Create an account</a> to keep going.</p>';
              } else if (free && free.remaining === 1) {
                heads = '<p class="warn">One free lookup left today.</p>';
              }
              status.innerHTML =
                "<p class=\"note\">" +
                esc((run.result && run.result.summary) || "Done.") +
                (sim ? " (preview mode)" : "") +
                "</p>" + heads;
              btn.remove();
              return;
            }
            status.innerHTML = '<p class="warn">' + esc((run && run.result && run.result.summary) || "Could not finish — try again or do it manually.") + "</p>";
            btn.disabled = false;
            btn.textContent = btnLabel;
          })
          .catch(function (e) {
            var f = failureFor(e);
            status.innerHTML = f.html;
            btn.disabled = false;
            if (f.signin) {
              mode = "signin";
              btn.textContent = "Sign in to continue";
              btn.classList.add("ghost");
            } else {
              btn.textContent = btnLabel;
            }
          });
      });
      wrap.appendChild(card);
    });
    container.appendChild(wrap);
    if (opts.scroll) opts.scroll();
  }

  /** Trip-planning-ish messages stay on the planner; everything else uses /assist. */
  function isTripPlanning(text) {
    return /\b(trip|fly|flight|hotel|vacation|weekend|getaway|visit|travel(?:ing)?\s+to|going\s+to|book\s+a|plan\s+a|itinerary|destination|honeymoon|anniversary\s+trip|where\s+should\s+i\s+go)\b/i.test(
      String(text || ""),
    );
  }

  window.turesAssistUi = { renderActions: renderActions, isTripPlanning: isTripPlanning, grantAndRun: grantAndRun };
})();
