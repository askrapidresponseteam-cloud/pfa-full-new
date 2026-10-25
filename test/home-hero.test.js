'use strict';

/* The landing page's hero, made grand.

   Owner, 25 Oct 2026, with a reference (a full-bleed photograph, a large
   headline of a grotesque line over an italic one, a short line and a door
   in brackets): "make the index, landing page grand like this. ensure text
   doesnt clip madam's photo... and ensure the landing page doesnt mess the
   theme of the other pages.. header logo and every element should be
   perfectly intact", then "let the font and buttons be the same as
   before.. image repos looks good btw".

   Held here: the headline and the two buttons are what they were (the
   site's display face, in capitals, on two lines; Enter PFA filled and
   Find a unit outlined, 13px bold capitals), in ink on the photograph's
   white; the column the words may use is derived from her outline in the
   photograph (so the numbers in the stylesheet are tied to that
   photograph, at its real size); no new face is loaded; and the header
   and footer are the site's own (test/chrome-sync holds them to the
   templates). A browser measure at nineteen screen sizes, from a 360px
   phone to a 4K screen, found no word within 40px of her. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('index.html');

/* width and height from a WebP's own header (VP8, VP8L or VP8X) */
function webpSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

test('the headline and the buttons are as they were: Marcellus capitals, a filled door and an outlined one', () => {
  assert.match(HTML, /<h1 class="pfa-hero__title" id="heroTitle">A kinder world<br>for every animal<\/h1>/);
  assert.match(HTML, /\.pfa-hero__title\{margin:0;font-family:Marcellus,'Marcellus Fallback','Marcellus Fallback Times',serif;font-weight:400;text-transform:uppercase;white-space:nowrap;font-size:clamp\(30px,min\(10\.4cqi,max\(40px,7vw\)\),110px\);line-height:\.98;letter-spacing:\.01em;/);
  assert.match(HTML, /<a class="pfa-hero__btn pfa-hero__btn--fill" href="search\.html" data-open-search>Enter PFA<\/a>/);
  assert.match(HTML, /<a class="pfa-hero__btn pfa-hero__btn--line" href="units\.html">Find a unit<\/a>/);
  assert.match(HTML, /\.pfa-hero__btn\{display:inline-block;border:1px solid #111;padding:15px 34px;font-size:13px;font-weight:700;letter-spacing:\.1em;text-transform:uppercase;/);
  assert.match(HTML, /\.pfa-hero__btn--fill\{background:#111;color:#fff\}/);
  assert.match(HTML, /\.pfa-hero__btn--line\{background:transparent;color:#111\}/);
});

test('the words keep clear of her: the column is measured from her outline in this photograph', () => {
  assert.match(HTML, /<img id="hero-media" src="img\/hero-caregiver\.webp" width="1536" height="1024" alt="A caregiver holding a rescued dog">/);
  assert.deepEqual(webpSize('img/hero-caregiver.webp'), [1536, 1024], 'the photograph the outline was read from, at its real size');
  const wide = HTML.slice(HTML.indexOf('@media (min-width:901px) and (min-aspect-ratio:23/20){'));
  assert.ok(wide.length > 100, 'side by side on wide screens');
  /* P, the photograph's height: the screen's, or less so the words keep 420px */
  assert.match(wide, /height:min\(var\(--hh\),1400px,calc\(\(100vw - var\(--gv\) - 468px\) \/ \.99\)\);/);
  /* her head starts 34% across a photograph 1.5P wide: 0.99P from the right */
  assert.match(wide, /width:calc\(100cqw - var\(--gq\) - \.99 \* var\(--ph\) - 48px\)/);
  /* the line and the doors end 18% of P above the foot, clear of the sari, and stop 1.164P from the right */
  assert.match(wide, /calc\(\.18 \* var\(--ph\)\)/);
  assert.match(wide, /\.pfa-hero__foot\{max-width:calc\(100% - \.174 \* var\(--ph\)\)\}/);
  /* and a wider face than expected is set smaller, never pushed into her */
  assert.match(HTML, /\(function fitHero\(\) \{/);
});

test('no new face: the landing page loads only what it did', () => {
  assert.doesNotMatch(HTML, /Instrument Serif|instrument-serif/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'fonts', 'instrument-serif-latin-400-italic.woff2')), 'the trial italic is gone');
  const faces = [...HTML.matchAll(/<link rel="preload" href="(fonts\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(faces, ['fonts/marcellus-latin.woff2']);
});
