// Render the v12 t✦ures wordmark to transparent, hi-res PNG + SVG.
// Matches site.js + v12.css: Playfair Display 600, ink text, vermilion spark.
// Run from repo root: node tools/gen-logo-png.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(import.meta.dirname, '..');
const FONT = path.join(ROOT, 'tools', 'fonts', 'PlayfairDisplay-SemiBold.ttf');
GlobalFonts.registerFromPath(FONT, 'Playfair Display');

const INK = '#1a1a1a';
const SPARK = '#ff4929';
const WHITE = '#ffffff';

function sparkPath(cx, cy, R) {
  const inr = R * 0.18;
  return [
    `M ${cx} ${cy - R}`,
    `L ${cx + inr} ${cy - inr}`,
    `L ${cx + R} ${cy}`,
    `L ${cx + inr} ${cy + inr}`,
    `L ${cx} ${cy + R}`,
    `L ${cx - inr} ${cy + inr}`,
    `L ${cx - R} ${cy}`,
    `L ${cx - inr} ${cy - inr}`,
    'Z',
  ].join(' ');
}

function drawSpark(ctx, cx, cy, R, fill) {
  ctx.beginPath();
  ctx.fillStyle = fill;
  const inr = R * 0.18;
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx + inr, cy - inr);
  ctx.lineTo(cx + R, cy);
  ctx.lineTo(cx + inr, cy + inr);
  ctx.lineTo(cx, cy + R);
  ctx.lineTo(cx - inr, cy + inr);
  ctx.lineTo(cx - R, cy);
  ctx.lineTo(cx - inr, cy - inr);
  ctx.closePath();
  ctx.fill();
}

function layout({ textColor, sparkColor, big, padX, padY }) {
  const letterSpacing = 0.5 * (big / 32);
  const W = 2800;
  const H = 820;
  const baseY = padY + big * 0.78;

  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.textBaseline = 'alphabetic';
  x.font = `600 ${big}px "Playfair Display"`;

  const wT = x.measureText('t').width;
  const wUres = x.measureText('ures').width;
  const sparkR = Math.round(big * 0.14);
  const sparkW = sparkR * 2;
  const gap = Math.round(big * 0.04);
  const total = wT + gap + sparkW + gap + wUres + letterSpacing * 4;

  let cx = (W - total) / 2;

  const tX = cx;
  cx += wT + gap + letterSpacing;
  const sparkCx = cx + sparkR;
  const sparkCy = baseY - Math.round(big * 0.48);
  cx += sparkW + gap + letterSpacing;
  const uresX = cx;

  x.fillStyle = textColor;
  x.fillText('t', tX, baseY);
  drawSpark(x, sparkCx, sparkCy, sparkR, sparkColor);
  x.fillText('ures', uresX, baseY);

  const trimTop = Math.max(0, baseY - big - padY);
  const trimH = Math.min(H - trimTop, big + padY * 2);
  const trimW = Math.min(W, total + padX * 2);
  const trimX = Math.max(0, (W - trimW) / 2);

  const scale = 120 / trimH;
  const svgW = Math.round(trimW * scale);
  const svgH = 120;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" role="img" aria-label="Tures">`,
    '  <defs>',
    '    <style>',
    "      @font-face{font-family:'Playfair Display';font-style:normal;font-weight:600;",
    `      src:url('data:font/ttf;base64,${fs.readFileSync(FONT).toString('base64')}') format('truetype');}`,
    '      .wm{font-family:"Playfair Display",Georgia,serif;font-weight:600;letter-spacing:0.015em}',
    '    </style>',
    '  </defs>',
    `  <g transform="translate(${(-trimX * scale).toFixed(2)},${(-trimTop * scale).toFixed(2)}) scale(${scale.toFixed(6)})">`,
    `    <text class="wm" x="${tX.toFixed(2)}" y="${baseY.toFixed(2)}" font-size="${big}" fill="${textColor}">t</text>`,
    `    <path fill="${sparkColor}" d="${sparkPath(sparkCx, sparkCy, sparkR)}"/>`,
    `    <text class="wm" x="${uresX.toFixed(2)}" y="${baseY.toFixed(2)}" font-size="${big}" fill="${textColor}">ures</text>`,
    '  </g>',
    '</svg>',
  ].join('\n');

  return {
    buffer: c.toBuffer('image/png', { compressionLevel: 6 }),
    crop: { x: trimX, y: trimTop, w: trimW, h: trimH },
    svg,
    meta: { total: Math.round(total), big, svgW, svgH },
  };
}

async function cropPng(fullBuf, crop, outPath) {
  const img = await loadImage(fullBuf);
  const w = Math.round(crop.w);
  const h = Math.round(crop.h);
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  fs.writeFileSync(outPath, out.toBuffer('image/png'));
}

async function writeVariant(name, svgName, opts) {
  const big = opts.big ?? 880; // ~2260px wordmark in PNG — hi-res for video/print
  const padX = opts.padX ?? 120;
  const padY = opts.padY ?? 90;
  const { buffer, crop, svg, meta } = layout({ ...opts, big, padX, padY });
  const outDir = path.join(ROOT, 'v12', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const pngOut = path.join(outDir, name);
  const svgOut = path.join(outDir, svgName);
  await cropPng(buffer, crop, pngOut);
  fs.writeFileSync(svgOut, svg);
  console.log('wrote', pngOut, `· ${crop.w}x${crop.h}`, `· wordmark ~${meta.total}px wide`);
  console.log('wrote', svgOut, `· ${meta.svgW}x${meta.svgH}`);
}

await writeVariant('logo.png', 'logo.svg', { textColor: INK, sparkColor: SPARK });
await writeVariant('logo-white.png', 'logo-white.svg', { textColor: WHITE, sparkColor: SPARK });
