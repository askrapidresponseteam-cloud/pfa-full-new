'use strict';

/* One family of type across the site (owner, 3 Nov 2026: "ensure the font
   family matches the rest of the site.. audit achievements html and ensure
   the font there also matches the rest properly. and ensure each and every
   screen renders super cool in mobile screens as well"): Marcellus for what
   names something, Helvetica for what is read. Two faces are kept on
   purpose: the handwritten captions on the events photographs (Kalam), and
   the reader's serif sample on its Aa button (Georgia). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['admin.html', 'submission-collage.html'].includes(f));
/* a font stack that does not start with the site's own faces */
const STRAY = /font(?:-family)?:\s*(?:[0-9]+\s+)?(?:[0-9.]+px(?:\/[0-9.]+)?\s+)?(?:'|")?(Arial|Courier New|EB Garamond|AchievementSerif|Times New Roman|Inter|Roboto|system-ui)\b/;

test('every public page: no stack that starts with another face', () => {
  for (const f of PAGES) {
    const m = STRAY.exec(read(f));
    assert.equal(m, null, `${f}: ${m ? m[0] : ''}`);
  }
});

test('the payment result pages: Helvetica for the words, Marcellus for the heading', () => {
  for (const f of ['lib/routes/payment/response.js', 'lib/routes/shop/response.js', 'lib/pfa-ccavenue-flow.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /font-family:Arial,sans-serif|font:700 16px Arial|EB Garamond/, f);
    assert.match(s, /h1\{font-family:Marcellus,Georgia,serif;font-weight:400;letter-spacing:\.01em;text-transform:uppercase\}|h1\{margin:0 0 16px;font-family:Marcellus/, f);
    assert.match(s, /@font-face\{font-family:Marcellus;src:url\(\/fonts\/marcellus-latin\.woff2\)/, `${f}: the face itself, from the site`);
  }
});

test('the internship page: the site faces, nothing under 10px, the header hidden only once the field notes reach the top', () => {
  const html = read('internship.html');
  assert.doesNotMatch(html, /Courier New|EB Garamond|Arial,Helvetica,sans-serif/);
  assert.match(html, /\.v-brand small,\.v-time,\.v-label small,\.v-desc h2\{font-size:10px!important\}/);
  assert.match(read('assets/internship-fieldnotes.js'), /classList\.toggle\('v-mode',es\[0\]\.isIntersecting\),\{rootMargin:'0px 0px -88% 0px',threshold:0\}/,
    'on a phone the field notes show at the foot of the first screen; the PFA header stays until they reach the top');
});

test('no red line over a kicker, in the reader either', () => {
  assert.doesNotMatch(read('assets/reader.css'), /\.rd-missing__kind\{[^}]*linear-gradient/);
});

test('the shop: the studio photographs, shown in their own colours', () => {
  const html = read('shop.html');
  const studio = [...new Set(html.match(/media\/shop\/v4\/[a-z0-9-]+-studio\.webp/g) || [])];
  assert.equal(studio.length, 17, 'seventeen new photographs');
  for (const f of studio) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  for (const f of html.match(/media\/shop\/v4\/[^"| )]+\.webp/g) || []) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is on disk`);
  assert.match(html, /main \.item__media img\{object-fit:contain;object-position:center;mix-blend-mode:normal;transform:none\}/);
  assert.match(html, /#look \.look__main img\{mix-blend-mode:normal;object-fit:contain\}/);
  assert.doesNotMatch(html, /mix-blend-mode:multiply/);
});

test('the panel on a phone: a grid never grows past the screen to fit a table', () => {
  const html = read('admin.html');
  for (const g of ['.ip{', '.ip-q{', '.apq{', '.ct{']) {
    const rule = html.slice(html.indexOf(`\n${g}display:grid`) + 1).split('}')[0];
    assert.match(rule, /grid-template-columns:minmax\(0,1fr\)/, g);
  }
});
