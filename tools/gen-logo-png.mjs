// Render the gold t✦ures wordmark to a transparent, high-res PNG for video / compositing.
// Uses the real Cormorant Garamond + the brass foil gradient. Run from scaffolding:
//   node tools/gen-logo-png.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const ROOT = path.resolve(process.cwd());
GlobalFonts.registerFromPath(path.join(ROOT, 'tools', 'fonts', 'CormorantGaramond.ttf'), 'Cormorant Garamond');

const W = 2600, H = 760, baseY = 540;          // canvas + baseline
const big = 440, small = Math.round(big * 0.5); // wordmark + superscript spark
const rise = Math.round(big * 0.42), track = Math.round(big * 0.018);

const c = createCanvas(W, H);
const x = c.getContext('2d');
x.textBaseline = 'alphabetic';
const setBig = () => (x.font = `600 ${big}px "Cormorant Garamond"`);
const setSmall = () => (x.font = `600 ${small}px "Cormorant Garamond"`);

setBig(); const wT = x.measureText('t').width, wUres = x.measureText('ures').width;
setSmall(); const wSpark = x.measureText('✦').width;
const total = wT + track + wSpark + track + wUres;
let cx = (W - total) / 2;

const g = x.createLinearGradient(cx, 0, cx + total, 0);
[[0, '#9c7a2e'], [0.26, '#e6c873'], [0.46, '#fff3c8'], [0.60, '#c8a24a'], [0.78, '#e6c873'], [1, '#8a6a26']]
  .forEach(([o, col]) => g.addColorStop(o, col));
x.fillStyle = g;

setBig();   x.fillText('t', cx, baseY);            cx += wT + track;
setSmall(); x.fillText('✦', cx, baseY - rise);     cx += wSpark + track;
setBig();   x.fillText('ures', cx, baseY);

const out = path.join(ROOT, 'v9', 'assets', 'logo.png');
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('wrote', out, '·', W + 'x' + H, '· wordmark ~' + Math.round(total) + 'px wide');
