#!/usr/bin/env node
/* The internship certificate's artwork, made from the owner's design.

     node scripts/build-certificate-art.js     (needs Playwright and a Chrome)

   Owner, 11 Nov 2026, with PFA-Certificate.html: "this is the internship
   certificate btw", then "font has to be marcellus". The design is kept as
   it came (scripts/source/PFA-Certificate.html, not published), but for its
   title tag's long dash, a hyphen there. This draws
   it in a browser, in the site's own Marcellus, at twice its 1120 x 792
   (A4 landscape exactly), with its three blanks empty, and writes
   assets/certificates/completion.webp. assets/certificate.js draws the name,
   the date of completion and the certificate ID onto it, where the design
   puts them.

   Changed from the design, and only these:
     the course     "the online class" / the placeholder course become
                    "the" / "Remote Internship", and the subtitle "Learning
                    Programme" becomes "Remote Internship"
     the rule       the two short lines either side of the star, taken out
                    (site rule: no dash-shaped mark anywhere)
     the paper      pure white, where the design had a warm off-white
   It prints where each blank sits, so assets/certificate.js can be checked
   against the design. */

'use strict';
/* global document, getComputedStyle */ /* the measuring runs in the page */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'source', 'PFA-Certificate.html');
const OUT = path.join(ROOT, 'assets', 'certificates', 'completion.webp');

function design(blank) {
  let s = fs.readFileSync(SRC, 'utf8');
  const font = (file) => 'file://' + path.join(ROOT, 'fonts', file);
  s = s.replace(/<link rel="preconnect"[^>]*>/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
  s = s.replace('<style>', `<style>@font-face{font-family:"Marcellus";src:url("${font('marcellus-latin.woff2')}") format("woff2");font-display:block}`);
  s = s.replace('People For Animals • Learning Programme', 'People For Animals • Remote Internship');
  s = s.replace('for successfully completing the online class', 'for successfully completing the');
  s = s.replace('>Animal Welfare & Compassionate Action<', '>Remote Internship<');
  s = s.replace('.rule:before,.rule:after{content:"";width:65px;height:1px;background:#c9b990}', '');
  /* the paper pure white (owner, 11 Nov 2026: "color of the cert to be pure white pls") */
  s = s.replace('.certificate{width:1120px;height:792px;margin:auto;background:#fbfaf6;', '.certificate{width:1120px;height:792px;margin:auto;background:#ffffff;');
  if (blank) s = s.replace('>Recipient Name<', '><').replace('>DD Month YYYY<', '><').replace('>PFA-YYYY-000001<', '><');
  return s;
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { console.error('build-certificate-art needs Playwright: npm i -D playwright'); process.exit(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-cert-'));
  const page = path.join(dir, 'blank.html');
  fs.writeFileSync(page, design(true));
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const tab = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await tab.goto('file://' + page);
  await tab.evaluate(() => document.fonts.ready);
  const png = path.join(dir, 'art.png');
  await (await tab.$('.certificate')).screenshot({ path: png });
  const at = await tab.evaluate(() => {
    const box = document.querySelector('.certificate').getBoundingClientRect();
    const out = {};
    for (const id of ['recipient', 'date', 'certid']) {
      const e = document.getElementById(id); const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      const m = document.createElement('canvas').getContext('2d'); m.font = `${cs.fontSize} ${cs.fontFamily}`;
      const t = m.measureText('Hg'); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      out[id] = { x: Math.round((id === 'recipient' ? r.left + r.width / 2 : r.left) - box.left), baseline: +(r.top - box.top + (lh - (t.fontBoundingBoxAscent + t.fontBoundingBoxDescent)) / 2 + t.fontBoundingBoxAscent).toFixed(2) };
    }
    return out;
  });
  await browser.close();
  const sharp = (() => { try { return require('sharp'); } catch (_) { return null; } })();
  if (sharp) await sharp(png).webp({ quality: 92 }).toFile(OUT);
  else {
    require('node:child_process').execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(png)}).convert('RGB').save(${JSON.stringify(OUT)}, 'WEBP', quality=92, method=6)`]);
  }
  console.log('wrote', path.relative(ROOT, OUT));
  console.log('the blanks, in the design\'s pixels:', JSON.stringify(at));
}

main().catch((e) => { console.error(e); process.exit(1); });
