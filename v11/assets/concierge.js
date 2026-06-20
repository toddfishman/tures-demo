/* ============================================================
   TURES v11 — corner concierge
   A humanized launcher (photo avatar + greeting bubble) bottom-right
   on every page; click to talk to Tures inline (live agent), with a
   'continue in Plan' hand-off. Suppressed on the Plan page (it IS the chat).
   Avatar: assets/img/concierge.jpg with a graceful t✦ fallback.
   ============================================================ */
(function () {
  if (window.__turesConcierge) return; window.__turesConcierge = true;
  var page = document.body.getAttribute("data-page") || "";
  if (page === "plan") return; // the whole Plan page is already the conversation
  var T = window.tures, F = window.turesFunnel;

  var css = document.createElement("style");
  css.textContent =
    '.cz-l{position:fixed;right:20px;bottom:20px;z-index:75;display:flex;align-items:flex-end;gap:11px}' +
    '.cz-l.hide{display:none}' +
    '.cz-bub{max-width:210px;background:#fff;border:1px solid var(--line,rgba(26,26,26,.10));box-shadow:0 14px 34px -18px rgba(0,0,0,.4);border-radius:16px 16px 4px 16px;padding:11px 13px;font:14px/1.45 "DM Sans",system-ui,sans-serif;color:var(--text,#1a1a1a);position:relative;animation:czrise .4s ease both}' +
    '.cz-bub .x{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#fff;border:1px solid var(--line-2,rgba(26,26,26,.16));color:var(--muted,#6f6f6f);font-size:13px;line-height:18px;text-align:center;cursor:pointer}' +
    '@keyframes czrise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.cz-av{width:64px;height:64px;border-radius:50%;cursor:pointer;flex:0 0 auto;overflow:hidden;border:2px solid #fff;box-shadow:0 10px 30px -10px rgba(0,0,0,.45);position:relative;background:radial-gradient(circle at 32% 28%,var(--acc-2,#ff775f),var(--acc,#ff4929) 60%,var(--acc-deep,#cf3b1f));transition:transform .18s}' +
    '.cz-av:hover{transform:translateY(-2px)}' +
    '.cz-av img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.cz-av .fb{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:"Playfair Display",serif;font-weight:600;font-size:24px}' +
    '.cz-av .dot{position:absolute;right:3px;bottom:3px;width:13px;height:13px;border-radius:50%;background:var(--good,#2e9e5b);border:2px solid #fff}' +
    '.cz-panel{position:fixed;right:20px;bottom:20px;z-index:76;width:362px;max-width:calc(100vw - 32px);height:min(540px,80vh);background:#fff;border:1px solid var(--line,rgba(26,26,26,.10));border-radius:18px;box-shadow:0 30px 70px -28px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden}' +
    '.cz-panel.open{display:flex;animation:czrise .25s ease both}' +
    '.cz-top{display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--line,rgba(26,26,26,.10));background:var(--surface,#f6f6f6)}' +
    '.cz-top .a{width:38px;height:38px;border-radius:50%;overflow:hidden;flex:0 0 auto;position:relative;background:radial-gradient(circle at 32% 28%,var(--acc-2,#ff775f),var(--acc,#ff4929) 60%,var(--acc-deep,#cf3b1f))}' +
    '.cz-top .a img{width:100%;height:100%;object-fit:cover}.cz-top .a .fb{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:"Playfair Display",serif;font-weight:600;font-size:16px}' +
    '.cz-top .nm{font-weight:600;font-size:14.5px}.cz-top .ss{font-size:11.5px;color:var(--acc-deep,#cf3b1f);display:flex;align-items:center;gap:5px}.cz-top .ss::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--good,#2e9e5b)}' +
    '.cz-top .x{margin-left:auto;background:none;border:none;color:var(--muted,#6f6f6f);font-size:22px;line-height:1;cursor:pointer}' +
    '.cz-thread{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px}' +
    '.cz-m{max-width:86%}.cz-m.me{align-self:flex-end}.cz-m.ai{align-self:flex-start}' +
    '.cz-b{padding:10px 13px;border-radius:15px;font:14px/1.5 "DM Sans",system-ui,sans-serif}' +
    '.cz-m.ai .cz-b{background:var(--surface,#f6f6f6);border:1px solid var(--line,rgba(26,26,26,.10));border-bottom-left-radius:4px;color:var(--text,#1a1a1a)}' +
    '.cz-m.me .cz-b{background:#fff;border:1px solid var(--line-2,rgba(26,26,26,.16));border-bottom-right-radius:4px}' +
    '.cz-m a{color:var(--acc-deep,#cf3b1f);font-weight:600}' +
    '.cz-typ .cz-b{display:inline-flex;gap:4px}.cz-typ i{width:6px;height:6px;border-radius:50%;background:var(--muted,#6f6f6f);opacity:.5;animation:czbl 1.4s infinite}.cz-typ i:nth-child(2){animation-delay:.2s}.cz-typ i:nth-child(3){animation-delay:.4s}@keyframes czbl{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
    '.cz-cta{align-self:flex-start;margin-top:2px;display:inline-flex;align-items:center;gap:7px;background:var(--acc,#ff4929);color:#fff;border:none;border-radius:999px;padding:9px 16px;font:500 13px "DM Sans",sans-serif;cursor:pointer}' +
    '.cz-comp{display:flex;gap:9px;align-items:center;padding:12px 13px;border-top:1px solid var(--line,rgba(26,26,26,.10));background:var(--surface,#f6f6f6)}' +
    '.cz-comp input{flex:1;border:1px solid var(--line-2,rgba(26,26,26,.16));border-radius:999px;padding:10px 15px;font:14px "DM Sans",sans-serif;color:var(--text,#1a1a1a);outline:none;background:#fff;min-width:0}' +
    '.cz-comp input:focus{border-color:var(--acc,#ff4929)}' +
    '.cz-comp .s{width:38px;height:38px;border-radius:50%;flex:0 0 auto;background:var(--acc,#ff4929);border:none;cursor:pointer;display:grid;place-items:center}' +
    '.cz-comp .s:disabled{opacity:.5;cursor:default}' +
    '@media(max-width:480px){.cz-panel{right:12px;left:12px;width:auto;bottom:12px}.cz-l{right:14px;bottom:14px}}' +
    '@media(prefers-reduced-motion:reduce){.cz-bub,.cz-panel{animation:none}.cz-typ i{animation:none}}';
  document.head.appendChild(css);

  var AV = '<img src="assets/img/concierge.png" alt="Tures concierge" onerror="if(this.src.indexOf(\'.png\')>-1){this.src=\'assets/img/concierge.jpg\';}else{this.style.display=\'none\';this.parentNode.querySelector(\'.fb\').style.display=\'grid\';}"><span class="fb" style="display:none">t<span style="color:#fff">✦</span></span>';

  var launch = document.createElement("div");
  launch.className = "cz-l";
  launch.innerHTML =
    '<div class="cz-bub" id="cz-bub" style="display:none">Evening — planning something. I can take it from here. <span class="x" id="cz-bx" aria-label="Dismiss">×</span></div>' +
    '<button class="cz-av" id="cz-av" aria-label="Talk to your Tures concierge">' + AV + '<span class="dot"></span></button>';
  document.body.appendChild(launch);

  var panel = document.createElement("div");
  panel.className = "cz-panel";
  panel.innerHTML =
    '<div class="cz-top"><span class="a">' + AV + '</span><div><div class="nm">Tures</div><div class="ss">your concierge · on 24/7</div></div><button class="x" id="cz-x" aria-label="Close">×</button></div>' +
    '<div class="cz-thread" id="cz-thread"></div>' +
    '<form class="cz-comp" id="cz-form"><input id="cz-in" autocomplete="off" placeholder="Ask Tures, or describe a trip…" aria-label="Message Tures"><button class="s" type="submit" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>';
  document.body.appendChild(panel);

  var thread = document.getElementById("cz-thread"), input = document.getElementById("cz-in"),
      form = document.getElementById("cz-form"), sendBtn = form.querySelector(".s");
  var history = [], busy = false, greeted = false;
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function scroll(){ thread.scrollTop = thread.scrollHeight; }
  function bubble(html, who){ var m=document.createElement("div"); m.className="cz-m "+(who==="me"?"me":"ai"); m.innerHTML='<div class="cz-b">'+html+'</div>'; thread.appendChild(m); scroll(); return m; }
  var typingEl=null;
  function typing(on){ if(on){ if(typingEl)return; typingEl=document.createElement("div"); typingEl.className="cz-m ai cz-typ"; typingEl.innerHTML='<div class="cz-b"><i></i><i></i><i></i></div>'; thread.appendChild(typingEl); scroll(); } else if(typingEl){ typingEl.remove(); typingEl=null; } }

  function open(){ panel.classList.add("open"); launch.classList.add("hide"); input.focus();
    if(!greeted){ greeted=true; bubble("Evening. Tell me the shape of a trip — where, roughly when, what you are after — and I will take it from there. Or ask me anything.", "ai"); } }
  function close(){ panel.classList.remove("open"); launch.classList.remove("hide"); }
  document.getElementById("cz-av").addEventListener("click", open);
  document.getElementById("cz-x").addEventListener("click", close);

  function handoff(seed){ try{ if(seed) localStorage.setItem("tures.seed", seed); }catch(e){} location.href="plan.html"; }

  function send(text){
    if(busy || !text) return;
    bubble(esc(text), "me"); history.push({role:"user",content:text}); input.value=""; busy=true; sendBtn.disabled=true; typing(true);
    if(!(T && T.configured)){ typing(false); busy=false; sendBtn.disabled=false; var m=bubble("Let me open this in the full planner.", "ai"); var b=document.createElement("button"); b.className="cz-cta"; b.textContent="Continue in Plan →"; b.onclick=function(){handoff(text);}; thread.appendChild(b); scroll(); return; }
    var ctx = F ? F.context() : undefined, uid = F ? F.uid() : undefined;
    T.converse(history.slice(-12), undefined, ctx, uid).then(function(c){
      typing(false); busy=false; sendBtn.disabled=false;
      var reply=(c && c.reply) || "Tell me a little more.";
      bubble(esc(reply), "ai"); history.push({role:"assistant",content:reply});
      if(c && c.ready){ var brief = (typeof c.brief==="string") ? c.brief : text;
        var b=document.createElement("button"); b.className="cz-cta"; b.textContent="✦ Book it in Plan →"; b.onclick=function(){handoff(brief);}; thread.appendChild(b); scroll(); }
    }).catch(function(){ typing(false); busy=false; sendBtn.disabled=false;
      var m=bubble("I could not reach the planner just now. Want to open the full Plan page.", "ai"); var b=document.createElement("button"); b.className="cz-cta"; b.textContent="Open Plan →"; b.onclick=function(){handoff(text);}; thread.appendChild(b); scroll(); });
  }
  form.addEventListener("submit", function(e){ e.preventDefault(); send(input.value.trim()); });

  // greeting bubble: show once per session, a beat after load
  document.getElementById("cz-bx").addEventListener("click", function(e){ e.stopPropagation(); document.getElementById("cz-bub").style.display="none"; try{ sessionStorage.setItem("tures.cz.greeted","1"); }catch(_){} });
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen=false; try{ seen = sessionStorage.getItem("tures.cz.greeted")==="1"; }catch(_){}
  if(!seen && !reduce){ setTimeout(function(){ if(!panel.classList.contains("open")) document.getElementById("cz-bub").style.display=""; }, 1800); }
})();
