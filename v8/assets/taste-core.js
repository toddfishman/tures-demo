/* Tures — Taste Engine core.
 * The model is shared across every visual treatment; only the *expression* changes.
 * A page provides render hooks and calls startTaste():
 *   required:  renderFingerprint(), renderConf(v), renderPlate(card), flingPlate(dir),
 *              showFinish(signature, behaviors[]), resetView()
 *   optional:  renderTags(tagList), onAdvance(qi)
 * The 6-axis Taste Print, confidence, tags, signature and persistence are identical
 * to the canonical engine, so any treatment stays compatible with the rest of the app
 * (same localStorage key: tures.tastePrint).
 */

/* 6 dimensions — also the fingerprint axes. 0..100, neutral 50. */
const DIMS = [
  { key:'pace',      label:'Pace',     left:'Languid',     right:'Packed',      v:50 },
  { key:'register',  label:'Register', left:'Hidden gem',  right:'Grand',       v:50 },
  { key:'energy',    label:'Energy',   left:'Solitude',    right:'Social',      v:50 },
  { key:'palate',    label:'Palate',   left:'Comfort',     right:'Adventurous', v:50 },
  { key:'planning',  label:'Plan',     left:'Spontaneous', right:'Scripted',    v:50 },
  { key:'aesthetic', label:'Look',     left:'Heritage',    right:'Modern',      v:50 },
];

const TIMG = function(name){ return 'assets/img/' + name + '-960.webp'; };

/* 6 plates — one per dimension. left/right shift dims and earn tags. */
const CARDS = [
  { dim:'register', prompt:'Where you sleep.', photo:TIMG('taste-register'),
    left:{ label:'The hidden gem',  sub:'No sign. The locals know.',      d:{register:-40,planning:-8}, tags:['Hidden over famous'] },
    right:{label:'The grand hotel', sub:'A doorman, a century-old bar.',  d:{register:+40},            tags:['Grand register'] } },
  { dim:'pace', prompt:'Your ideal day.', photo:TIMG('tulum'),
    left:{ label:'Languid', sub:'Long breakfast, nowhere to be.',  d:{pace:-40}, tags:['Unhurried'] },
    right:{label:'Packed',  sub:'Three things done before lunch.', d:{pace:+40}, tags:['Maximizer'] } },
  { dim:'aesthetic', prompt:'The room itself.', photo:TIMG('taste-aesthetic'),
    left:{ label:'Heritage',        sub:'Patina, history, heavy drapes.',     d:{aesthetic:-38}, tags:['Heritage spaces'] },
    right:{label:'Modern & spare',  sub:'Ten perfect things, nothing extra.', d:{aesthetic:+40}, tags:['Design-forward'] } },
  { dim:'palate', prompt:'The one great dinner.', photo:TIMG('taste-palate'),
    left:{ label:'Comfort',     sub:'One perfect dish, done right.',  d:{palate:-36,register:-6}, tags:['Dependable excellence'] },
    right:{label:'Adventurous', sub:'The fourteen-course tasting.',   d:{palate:+40},            tags:['Chef’s table'] } },
  { dim:'energy', prompt:'By midnight, you’d rather be…', photo:TIMG('taste-energy'),
    left:{ label:'A quiet corner', sub:'The person you came with.',           d:{energy:-40}, tags:['Travels close'] },
    right:{label:'A long table',   sub:'New friends collected as you go.',    d:{energy:+40}, tags:['Sociable'] } },
  { dim:'planning', prompt:'A free day.', photo:TIMG('taste-planning'),
    left:{ label:'Spontaneous', sub:'Decide when you get there.', d:{planning:-40,pace:-8}, tags:['Room to drift'] },
    right:{label:'Scripted',    sub:'The optimum, nothing missed.', d:{planning:+40,pace:+8}, tags:['Wants the optimum'] } },
];

let qi = 0;
let tagList = [];

