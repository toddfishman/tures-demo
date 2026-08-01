/* Tures — your personal concierge.
 * A named, customizable concierge the traveller sets up once (assets concierge.html), then it
 * lives tastefully in a corner of every page and answers questions about whatever screen they're
 * on. Identity is a parametric SVG portrait (presentation / skin / hair) so "make them yours" is
 * real and instant — no photo likeness. Config persists in localStorage 'tures.concierge'.
 *
 * Public API on window.turesConcierge:
 *   get() / set(cfg) / clear()      — the saved config (or null)
 *   avatar(cfg, size)              — an <svg> portrait string
 *   OPTIONS                        — the choice sets the setup page renders
 *   mountPresence()                — inject the corner presence (called by menu.js)
 */
(function () {
  var KEY = 'tures.concierge';

  var SKINS = [
    { id: 'porcelain', v: '#f1d6c0', sh: '#e3b8a3' },
    { id: 'fair',      v: '#e8c0a0', sh: '#d3a484' },
    { id: 'warm',      v: '#d3a273', sh: '#bb885a' },
    { id: 'tan',       v: '#bd8453', sh: '#a06c3f' },
    { id: 'amber',     v: '#a3673b', sh: '#854f29' },
    { id: 'deep',      v: '#7c4a2b', sh: '#5f371e' },
    { id: 'ebony',     v: '#5a3520', sh: '#432515' }
  ];
  var HAIR_STYLES = [
    { id: 'cropped', label: 'Cropped' },
    { id: 'swept',   label: 'Swept' },
    { id: 'bun',     label: 'Bun' },
    { id: 'long',    label: 'Long' },
    { id: 'coily',   label: 'Coily' },
    { id: 'bald',    label: 'Clean' }
  ];
  var HAIR_COLORS = [
    { id: 'black',  v: '#241f1c' },
    { id: 'brown',  v: '#553a27' },
    { id: 'auburn', v: '#7c3c1f' },
    { id: 'blonde', v: '#c6a25a' },
    { id: 'silver', v: '#bdb6a8' }
  ];
  var ATTIRE = [
    { id: 'charcoal', v: '#2c2a2e', label: 'Charcoal' },
    { id: 'navy',     v: '#26304a', label: 'Navy' },
    { id: 'oxblood',  v: '#4a2026', label: 'Oxblood' },
    { id: 'camel',    v: '#8a6a3e', label: 'Camel' }
  ];
  var TONES = [
    { id: 'warm',    label: 'Warm & reassuring' },
    { id: 'crisp',   label: 'Crisp & efficient' },
    { id: 'playful', label: 'Playful & candid' }
  ];
  var NAME_IDEAS = ['Marlowe', 'Sable', 'August', 'Vera', 'Cassian', 'Imani', 'Theo', 'Lena', 'Rumi', 'Soraya'];

  var DEFAULT = { name: '', skin: 'warm', hair: 'swept', hairColor: 'brown', attire: 'charcoal', tone: 'warm' };

  function byId(arr, id, fallback) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return fallback || arr[0]; }

  function get() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return (c && c.skin) ? c : null; } catch (e) { return null; }
  }
  function set(cfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} return cfg; }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* ---- parametric portrait ----------------------------------------------------
     A medallion: parchment ground, a head/shoulders bust in the chosen skin tone with
     serene features and a hair silhouette over the top. Refined, not cartoonish. */
  function hairBack(style, color) {
    if (style === 'bald') return '';
    var cap = '<ellipse cx="50" cy="40" rx="21.5" ry="22.5" fill="' + color + '"/>';
    if (style === 'cropped') return '<ellipse cx="50" cy="41" rx="19.5" ry="20.5" fill="' + color + '"/>';
    if (style === 'swept')   return cap + '<path d="M30 40 q-3 -20 22 -22 q-14 6 -16 26 z" fill="' + color + '"/>';
    if (style === 'bun')     return cap + '<circle cx="50" cy="18" r="7.5" fill="' + color + '"/>';
    if (style === 'long')    return cap + '<path d="M29 38 q-4 26 3 44 l10 0 q-9 -22 -4 -44 z" fill="' + color + '"/><path d="M71 38 q4 26 -3 44 l-10 0 q9 -22 4 -44 z" fill="' + color + '"/>';
    if (style === 'coily')   return '<ellipse cx="50" cy="37" rx="25" ry="24" fill="' + color + '"/>';
    return cap;
  }
  function avatar(cfg, size) {
    cfg = cfg || DEFAULT;
    var s = byId(SKINS, cfg.skin, SKINS[2]);
    var hair = byId(HAIR_COLORS, cfg.hairColor, HAIR_COLORS[1]).v;
    var cloth = byId(ATTIRE, cfg.attire, ATTIRE[0]).v;
    size = size || 64;
    return '<svg class="cc-portrait" viewBox="0 0 100 100" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<defs><clipPath id="ccclip"><circle cx="50" cy="50" r="49"/></clipPath>' +
      '<linearGradient id="ccbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe4cd"/><stop offset="1" stop-color="#e2d3b6"/></linearGradient></defs>' +
      '<g clip-path="url(#ccclip)">' +
        '<rect width="100" height="100" fill="url(#ccbg)"/>' +
        '<path d="M16 100 q4 -28 34 -28 q30 0 34 28 z" fill="' + cloth + '"/>' +           /* shoulders */
        '<path d="M50 72 v-9 h0 v9 z M44 60 h12 v10 q-6 4 -12 0 z" fill="' + s.sh + '"/>' + /* neck shade */
        '<rect x="44" y="56" width="12" height="15" rx="5" fill="' + s.v + '"/>' +          /* neck */
        hairBack(cfg.hair, hair) +
        '<ellipse cx="50" cy="45" rx="17" ry="19.5" fill="' + s.v + '"/>' +                 /* face */
        '<path d="M41 44 q3 -2.5 6 0" fill="none" stroke="' + s.sh + '" stroke-width="1.5" stroke-linecap="round"/>' + /* serene eyes */
        '<path d="M53 44 q3 -2.5 6 0" fill="none" stroke="' + s.sh + '" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M46.5 53 q3.5 2 7 0" fill="none" stroke="' + s.sh + '" stroke-width="1.3" stroke-linecap="round"/>' + /* soft smile */
      '</g>' +
      '<circle cx="50" cy="50" r="48.5" fill="none" stroke="#c8a24a" stroke-width="1.4" opacity="0.85"/>' +
    '</svg>';
  }

  /* ---- what screen am I on? (so the concierge can speak to it) ---------------- */
  function pageContext() {
    var here = (location.pathname.split('/').pop() || 'index.html').split('?')[0].split('#')[0];
    var MAP = {
      '01-landing.html': 'the overview of what Tures is — an executor that books the whole trip, not a search tool',
      '02-taste-engine.html': 'the Taste Engine, which learns the traveller\'s taste so picks match them',
      '03-paste-trip.html': 'the planning chat, where they describe a trip and Tures books it',
      '04-connections.html': 'the Tures Vault, where payment cards and travel documents are stored, tokenized by VGS',
      '05-execution.html': 'the live execution demo, watching Tures book a trip step by step',
      '06-hiccup-handler.html': 'the Hiccup Handler, which watches trips and fixes disruptions proactively',
      '07-itinerary.html': 'My Trips — their booked and planned trips with lodging, flights, reservations and tips',
      '08-concierge.html': 'the Concierge plan and what the always-on service includes',
      'pricing.html': 'pricing — Free, Per trip, and the Concierge subscription',
      'about.html': 'about Tures and how it differs from other travel tools'
    };
    return MAP[here] || 'the Tures site';
  }

  /* ---- the corner presence + contextual mini-chat ---------------------------- */
  function mountPresence() {
    if (window.__ccPresence) return; window.__ccPresence = true;
    var cfg = get();
    if (!cfg) return;                       // no concierge set up yet → nothing to show
    var here = (location.pathname.split('/').pop() || 'index.html').split('?')[0].split('#')[0];
    // The planning chat IS the concierge; the cover/write/setup carry their own world.
    if (['index.html', 'write.html', 'concierge.html', '03-paste-trip.html', ''].indexOf(here) > -1) return;
    var inSub = /\/(auth|legal)\//.test(location.pathname);
    var base = inSub ? '../' : '';

    var dock = document.createElement('div');
    dock.className = 'cc-dock';
    dock.innerHTML =
      '<button class="cc-fab" type="button" aria-label="Ask ' + esc(cfg.name) + '">' + avatar(cfg, 52) +
        '<span class="cc-fab-name">' + esc(cfg.name) + '</span></button>' +
      '<div class="cc-panel" role="dialog" aria-label="' + esc(cfg.name) + '">' +
        '<div class="cc-panel-head">' + avatar(cfg, 34) +
          '<div class="cc-ph-meta"><div class="cc-ph-name">' + esc(cfg.name) + '</div>' +
          '<div class="cc-ph-sub">your concierge</div></div>' +
          '<button class="cc-x" type="button" aria-label="Close">&times;</button></div>' +
        '<div class="cc-log" id="ccLog"></div>' +
        '<form class="cc-compose"><input id="ccInput" type="text" autocomplete="off" placeholder="Ask ' + esc(cfg.name) + ' about this page…"><button type="submit" aria-label="Send">↑</button></form>' +
      '</div>';
    document.body.appendChild(dock);

    var fab = dock.querySelector('.cc-fab');
    var panel = dock.querySelector('.cc-panel');
    var log = dock.querySelector('#ccLog');
    var input = dock.querySelector('#ccInput');
    var opened = false;
    function open() {
      dock.classList.add('open');
      if (!opened) { opened = true; ccSay('Hi — I\'m ' + cfg.name + '. You\'re on ' + pageContext() + '. Ask me anything about it.', 'c'); }
      setTimeout(function () { input.focus(); }, 60);
    }
    function close() { dock.classList.remove('open'); }
    fab.addEventListener('click', function () { dock.classList.contains('open') ? close() : open(); });
    dock.querySelector('.cc-x').addEventListener('click', close);

    function ccSay(text, who) {
      var b = document.createElement('div'); b.className = 'cc-msg cc-' + who;
      b.innerHTML = text.replace(/</g, '&lt;');
      log.appendChild(b); log.scrollTop = log.scrollHeight; return b;
    }
    function answer(q) {
      var ctx = 'You are ' + cfg.name + ', the traveller\'s personal Tures concierge. They are currently on ' + pageContext() + '. Answer briefly and warmly, in first person, about THIS page or their trip. Tone: ' + cfg.tone + '.';
      if (window.tures && tures.configured && tures.converse) {
        var t = ccSay('…', 'c'); t.classList.add('cc-typing');
        tures.converse([{ role: 'user', content: q }], undefined, ctx, (window.turesUid && turesUid()) || undefined)
          .then(function (r) { t.remove(); ccSay((r && r.reply) || 'I\'m here — ask me anything about this page.', 'c'); })
          .catch(function () { t.remove(); ccSay(fallback(q), 'c'); });
      } else {
        setTimeout(function () { ccSay(fallback(q), 'c'); }, 360);
      }
    }
    function fallback() {
      return 'You\'re looking at ' + pageContext() + '. I can walk you through it, or jump us into planning a trip — just say the word.';
    }
    dock.querySelector('.cc-compose').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim(); if (!q) return;
      ccSay(q, 'me'); input.value = ''; answer(q);
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }

  window.turesConcierge = {
    get: get, set: set, clear: clear, avatar: avatar, pageContext: pageContext, mountPresence: mountPresence,
    OPTIONS: { SKINS: SKINS, HAIR_STYLES: HAIR_STYLES, HAIR_COLORS: HAIR_COLORS, ATTIRE: ATTIRE, TONES: TONES, NAME_IDEAS: NAME_IDEAS, DEFAULT: DEFAULT }
  };
})();
