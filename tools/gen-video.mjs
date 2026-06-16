// Generate the dawn time-lapse via Replicate and drop it into v9/assets/video/dawn.mp4.
// Token is read from scaffolding/.env.local (gitignored) — never hardcoded, never committed.
// Run from the scaffolding dir:  node tools/gen-video.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
(function loadEnv() {
  try {
    fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).forEach((l) => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  } catch (e) {}
})();

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error('Missing REPLICATE_API_TOKEN (.env.local)'); process.exit(1); }

const PROMPT = `Cinematic, photorealistic time-lapse of a calm tropical beach transitioning from night to day, locked-off static wide shot. Opens on a serene moonlit night: a gently lapping turquoise sea under a star-filled sky, soft moonlight reflecting on rippling water, palm-tree silhouettes framing the edges, quiet white sand. A slow sunrise breaks: stars fade, the sky warms from deep navy through violet and coral to bright blue, the sun rises over the horizon casting golden light, the water turns vivid turquoise with sun glitter, palms and sand brighten into a lush, thriving daytime beach paradise. Smooth continuous time-lapse, gentle moving water and drifting clouds. No people, no text, no camera movement, no cuts. Ultra-realistic, cinematic color grade, 16:9.`;

// tried in order; first one that accepts the request is used (404/422 are free, only a real run bills)
const MODELS = ['google/veo-3-fast', 'google/veo-3', 'minimax/video-01', 'kwaivgi/kling-v2.1'];
const headers = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startOn(model) {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST', headers, body: JSON.stringify({ input: { prompt: PROMPT } }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  let pred = null, used = null;
  for (const m of MODELS) {
    const r = await startOn(m);
    if (r.ok) { pred = r.body; used = m; console.log('Started on', m, '· id', pred.id); break; }
    console.log('skip', m, '·', r.status, '·', (r.body && (r.body.detail || r.body.title)) || '');
  }
  if (!pred) { console.error('No model accepted the request.'); process.exit(2); }

  let status = pred.status, getUrl = pred.urls && pred.urls.get, out = pred.output, started = Date.now();
  while (['starting', 'processing'].includes(status)) {
    await sleep(5000);
    const b = await (await fetch(getUrl, { headers })).json();
    status = b.status; out = b.output;
    process.stdout.write(`\r${used} · ${status} · ${Math.round((Date.now() - started) / 1000)}s     `);
    if (status === 'failed' || status === 'canceled') { console.error('\n' + status + ':', b.error || ''); process.exit(3); }
    if (Date.now() - started > 9 * 60 * 1000) { console.error('\npolling timed out'); process.exit(4); }
  }
  console.log('\nstatus:', status);
  const url = Array.isArray(out) ? out[out.length - 1] : out;
  if (!url || typeof url !== 'string') { console.error('no output url', out); process.exit(5); }

  const dir = path.join(ROOT, 'v9', 'assets', 'video'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'dawn.mp4');
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log('SAVED', dest, (buf.length / 1e6).toFixed(1) + 'MB · via', used);
}
main().catch((e) => { console.error(e); process.exit(9); });
