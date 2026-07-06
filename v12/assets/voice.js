/* Tures — voice conversation. Adds a "Talk to Tures" button that opens a spoken back-and-forth:
 * Tures greets you out loud, you tap to talk, it transcribes (Deepgram), thinks (Claude /converse),
 * and replies in its own voice (Deepgram Aura). Push-to-talk for reliability.
 *
 * On plan.html (window.turesVoiceBridge) voice runs IN the main chat thread — no separate modal.
 */
(function () {
  if (window.__turesVoice) return;
  window.__turesVoice = true;
  if (!(window.tures && tures.configured)) return;

  function bridge() { return window.turesVoiceBridge; }
  function inline() { var b = bridge(); return !!(b && b.bubble); }

  var S = document.createElement('style');
  S.textContent = [
    '.tv-fab{position:fixed;left:18px;bottom:18px;z-index:75;display:inline-flex;align-items:center;gap:9px;',
    'padding:11px 17px;border-radius:99px;cursor:pointer;border:1px solid var(--gold,#4ADE80);',
    'background:rgba(8,12,8,0.7);color:#F0EAD8;font-family:DM Sans,Inter,sans-serif;backdrop-filter:blur(14px) saturate(160%);',
    'font-size:13px;letter-spacing:.02em;box-shadow:0 8px 24px -10px rgba(0,0,0,.6);transition:transform .14s ease,border-color .2s ease}',
    '.tv-fab:hover{transform:translateY(-1px);border-color:var(--gold-bright,#86EFAC)}',
    '.tv-fab .d{width:7px;height:7px;border-radius:50%;background:var(--gold,#4ADE80)}',
    '.tv-trigger{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:99px;cursor:pointer;white-space:nowrap;',
    'border:1px solid var(--acc,var(--gold,#4ADE80));background:var(--acc,var(--gold,#4ADE80));color:#fff;font-family:Inter,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:.02em;',
    'box-shadow:0 6px 18px -8px rgba(0,0,0,.5);transition:filter .15s ease, transform .14s ease, box-shadow .2s}',
    '.tv-trigger:hover{filter:brightness(1.07);transform:translateY(-1px)}',
    '.tv-trigger:active{transform:scale(.97)}',
    '.tv-trigger .d{width:7px;height:7px;border-radius:50%;background:#fff;animation:tvpulse 1.6s ease-in-out infinite}',
    '.tv-trigger.rec{border-color:#7DD3FC;background:transparent;color:#7DD3FC;box-shadow:0 0 0 1px rgba(125,211,252,.35)}',
    '.tv-trigger.rec .d{background:#7DD3FC;animation:tvr 1.4s infinite}',
    '.tv-trigger.speak .d{background:var(--acc-2,#ff6b4a);animation:tvpulse 1s infinite}',
    '@keyframes tvpulse{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}',
    '@keyframes tvr{0%{box-shadow:0 0 0 0 rgba(125,211,252,.45)}100%{box-shadow:0 0 0 14px rgba(125,211,252,0)}}',
    '.tv-trigger .ts{display:none}',
    '@media(max-width:430px){.tv-trigger .tl{display:none}.tv-trigger .ts{display:inline}}',
    '.tv-ov{position:fixed;inset:0;z-index:120;display:none;align-items:flex-end;justify-content:center;',
    'background:rgba(4,6,4,0.74);backdrop-filter:blur(4px)}',
    '.tv-ov.on{display:flex}',
    '.tv-panel{width:100%;max-width:460px;max-height:88vh;display:flex;flex-direction:column;',
    'background:linear-gradient(160deg,#141C13,#0F1410 55%,#0A0D08);border:1px solid rgba(255,255,255,0.1);border-top:2px solid var(--gold,#4ADE80);',
    'border-radius:22px 22px 0 0;overflow:hidden;color:#F0EAD8;box-shadow:0 -20px 60px -20px rgba(0,0,0,.7)}',
    '@media(min-width:560px){.tv-ov{align-items:center}.tv-panel{border-radius:20px;margin-bottom:0}}',
    '.tv-top{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,0.08)}',
    '.tv-top .wm{font-family:Playfair Display,Georgia,serif;font-size:22px;color:#fff;letter-spacing:.02em}',
    '.tv-top .wm b{color:var(--gold,#4ADE80);font-weight:400}',
    '.tv-x{background:transparent;border:0;color:#B8AD96;font-size:22px;cursor:pointer;line-height:1}',
    '.tv-x:hover{color:#F0EAD8}',
    '.tv-sub{padding:0 18px 6px;font-size:11.5px;color:#B8AD96;line-height:1.4}',
    '.tv-status{padding:8px 18px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#B8AD96;display:flex;align-items:center;gap:8px}',
    '.tv-status .pd{width:8px;height:8px;border-radius:50%;background:#3D5238}',
    '.tv-status.speak .pd{background:var(--gold,#4ADE80);animation:tvp 1s infinite}',
    '.tv-status.listen .pd{background:#7DD3FC;animation:tvp .8s infinite}',
    '.tv-status.think .pd{background:var(--gold-bright,#86EFAC);animation:tvp 1.2s infinite}',
    '@keyframes tvp{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}',
    '.tv-log{flex:1;overflow-y:auto;padding:6px 18px 14px;display:flex;flex-direction:column;gap:8px;min-height:160px}',
    '.tv-b{max-width:86%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45}',
    '.tv-b.t{align-self:flex-start;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-top-left-radius:4px;color:#E3ECE1}',
    '.tv-b.me{align-self:flex-end;background:var(--gold,#4ADE80);color:#06120a;border-top-right-radius:4px}',
    '.tv-foot{padding:14px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:8px;border-top:1px solid rgba(255,255,255,0.08)}',
    '.tv-mic{width:74px;height:74px;border-radius:50%;border:1.5px solid var(--gold,#4ADE80);cursor:pointer;',
    'background:radial-gradient(120% 120% at 50% 20%,#1A2418,#0F1410);color:var(--gold,#4ADE80);font-size:28px;display:grid;place-items:center;transition:transform .12s ease,box-shadow .2s ease}',
    '.tv-mic:hover{box-shadow:0 0 22px -6px var(--gold,#4ADE80)}',
    '.tv-mic:disabled{opacity:.45;cursor:default}',
    '.tv-mic.rec{border-color:#7DD3FC;color:#7DD3FC;animation:tvr 1.4s infinite}',
    '.tv-hint{font-size:12px;color:#B8AD96;min-height:16px;text-align:center}'
  ].join('');
  document.head.appendChild(S);

  var fab = document.createElement('button');
  fab.setAttribute('aria-label', 'Talk to me');
  fab.type = 'button';
  var mount = document.querySelector('[data-voice-mount]');
  if (mount) {
    fab.className = 'tv-trigger';
    fab.innerHTML = '<span class="d"></span><span class="tl">Talk to me</span><span class="ts">Talk</span>';
    mount.appendChild(fab);
  } else {
    fab.className = 'tv-fab';
    fab.innerHTML = '<span class="d"></span>Talk to me';
    document.body.appendChild(fab);
  }

  var ov = null, elStatus, elStatusT, elLog, elMic, elHint, elMute;

  if (!inline()) {
    ov = document.createElement('div');
    ov.className = 'tv-ov';
    ov.innerHTML =
      '<div class="tv-panel" role="dialog" aria-label="Talk to Tures">' +
        '<div class="tv-top"><span class="wm">t<b>✦</b>ures · voice</span><span style="display:flex;align-items:center;gap:10px"><button class="tv-x" id="tvMute" aria-label="Mute Tures" title="Mute">🔊</button><button class="tv-x" id="tvClose" aria-label="Close">×</button></span></div>' +
        '<div class="tv-sub">Talk it through out loud — I’ll plan and book your trip as we go. Not the same as the dictation mic.</div>' +
        '<div class="tv-status" id="tvStatus"><span class="pd"></span><span id="tvStatusT">Connecting…</span></div>' +
        '<div class="tv-log" id="tvLog"></div>' +
        '<div class="tv-foot"><button class="tv-mic" id="tvMic" disabled>🎤</button><div class="tv-hint" id="tvHint">…</div></div>' +
      '</div>';
    document.body.appendChild(ov);
    elStatus = ov.querySelector('#tvStatus');
    elStatusT = ov.querySelector('#tvStatusT');
    elLog = ov.querySelector('#tvLog');
    elMic = ov.querySelector('#tvMic');
    elHint = ov.querySelector('#tvHint');
    elMute = ov.querySelector('#tvMute');
    ov.querySelector('#tvClose').addEventListener('click', closeOv);
    if (elMute) elMute.addEventListener('click', function () { setMuted(!muted); });
    ov.addEventListener('click', function (e) { if (e.target === ov) closeOv(); });
    elMic.addEventListener('click', function () { unlockAudio(); if (recording) stopRec(); else startRec(); });
  }

  var history = [], rec = null, chunks = [], recording = false, open = false, muted = false, inlineStarted = false;
  var audioEl = new Audio(); audioEl.preload = 'auto';
  var primed = false;

  function unlockAudio() {
    if (primed) return; primed = true;
    try {
      audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      var p = audioEl.play(); if (p && p.catch) p.catch(function () {});
    } catch (_) {}
  }

  function setStatus(mode, text) {
    var b = bridge();
    if (inline() && b.setStatus) b.setStatus(text || 'Tures · online');
    if (elStatus) { elStatus.className = 'tv-status ' + (mode || ''); elStatusT.textContent = text; }
    if (inline() && fab) {
      fab.classList.toggle('rec', mode === 'listen');
      fab.classList.toggle('speak', mode === 'speak');
    }
  }

  function bubble(text, who) {
    var b = bridge();
    if (inline() && b.bubble) return b.bubble(text, who === 'me' ? 'me' : 't');
    if (!elLog) return null;
    var el = document.createElement('div'); el.className = 'tv-b ' + (who === 'me' ? 'me' : 't'); el.textContent = text;
    elLog.appendChild(el); elLog.scrollTop = elLog.scrollHeight; return el;
  }

  function micState(s) {
    if (s === 'rec') {
      if (elMic) { elMic.disabled = false; elMic.classList.add('rec'); elMic.innerHTML = '⏹'; }
      if (elHint) elHint.textContent = 'Listening… tap when you’re done';
      if (inline() && fab) fab.classList.add('rec');
    } else if (s === 'ready') {
      if (elMic) { elMic.disabled = false; elMic.classList.remove('rec'); elMic.innerHTML = '🎤'; }
      if (elHint) elHint.textContent = 'Tap to speak';
      if (inline() && fab) fab.classList.remove('rec');
    } else {
      if (elMic) { elMic.disabled = true; elMic.classList.remove('rec'); elMic.innerHTML = '🎤'; }
      if (inline() && fab) fab.classList.remove('rec');
    }
  }

  function pickMime() {
    var prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (var i = 0; i < prefs.length; i++) if (MediaRecorder.isTypeSupported(prefs[i])) return prefs[i];
    }
    return '';
  }

  function speak(text) {
    if (muted) return new Promise(function (res) { setTimeout(res, Math.min(2800, 500 + text.length * 24)); });
    return tures.voice.speak(text).then(function (blob) {
      return new Promise(function (resolve) {
        try {
          audioEl.src = URL.createObjectURL(blob);
          audioEl.onended = resolve; audioEl.onerror = resolve;
          var p = audioEl.play(); if (p && p.catch) p.catch(function () { resolve(); });
        } catch (_) { resolve(); }
      });
    }).catch(function () {});
  }

  function sayTures(text) {
    history.push({ role: 'assistant', content: text });
    bubble(text, 't');
    var b = bridge();
    if (inline() && b.pushHistory) b.pushHistory({ role: 'assistant', content: text });
    setStatus('speak', 'Tures is speaking');
    micState('off');
    return speak(text).then(function () { setStatus('', 'Your turn — tap Talk'); micState('ready'); });
  }

  function greet() {
    setStatus('think', 'Waking up');
    var hi = inline()
      ? 'Talk or type — same conversation. Tell me a trip and I will shape it, book it, and watch it.'
      : 'Hi — I’m Tures, a travel concierge that actually books your trips, not just suggests them. Ask me anything, or tell me a trip you’re dreaming up.';
    sayTures(hi);
  }

  function startRec() {
    if (recording) return;
    unlockAudio();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickMime();
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (_) { rec = new MediaRecorder(stream); }
      chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        handleUtterance(blob);
      };
      rec.start(); recording = true; micState('rec'); setStatus('listen', 'Listening');
    }).catch(function () {
      var msg = 'Allow the microphone, then tap Talk again.';
      if (inline()) bubble(msg, 't');
      else if (elHint) elHint.textContent = msg;
    });
  }

  function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); recording = false; }

  function handleUtterance(blob) {
    if (!blob.size) { micState('ready'); setStatus('', 'Your turn'); return; }
    setStatus('think', 'Hearing you'); micState('off');
    tures.voice.transcribe(blob).then(function (r) {
      var said = (r && r.transcript || '').trim();
      if (!said) { setStatus('', 'Didn’t catch that'); micState('ready'); return; }
      bubble(said, 'me'); history.push({ role: 'user', content: said });
      var b = bridge();
      if (inline() && b.pushHistory) b.pushHistory({ role: 'user', content: said });
      setStatus('think', 'Tures is thinking');
      var ctx = window.turesFunnel ? window.turesFunnel.context() : undefined;
      var uid = window.turesFunnel ? window.turesFunnel.uid() : undefined;
      function attempt(n) { return tures.converse(history.slice(-12), undefined, ctx, uid).catch(function (e) { if (n > 0) return new Promise(function (res, rej) { setTimeout(function () { attempt(n - 1).then(res, rej); }, 1800); }); throw e; }); }
      return attempt(1).then(function (c) {
        var reply = (c && c.reply || '').trim() || (history.length > 1 ? 'Sorry — I lost that for a second. Say it once more?' : 'I’m here — tell me a trip and I’ll handle it.');
        if (c && c.ready && c.brief) {
          return sayTures(reply).then(function () { startPlanning(c.brief); });
        }
        return sayTures(reply);
      });
    }).catch(function () { setStatus('', 'Hiccup'); micState('ready'); });
  }

  function startPlanning(brief) {
    setStatus('think', 'Building your trip');
    micState('off');
    var b = bridge();
    if (inline() && b.onReady) {
      b.onReady(brief, history);
      setStatus('', 'Building your trip…');
      return;
    }
    var comp = document.getElementById('composer-input') || document.getElementById('composer');
    if (comp && typeof window.sendBrief === 'function') {
      if (typeof window.turesVoiceImport === 'function') window.turesVoiceImport(history);
      comp.value = brief;
      if (typeof window.autoGrow === 'function') window.autoGrow();
      setTimeout(function () { closeOv(); window.sendBrief(brief); }, 700);
    } else {
      try { localStorage.setItem('tures.readyBrief', brief); } catch (_) {}
      location.href = 'plan.html';
    }
  }

  function openOv() {
    unlockAudio();
    if (inline()) {
      if (!inlineStarted) { inlineStarted = true; var b = bridge(); if (!b.hasMessages || !b.hasMessages()) greet(); }
      if (recording) stopRec(); else startRec();
      return;
    }
    if (open) return;
    open = true; ov.classList.add('on'); document.body.style.overflow = 'hidden';
    history = []; if (elLog) elLog.innerHTML = '';
    greet();
  }

  function closeOv() {
    open = false;
    if (ov) ov.classList.remove('on');
    document.body.style.overflow = '';
    try { audioEl.pause(); } catch (_) {}
    stopRec();
  }

  function setMuted(m) {
    muted = m;
    if (elMute) { elMute.textContent = m ? '🔇' : '🔊'; elMute.setAttribute('aria-label', m ? 'Unmute Tures' : 'Mute Tures'); elMute.title = m ? 'Unmute' : 'Mute'; }
    if (m) { try { audioEl.pause(); } catch (_) {} }
  }

  fab.addEventListener('click', openOv);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open && !inline()) closeOv(); });
})();
