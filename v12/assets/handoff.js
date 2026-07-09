(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var token = params.get("id") || params.get("token");
  var demo = params.get("demo") === "1";
  var root = document.getElementById("ho-root");
  var lead = document.getElementById("ho-lead");

  var REASON_LABEL = {
    captcha: "Security check",
    otp: "Verification code",
    login: "Sign in",
    confirm: "Confirm",
    other: "Your step",
  };

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function renderOpen(data) {
    var h = data.handoff;
    var sim = data.executor === "simulated";
    lead.textContent = h.instructions;

    var card = document.createElement("div");
    card.className = "ho-card";
    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">' +
      '<span class="ho-tag live">' + esc(REASON_LABEL[h.reason] || "Your step") + "</span>" +
      (sim ? '<span class="ho-tag">Sample session</span>' : '<span class="ho-tag">Live session</span>') +
      "</div>" +
      "<h2>" + esc(h.title) + "</h2>" +
      "<p style=\"margin-top:6px\">" + esc(h.instructions) + "</p>";

    if (h.liveViewUrl) {
      var live = document.createElement("div");
      live.className = "ho-live";
      if (sim || !h.liveViewUrl.includes("browserbase")) {
        live.innerHTML =
          '<div class="ho-ph">' +
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/></svg>' +
          "Open the site in a secure browser window, complete the step, then return here." +
          (sim ? '<p class="ho-sim">Browser automation is in sample mode — this shows the handoff flow.</p>' : "") +
          "</div>";
        card.appendChild(live);
      } else {
        live.innerHTML = '<iframe src="' + esc(h.liveViewUrl) + '" title="Live browser session" allow="clipboard-read; clipboard-write"></iframe>';
        card.appendChild(live);
      }
    }

    var steps = document.createElement("ol");
    steps.className = "ho-steps";
    steps.style.marginTop = "18px";
    steps.innerHTML =
      "<li><span class=\"n\">1</span><span>Open the session — sign in or pass the check Tures cannot do alone.</span></li>" +
      "<li><span class=\"n\">2</span><span>When the page looks ready, come back and tap <strong>I'm done</strong>.</span></li>" +
      "<li><span class=\"n\">3</span><span>Tures picks up and finishes the task.</span></li>";
    card.appendChild(steps);

    root.appendChild(card);

    var foot = document.createElement("div");
    foot.className = "ho-foot";
    foot.innerHTML =
      (h.liveViewUrl
        ? '<a class="btn" id="ho-open" href="' + esc(h.liveViewUrl) + '" target="_blank" rel="noopener">Open session →</a>'
        : "") +
      '<button type="button" class="btn" id="ho-done">I\'m done — continue</button>' +
      '<button type="button" class="btn ghost" id="ho-abort">Cancel this step</button>';
    root.appendChild(foot);

    document.getElementById("ho-done").addEventListener("click", function () {
      var btn = document.getElementById("ho-done");
      btn.disabled = true;
      btn.textContent = "Continuing…";
      tures.actions.continueHandoff(token).then(function () {
        renderDone(data);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "I'm done — continue";
        alert("Could not continue — the handoff may have expired.");
      });
    });
    document.getElementById("ho-abort").addEventListener("click", function () {
      if (!confirm("Cancel this step? Tures will stop this action.")) return;
      tures.actions.abortHandoff(token).then(function () {
        renderAborted();
      });
    });
  }

  function renderDone() {
    root.innerHTML =
      '<div class="ho-done">' +
      '<div class="mark">✓</div>' +
      '<h1 style="font-family:\'Playfair Display\',serif;font-size:1.6rem;margin-bottom:8px">Back to Tures.</h1>' +
      '<p class="lead">Your step is complete. Tures is finishing up — you can close this page.</p>' +
      '<p style="margin-top:20px"><a href="trips.html" class="btn" style="display:inline-flex">My trips →</a></p>' +
      "</div>";
  }

  function renderAborted() {
    root.innerHTML =
      '<div class="ho-err">' +
      "<h2 style=\"font-family:'Playfair Display',serif;margin-bottom:8px\">Step cancelled</h2>" +
      "<p>Tures stopped this action. Nothing was charged.</p>" +
      '<p style="margin-top:18px"><a href="plan.html" class="btn" style="display:inline-flex">Back to planning →</a></p>' +
      "</div>";
  }

  function renderErr(msg) {
    root.innerHTML =
      '<div class="ho-err">' +
      "<h2 style=\"font-family:'Playfair Display',serif;margin-bottom:8px\">Link unavailable</h2>" +
      "<p>" + esc(msg) + "</p>" +
      "</div>";
  }

  function renderDemo() {
    renderOpen({
      executor: "simulated",
      handoff: {
        reason: "login",
        title: "Sign in to Marriott Bonvoy",
        instructions: "Open the live session, sign in with your saved credentials, then tap I'm done so Tures can finish the room change.",
        liveViewUrl: "https://www.marriott.com",
        status: "open",
      },
    });
  }

  if (demo) {
    lead.textContent = "Sample handoff — how Tures reaches you when a site needs a human.";
    renderDemo();
    return;
  }

  if (!token) {
    renderErr("No handoff link — check the message from Tures.");
    return;
  }

  if (!window.tures || !tures.actions) {
    renderErr("Engine not loaded.");
    return;
  }

  tures.actions.getHandoff(token).then(function (data) {
    if (!data || !data.handoff) {
      renderErr("This link expired or was already used.");
      return;
    }
    if (data.handoff.status === "continued") {
      renderDone();
      return;
    }
    if (data.handoff.status === "aborted" || data.handoff.status === "expired") {
      renderErr("This handoff is no longer active.");
      return;
    }
    renderOpen(data);
  }).catch(function () {
    renderErr("Could not load this handoff.");
  });
})();
