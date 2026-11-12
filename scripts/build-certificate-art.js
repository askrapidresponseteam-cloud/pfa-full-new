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
     the paper      pure white (the design's own since 12 Nov 2026)
     the signature  taken out of the art and kept on its own
                    (assets/certificates/signature.png), in the design's navy
                    ink, so it can be placed: assets/certificate.js draws it
                    where the design puts it, moved by the panel's Signature
                    position (owner, 12 Nov 2026: "update this certificate
                    with controls")
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
/* the signature on its own, so it can be placed (owner, 12 Nov 2026: "signature
   a bit more to the right. or can you for now give me manual control to
   finalise the position"); assets/certificate.js draws it where SIG says */
const SIG_OUT = path.join(ROOT, 'assets', 'certificates', 'signature.png');
/* The print masters (owner, 12 Nov 2026: "the cert sent as an attachment over
   email is of low res. can you make it super high/highest quality"): the same
   art and signature at six times the design's size, 6720 x 4752, about 575
   dots per inch on A4, lossless. assets/certificate.js draws the PDF and the
   downloaded picture on these, so the certificate prints sharp; the screen
   keeps the light 2x files above. */
const PRINT_SCALE = 6;
const PRINT_OUT = path.join(ROOT, 'assets', 'certificates', 'completion-print.png');
const SIG_PRINT_OUT = path.join(ROOT, 'assets', 'certificates', 'signature-print.png');

function design(blank) {
  let s = fs.readFileSync(SRC, 'utf8');
  const font = (file) => 'file://' + path.join(ROOT, 'fonts', file);
  s = s.replace(/<link rel="preconnect"[^>]*>/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
  s = s.replace('<style>', `<style>@font-face{font-family:"Marcellus";src:url("${font('marcellus-latin.woff2')}") format("woff2");font-display:block}`);
  s = s.replace('People For Animals • Learning Programme', 'People For Animals • Remote Internship');
  s = s.replace('for successfully completing the online class', 'for successfully completing the');
  s = s.replace(/>Animal Welfare (?:&|&amp;) Compassionate Action</, '>Remote Internship<');
  /* every change above must have found its words: a design saved again
     elsewhere may write them differently (the 12 Nov 2026 copy wrote & as
     &amp;), and a change that misses would put the wrong course on every
     certificate */
  for (const [gone, why] of [['online class', 'the course line'], ['Learning Programme', 'the subtitle'], ['Compassionate Action', 'the course name']]) {
    if (s.includes(gone)) throw new Error(`build-certificate-art: ${why} still reads "${gone}"; the design's wording has changed`);
  }
  s = s.replace('.rule:before,.rule:after{content:"";width:65px;height:1px;background:#c9b990}', '');
  /* the paper pure white (owner, 11 Nov 2026: "color of the cert to be pure white pls") */
  s = s.replace('.certificate{width:1120px;height:792px;margin:auto;background:#fbfaf6;', '.certificate{width:1120px;height:792px;margin:auto;background:#ffffff;');
  if (blank) s = s.replace('>Recipient Name<', '><').replace('>DD Month YYYY<', '><').replace('>PFA-YYYY-000001<', '><');
  /* the signature where the design first puts it, unmoved: how far it is
     moved is the panel's setting (assets/certificate.js, SIG), not the art's */
  s = s.replace(/<article style="[^"]*" class="certificate"/, '<article style="--signature-x: 0px; --signature-y: 0px;" class="certificate"');
  /* the art without the signature; the signature drawn on it in its place */
  /* (the image itself taken out: hidden, its ink filter would still paint
     a solid block, since it reads ink from what is not there) */
  if (blank) s = s.replace('</style>', '.signature svg image{display:none}</style>');
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
  /* the signature alone, on nothing, at the same 2x */
  const sig = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const sigPage = path.join(dir, 'signature.html');
  fs.writeFileSync(sigPage, design(true).replace('.signature svg image{display:none}', '').replace('</style>', 'html,body,.stage,.certificate{background:transparent!important;box-shadow:none!important}.certificate:before,.certificate:after{display:none!important}.certificate *{visibility:hidden}.signature svg,.signature svg *{visibility:visible}</style>'));
  await sig.goto('file://' + sigPage);
  await sig.evaluate(() => document.fonts.ready);
  const svg = await sig.$('.signature svg');
  await svg.screenshot({ path: SIG_OUT, omitBackground: true });
  const sigBox = await sig.evaluate(() => {
    const c = document.querySelector('.certificate').getBoundingClientRect();
    const r = document.querySelector('.signature svg').getBoundingClientRect();
    return { x: +(r.left - c.left).toFixed(2), y: +(r.top - c.top).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  });
  await browser.close();
  const sharp = (() => { try { return require('sharp'); } catch (_) { return null; } })();
  if (sharp) await sharp(png).webp({ quality: 92 }).toFile(OUT);
  else {
    require('node:child_process').execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(png)}).convert('RGB').save(${JSON.stringify(OUT)}, 'WEBP', quality=92, method=6)`]);
  }
  console.log('wrote', path.relative(ROOT, OUT));
  console.log('the blanks, in the design\'s pixels:', JSON.stringify(at));
  console.log('wrote', path.relative(ROOT, SIG_OUT), 'the signature, where the design puts it:', JSON.stringify(sigBox));
  await printMasters(chromium, page, sigPage);
}

/* the same two pages again, at the print scale, kept lossless */
async function printMasters(chromium, page, sigPage) {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const art = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: PRINT_SCALE });
  await art.goto('file://' + page);
  await art.evaluate(() => document.fonts.ready);
  await (await art.$('.certificate')).screenshot({ path: PRINT_OUT });
  const sig = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: PRINT_SCALE });
  await sig.goto('file://' + sigPage);
  await sig.evaluate(() => document.fonts.ready);
  await (await sig.$('.signature svg')).screenshot({ path: SIG_PRINT_OUT, omitBackground: true });
  await browser.close();
  console.log('wrote', path.relative(ROOT, PRINT_OUT), 'and', path.relative(ROOT, SIG_PRINT_OUT), `at ${PRINT_SCALE}x, lossless`);
}

main().catch((e) => { console.error(e); process.exit(1); });
