#!/usr/bin/env node
/* Maneka Sanjay Gandhi's signature: one master, every picture made from it.

     node scripts/build-signature.js            write them all  (needs Playwright and a Chrome)
     node scripts/build-signature.js --check    exit 1 if any is not made from the master

   Owner, 26 Nov 2026, with MG-Sign-Vector-Clean.svg: "clean sign. pls use
   this everywhere. remove all other versions of sign from every place.
   surgical removal", then "do an enterprise grade implementation and update".

   The master is scripts/source/MG-Sign-Vector-Clean.svg, exactly as it came.
   Every other signature is made from it here, at the size and shape the
   place that draws it has always used, so no layout moves:

     lib/letter-art/signature.png              letters, receipts and UCs (lib/letters.js,
                                               lib/fc-docs.js), 1374 x 374 at 2x
     assets/certificates/signature.png         certificates on screen, 252 x 73 at 2x
     assets/certificates/signature-print.png   certificates and cards, printed, 252 x 73 at 6x
     assets/certificates/signature.svg         the cards online, a vector, 1512 x 438
     scripts/source/PFA-Certificate.html       the certificate design's own signature

   Each picture is the master's ink alone: its white ground taken out, cut to
   the ink with a little room, and set in the middle of its box, in the
   master's own colour. The older signatures, in these files and in the
   design, are gone; the signature collection's earlier versions are retired
   (lib/signature-vault.js RETIRED_BEFORE). test/signature-master.test.js
   holds every file to the master. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const MASTER = path.join(ROOT, 'scripts', 'source', 'MG-Sign-Vector-Clean.svg');
const DESIGN = path.join(ROOT, 'scripts', 'source', 'PFA-Certificate.html');
const STAMP = path.join(ROOT, 'lib', 'letter-art', 'signature.json');
/* the room around the ink, as a share of its width */
const PAD = 0.02;
const PNGS = [
  { file: 'lib/letter-art/signature.png', w: 1374, h: 374, scale: 2 },
  { file: 'assets/certificates/signature.png', w: 252, h: 73, scale: 2 },
  { file: 'assets/certificates/signature-print.png', w: 252, h: 73, scale: 6 }
];
const SVG_OUT = 'assets/certificates/signature.svg';

/* The master's ink: its one path and colour. Anything else in it (the white
   ground, the title) is left behind. */
function inkOf(svgText) {
  const s = String(svgText || '');
  const paths = [...s.matchAll(/<path\b([^>]*)\/?>/g)].map((m) => m[1]);
  if (paths.length !== 1) throw new Error(`build-signature: the master should hold one path, it holds ${paths.length}`);
  const d = (/\sd="([^"]+)"/.exec(paths[0]) || [])[1];
  const fill = (/\sfill="(#[0-9a-fA-F]{3,8})"/.exec(paths[0]) || [])[1];
  if (!d || !fill) throw new Error('build-signature: the master path has no shape or no colour');
  return { d, fill: fill.toLowerCase() };
}
const masterHash = (text) => crypto.createHash('sha256').update(text).digest('hex');

function vector(ink, box, w, h, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${label ? ` aria-label="${label}"` : ''}>`
    + `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${box}" preserveAspectRatio="xMidYMid meet"><path fill="${ink.fill}" d="${ink.d}"/></svg></svg>`;
}

/* The design's signature, replaced by the master's ink in the same box. */
function designWith(html, ink, box) {
  const at = html.indexOf('<div class="signature">');
  if (at < 0) throw new Error('build-signature: the certificate design has no signature');
  const open = html.indexOf('<svg', at);
  const close = html.indexOf('</svg>', open);
  if (open < 0 || close < 0) throw new Error('build-signature: the design\'s signature has no picture');
  const mine = `<svg viewBox="${box}" xmlns="http://www.w3.org/2000/svg" aria-label="Maneka Sanjay Gandhi signature"><path fill="${ink.fill}" d="${ink.d}"></path></svg>`;
  return html.slice(0, open) + mine + html.slice(close + '</svg>'.length);
}

async function measure(chromium, ink) {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage();
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 984 298"><path id="p" fill="${ink.fill}" d="${ink.d}"/></svg>`);
  const b = await page.evaluate(() => { const r = document.getElementById('p').getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await browser.close();
  const pad = b.w * PAD;
  const r = (n) => Math.round(n * 100) / 100;
  return `${r(b.x - pad)} ${r(b.y - pad)} ${r(b.w + 2 * pad)} ${r(b.h + 2 * pad)}`;
}

async function main() {
  const check = process.argv.includes('--check');
  const masterText = fs.readFileSync(MASTER, 'utf8');
  const ink = inkOf(masterText);
  const hash = masterHash(masterText);
  if (check) {
    const stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
    const bad = [];
    if (stamp.master !== hash) bad.push('the master has changed since the pictures were made');
    const svg = fs.readFileSync(path.join(ROOT, SVG_OUT), 'utf8');
    if (!svg.includes(`d="${ink.d}"`)) bad.push(`${SVG_OUT} is not the master's`);
    if (!fs.readFileSync(DESIGN, 'utf8').includes(`d="${ink.d}"`)) bad.push('the certificate design\'s signature is not the master\'s');
    for (const p of PNGS) {
      const sum = masterHash(fs.readFileSync(path.join(ROOT, p.file)));
      if (stamp.files[p.file] !== sum) bad.push(`${p.file} was not made from the master`);
    }
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
    console.log('every signature is the master\'s');
    return;
  }
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }
  const box = await measure(chromium, ink);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-sig-'));
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const files = {};
  for (const p of PNGS) {
    const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: p.scale });
    const html = path.join(dir, 'sig.html');
    fs.writeFileSync(html, `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${vector(ink, box, p.w, p.h)}</body></html>`);
    await page.goto('file://' + html);
    const out = path.join(ROOT, p.file);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: p.w, height: p.h } });
    files[p.file] = masterHash(fs.readFileSync(out));
    console.log('wrote', p.file, `${p.w * p.scale} x ${p.h * p.scale}`);
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, SVG_OUT), vector(ink, box, 1512, 438, 'Maneka Sanjay Gandhi signature') + '\n');
  console.log('wrote', SVG_OUT);
  fs.writeFileSync(DESIGN, designWith(fs.readFileSync(DESIGN, 'utf8'), ink, box));
  console.log('wrote the master\'s signature into', path.relative(ROOT, DESIGN));
  fs.writeFileSync(STAMP, JSON.stringify({ master: hash, box, colour: ink.fill, files }, null, 2) + '\n');
  console.log('wrote', path.relative(ROOT, STAMP));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { inkOf, vector, designWith, PNGS, SVG_OUT, MASTER, STAMP, masterHash };
