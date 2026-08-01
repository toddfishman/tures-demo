/* ============================================================
   TURES v11 — corner concierge
   A humanized launcher (photo avatar + greeting bubble) bottom-right
   on every page. Click it and the photo "blows up" — zooms in and
   centers — so it feels like the concierge (Todd) is talking to you.
   That conversation runs the live agent and pipes straight into the
   normal planning flow ('continue in Plan' hand-off with the brief).
   Suppressed on the Plan page (it IS the chat).
   Avatar: assets/img/concierge.png with a graceful t✦ fallback.
   ============================================================ */
(function () {
  if (window.__turesConcierge) return; window.__turesConcierge = true;
  var page = document.body.getAttribute("data-page") || "";
  if (page === "plan") return; // the whole Plan page is already the conversation
  var T = window.tures, F = window.turesFunnel;

  var css = document.createElement("style");
  css.textContent =
    /* ---- launcher (50% larger on desktop) ---- */
    '.cz-l{position:fixed;right:24px;bottom:24px;z-index:75;display:flex;align-items:flex-end;gap:13px}' +
    '.cz-l.hide{display:none}' +
    '.cz-bub{max-width:230px;background:#fff;border:1px solid var(--line,rgba(26,26,26,.10));box-shadow:0 14px 34px -18px rgba(0,0,0,.4);border-radius:16px 16px 4px 16px;padding:12px 14px;font:14.5px/1.45 "DM Sans",system-ui,sans-serif;color:var(--text,#1a1a1a);position:relative;animation:czrise .4s ease both}' +
    '.cz-bub .x{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#fff;border:1px solid var(--line-2,rgba(26,26,26,.16));color:var(--muted,#6f6f6f);font-size:13px;line-height:18px;text-align:center;cursor:pointer}' +
    '@keyframes czrise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.cz-av{width:96px;height:96px;border-radius:50%;cursor:pointer;flex:0 0 auto;border:3px solid #fff;box-shadow:0 14px 38px -12px rgba(0,0,0,.5);position:relative;background:radial-gradient(circle at 32% 28%,var(--acc-2,#ff775f),var(--acc,#ff4929) 60%,var(--acc-deep,#cf3b1f));transition:transform .18s}' +
    '.cz-av:hover{transform:translateY(-2px) scale(1.03)}' +
    '.cz-av img{width:100%;height:100%;object-fit:cover;display:block;border-radius:50%}' +
    '.cz-av .fb{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:"Playfair Display",serif;font-weight:600;font-size:34px;border-radius:50%}' +
    '.cz-av .dot{position:absolute;right:1px;bottom:1px;width:17px;height:17px;border-radius:50%;background:var(--good,#2e9e5b);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);z-index:2}' +
    /* ---- centered "the agent appears" modal ---- */
    '.cz-modal{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(22,18,16,.55);backdrop-filter:blur(7px)}' +
    '.cz-modal.open{display:flex;animation:czfade .28s ease both}' +
    '@keyframes czfade{from{opacity:0}to{opacity:1}}' +
    '.cz-card{width:438px;max-width:100%;max-height:88vh;background:#fff;border-radius:24px;box-shadow:0 50px 110px -30px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;position:relative;animation:czcard .34s cubic-bezier(.2,.85,.3,1) both}' +
    '@keyframes czcard{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}' +
    '.cz-x{position:absolute;top:13px;right:15px;z-index:2;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.85);border:1px solid var(--line,rgba(26,26,26,.10));color:var(--muted,#6f6f6f);font-size:19px;line-height:1;cursor:pointer;display:grid;place-items:center}' +
    '.cz-x:hover{color:var(--text,#1a1a1a)}' +
    '.cz-hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 22px 20px;background:linear-gradient(180deg,var(--surface,#f6f6f6),#fff)}' +
    '.cz-bigav{width:138px;height:138px;border-radius:50%;flex:0 0 auto;position:relative;border:4px solid #fff;box-shadow:0 22px 50px -16px rgba(0,0,0,.55);background:radial-gradient(circle at 32% 28%,var(--acc-2,#ff775f),var(--acc,#ff4929) 60%,var(--acc-deep,#cf3b1f));animation:czpop .5s cubic-bezier(.2,.85,.3,1) both}' +
    '@keyframes czpop{from{opacity:0;transform:scale(.5)}60%{transform:scale(1.04)}to{opacity:1;transform:scale(1)}}' +
    '.cz-bigav img{width:100%;height:100%;object-fit:cover;display:block;border-radius:50%}' +
    '.cz-bigav .fb{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:"Playfair Display",serif;font-weight:600;font-size:52px;border-radius:50%}' +
    '.cz-bigav .dot{position:absolute;right:4px;bottom:4px;width:22px;height:22px;border-radius:50%;background:var(--good,#2e9e5b);border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.25);z-index:2}' +
    '.cz-nm{font-family:"Playfair Display",Georgia,serif;font-size:23px;margin-top:15px;color:var(--text,#1a1a1a)}' +
    '.cz-ss{font-size:12.5px;color:var(--acc-deep,#cf3b1f);display:inline-flex;align-items:center;gap:6px;margin-top:5px;letter-spacing:.02em}.cz-ss::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--good,#2e9e5b)}' +
    '.cz-thread{flex:1;overflow-y:auto;padding:18px 18px 6px;display:flex;flex-direction:column;gap:10px;min-height:80px}' +
    '.cz-m{max-width:88%}.cz-m.me{align-self:flex-end}.cz-m.ai{align-self:flex-start}' +
    '.cz-b{padding:11px 14px;border-radius:16px;font:14.5px/1.5 "DM Sans",system-ui,sans-serif}' +
    '.cz-m.ai .cz-b{background:var(--bubble-ai,#1a1a1a);border:1px solid rgba(0,0,0,.18);border-bottom-left-radius:4px;color:var(--bubble-ai-text,#f2f2f5)}' +
    '.cz-m.me .cz-b{background:var(--bubble-me,var(--acc,#ff4929));border:1px solid var(--acc-deep,#cf3b1f);border-bottom-right-radius:4px;color:var(--bubble-me-text,#fff)}' +
    '.cz-m a{color:var(--acc-deep,#cf3b1f);font-weight:600}' +
    '.cz-typ .cz-b{display:inline-flex;gap:4px}.cz-typ i{width:6px;height:6px;border-radius:50%;background:var(--muted,#6f6f6f);opacity:.5;animation:czbl 1.4s infinite}.cz-typ i:nth-child(2){animation-delay:.2s}.cz-typ i:nth-child(3){animation-delay:.4s}@keyframes czbl{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
    '.cz-work{font-size:13px;font-style:italic;opacity:.85}' +
    '.cz-cta{align-self:flex-start;margin-top:2px;display:inline-flex;align-items:center;gap:7px;background:var(--acc,#ff4929);color:#fff;border:none;border-radius:999px;padding:10px 17px;font:500 13.5px "DM Sans",sans-serif;cursor:pointer}' +
    '.cz-comp{display:flex;gap:9px;align-items:center;padding:14px 16px;border-top:1px solid var(--line,rgba(26,26,26,.10));background:var(--surface,#f6f6f6)}' +
    '.cz-comp input{flex:1;border:1px solid var(--line-2,rgba(26,26,26,.16));border-radius:999px;padding:11px 16px;font:14.5px "DM Sans",sans-serif;color:var(--text,#1a1a1a);outline:none;background:#fff;min-width:0}' +
    '.cz-comp input:focus{border-color:var(--acc,#ff4929)}' +
    '.cz-comp .s{width:40px;height:40px;border-radius:50%;flex:0 0 auto;background:var(--acc,#ff4929);border:none;cursor:pointer;display:grid;place-items:center}' +
    '.cz-comp .s:disabled{opacity:.5;cursor:default}' +
    /* ---- mobile ---- */
    '@media(max-width:620px){' +
      '.cz-l{right:16px;bottom:16px;gap:10px}.cz-av{width:60px;height:60px;border-width:2px}.cz-av .fb{font-size:22px}.cz-av .dot{width:12px;height:12px;border-width:2px;right:3px;bottom:3px}.cz-bub{max-width:180px;font-size:13.5px}' +
      '.cz-modal{padding:0;align-items:stretch;justify-content:stretch}' +
      '.cz-card{width:100%;max-width:100%;max-height:100%;height:100%;border-radius:0}' +
      '.cz-hero{padding:30px 18px 16px}.cz-bigav{width:112px;height:112px}.cz-bigav .fb{font-size:42px}.cz-nm{font-size:21px}' +
    '}' +
    '@media(prefers-reduced-motion:reduce){.cz-bub,.cz-modal,.cz-card,.cz-bigav{animation:none}.cz-typ i{animation:none}}';
  document.head.appendChild(css);

  var AV = '<img src="assets/img/concierge.png" alt="Tures concierge" onerror="if(this.src.indexOf(\'.png\')>-1){this.src=\'assets/img/concierge.jpg\';}else{this.style.display=\'none\';this.parentNode.querySelector(\'.fb\').style.display=\'grid\';}"><span class="fb" style="display:none">t<span style="color:#fff">✦</span></span>';

  var launch = document.createElement("div");
  launch.className = "cz-l";
  launch.innerHTML =
    '<div class="cz-bub" id="cz-bub" style="display:none">Planning something? I can take it from here. <span class="x" id="cz-bx" aria-label="Dismiss">×</span></div>' +
    '<button class="cz-av" id="cz-av" aria-label="Talk to your Tures concierge">' + AV + '<span class="dot"></span></button>';
  document.body.appendChild(launch);

  var modal = document.createElement("div");
  modal.className = "cz-modal";
  modal.innerHTML =
    '<div class="cz-card" role="dialog" aria-label="Tures concierge">' +
      '<button class="cz-x" id="cz-x" aria-label="Close">×</button>' +
      '<div class="cz-hero">' +
        '<span class="cz-bigav">' + AV + '<span class="dot"></span></span>' +
        '<div class="cz-nm">Tures</div>' +
        '<div class="cz-ss">your concierge · on 24/7</div>' +
      '</div>' +
      '<div class="cz-thread" id="cz-thread"></div>' +
      '<form class="cz-comp" id="cz-form"><input id="cz-in" autocomplete="off" placeholder="Describe a trip, or ask me anything…" aria-label="Message Tures"><button class="s" type="submit" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
    '</div>';
  document.body.appendChild(modal);

  var thread = document.getElementById("cz-thread"), input = document.getElementById("cz-in"),
      form = document.getElementById("cz-form"), sendBtn = form.querySelector(".s");
  var history = [], busy = false, greeted = false;
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function scroll(){ thread.scrollTop = thread.scrollHeight; }
  function bubble(html, who){ var m=document.createElement("div"); m.className="cz-m "+(who==="me"?"me":"ai"); m.innerHTML='<div class="cz-b">'+html+'</div>'; thread.appendChild(m); scroll(); return m; }
  var typingEl=null, typTimers=[];
  function typing(on){
    if(on){
      if(typingEl)return;
      typingEl=document.createElement("div"); typingEl.className="cz-m ai cz-typ";
      typingEl.setAttribute("aria-live","polite"); typingEl.setAttribute("role","status");
      typingEl.innerHTML='<div class="cz-b"><i></i><i></i><i></i></div>';
      thread.appendChild(typingEl); scroll();
      // Escalate the wait copy so a long action run (research/contact can take ~15s) never reads as stalled.
      typTimers.push(setTimeout(function(){ if(typingEl) typingEl.querySelector(".cz-b").innerHTML='<span class="cz-work">Still working on it…</span>'; }, 4500));
      typTimers.push(setTimeout(function(){ if(typingEl) typingEl.querySelector(".cz-b").innerHTML='<span class="cz-work">Almost there — pulling it together…</span>'; }, 11000));
    } else if(typingEl){ typingEl.remove(); typingEl=null; typTimers.forEach(clearTimeout); typTimers=[]; }
  }

  function open(){
    modal.classList.add("open");
    if(document.getElementById("cz-bub")) document.getElementById("cz-bub").style.display="none";
    // Warm the engine the moment the user shows intent, so the first message isn't a cold-start.
    try{ if(T && T.health) T.health(); }catch(_){}
    // re-trigger the "blow up / zoom in" each open
    var big = modal.querySelector(".cz-bigav");
    if(big){ big.style.animation="none"; void big.offsetWidth; big.style.animation=""; }
    setTimeout(function(){ input.focus(); }, 120);
    if(!greeted){ greeted=true; bubble("Hey — it's Tures. Tell me the shape of a trip — where, roughly when, what you're after — and I'll take it from there. Or ask me anything.", "ai"); }
  }
  function close(){ modal.classList.remove("open"); }
  document.getElementById("cz-av").addEventListener("click", open);
  document.getElementById("cz-x").addEventListener("click", close);
  modal.addEventListener("click", function(e){ if(e.target===modal) close(); });
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && modal.classList.contains("open")) close(); });

  // Loose hand-off: carry a seed sentence and let Plan start the conversation from it.
  function handoff(seed){ try{ if(seed) localStorage.setItem("tures.seed", seed); }catch(e){} location.href="plan.html"; }
  // READY hand-off: the conversation is DONE here — carry the finished brief so Plan builds it
  // straight away instead of asking everything over again (that re-ask was the "lobotomy").
  function handoffReady(brief){ try{ if(brief) localStorage.setItem("tures.readyBrief", brief); }catch(e){} location.href="plan.html"; }

  function send(text){
    if(busy || !text) return;
    bubble(esc(text), "me"); history.push({role:"user",content:text}); input.value=""; busy=true; sendBtn.disabled=true; typing(true);
    if(!(T && T.configured)){ typing(false); busy=false; sendBtn.disabled=false; bubble("Let me open this in the full planner.", "ai"); var b=document.createElement("button"); b.className="cz-cta"; b.textContent="Continue in Plan →"; b.onclick=function(){handoff(text);}; thread.appendChild(b); scroll(); return; }
    var ctx = F ? F.context() : undefined, uid = F ? F.uid() : undefined;
    var useAssist = window.turesAssistUi && window.turesAssistUi.isTripPlanning && !window.turesAssistUi.isTripPlanning(text);

    function attemptConverse(n){
      return T.converse(history.slice(-12), undefined, ctx, uid).catch(function(e){
        if(n>0) return new Promise(function(res,rej){ setTimeout(function(){ attemptConverse(n-1).then(res,rej); }, 1800); });
        throw e;
      });
    }
    function attemptAssist(n){
      return T.assist(history.slice(-10), text, ctx, uid).catch(function(e){
        if(n>0) return new Promise(function(res,rej){ setTimeout(function(){ attemptAssist(n-1).then(res,rej); }, 1800); });
        throw e;
      });
    }
    function finishAssist(r){
      typing(false); busy=false; sendBtn.disabled=false;
      var answer = (r && r.answer) || "Here's what I found.";
      bubble(esc(answer), "ai"); history.push({role:"assistant",content:answer});
      if(r && r.actions && r.actions.length && window.turesAssistUi){
        window.turesAssistUi.renderActions(thread, r.actions, { scroll: scroll });
      }
    }
    if(useAssist && T.assist){
      attemptAssist(1).then(finishAssist).catch(function(){
        typing(false); busy=false; sendBtn.disabled=false;
        bubble("I couldn't look that up just now. Try again, or open Plan for a trip.", "ai");
      });
      return;
    }
    attemptConverse(1).then(function(c){
      typing(false); busy=false; sendBtn.disabled=false;
      var reply=(c && c.reply) || "Tell me a little more.";
      bubble(esc(reply), "ai"); history.push({role:"assistant",content:reply});
      if(c && c.ready){ var brief = (typeof c.brief==="string" && c.brief.trim()) ? c.brief : text;
        var b=document.createElement("button"); b.className="cz-cta"; b.textContent="✦ Book it in Plan →"; b.onclick=function(){handoffReady(brief);}; thread.appendChild(b); scroll(); }
    }).catch(function(){ typing(false); busy=false; sendBtn.disabled=false;
      bubble("I couldn't reach the planner just now. Want to open the full Plan page.", "ai"); var b=document.createElement("button"); b.className="cz-cta"; b.textContent="Open Plan →"; b.onclick=function(){handoff(text);}; thread.appendChild(b); scroll(); });
  }
  form.addEventListener("submit", function(e){ e.preventDefault(); send(input.value.trim()); });

  // greeting bubble: show once per session, a beat after load
  document.getElementById("cz-bx").addEventListener("click", function(e){ e.stopPropagation(); document.getElementById("cz-bub").style.display="none"; try{ sessionStorage.setItem("tures.cz.greeted","1"); }catch(_){} });
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen=false; try{ seen = sessionStorage.getItem("tures.cz.greeted")==="1"; }catch(_){}
  if(!seen && !reduce){ setTimeout(function(){ if(!modal.classList.contains("open")) document.getElementById("cz-bub").style.display=""; }, 1800); }
})();