function poleOf(k){ return DIMS.find(d=>d.key===k); }
function confFor(step){ return Math.min(0.94, 0.18 + step*0.127); }

function startTaste(){
  qi = 0; tagList = [];
  DIMS.forEach(d=> d.v = 50);
  renderFingerprint();
  renderConf(0.18);
  if(typeof renderTags === 'function') renderTags(tagList);
  renderPlate(CARDS[0]);
}

function choose(dir){
  if(qi >= CARDS.length) return;
  const c = CARDS[qi];
  const pick = dir === 'right' ? c.right : c.left;
  for(const k in pick.d){
    const dim = poleOf(k);
    dim.v = Math.max(4, Math.min(96, dim.v + pick.d[k]));
  }
  pick.tags.forEach(t=>{ if(tagList.indexOf(t) === -1) tagList.push(t); });

  renderFingerprint();
  renderConf(confFor(qi+1));
  if(typeof renderTags === 'function') renderTags(tagList);
  flingPlate(dir);

  setTimeout(()=>{
    qi++;
    if(typeof onAdvance === 'function') onAdvance(qi);
    if(qi >= CARDS.length){ finishTaste(); return; }
    renderPlate(CARDS[qi]);
  }, 460);
}

function buildSignature(){
  const reg=poleOf('register').v, pace=poleOf('pace').v, en=poleOf('energy').v, plan=poleOf('planning').v;
  const bits=[];
  bits.push(pace<50 ? 'an unhurried traveler' : 'a traveler who likes a full day');
  bits.push(reg>55 ? 'with a taste for the grand register' : (reg<45 ? 'who hunts the hidden over the famous' : 'comfortable across registers'));
  bits.push(en>55 ? 'energized by a room full of people' : (en<45 ? 'happiest in the quiet corner' : 'socially flexible'));
  return `You read as ${bits[0]}, ${bits[1]}, ${bits[2]}. ` +
    (plan>55 ? 'We’ll script the spine and leave room at the edges.' : 'We’ll set one strong anchor and protect the white space.');
}

function buildBehaviors(){
  const reg=poleOf('register').v, pace=poleOf('pace').v, pal=poleOf('palate').v, aes=poleOf('aesthetic').v;
  const bh=[];
  bh.push(reg>52 ? 'Book suite-tier rooms with a quiet outlook; apply Virtuoso amenities automatically.' : 'Favor characterful, well-located rooms over brand-name towers.');
  bh.push(pace<50 ? 'Hold your mornings — no 7am slots unless you ask.' : 'Stack the day efficiently — earliest sensible reservations.');
  bh.push(pal>52 ? 'Route you to the chef’s table and the dish locals queue for.' : 'Default to dependable excellence over experimental.');
  bh.push(aes>52 ? 'Lean modern & design-forward between equals.' : 'Lean heritage — the grand old room.');
  bh.push('Watch every booking and pre-stage a fix the moment the world wobbles.');
  return bh;
}

function finishTaste(){
  const sig = buildSignature();
  const behaviors = buildBehaviors();

  /* Persist the Taste Print — every live plan folds it in. */
  const reg=poleOf('register').v, aes=poleOf('aesthetic').v;
  const placeTypes=[];
  if(reg>55) placeTypes.push('grand');
  if(reg<45) placeTypes.push('boutique');
  if(aes>52) placeTypes.push('design-hotel','minimalist');
  const dims={}; DIMS.forEach(d=> dims[d.key]=d.v);
  const tastePrint = { placeTypes, tags:tagList.slice(), dims, signature:sig };
  try{ localStorage.setItem('tures.tastePrint', JSON.stringify(tastePrint)); }catch(_){}
  if(window.tures && tures.configured && tures.signedIn){ try{ tures.prefs.set({ tastePrint }); }catch(_){} }

  showFinish(sig, behaviors.concat(['Saved. Every plan you describe starts from this print.']));
}

function restart(){
  if(typeof resetView === 'function') resetView();
  startTaste();
}
