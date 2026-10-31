'use strict';

/* Every page opens the same way, and every caption stands on its picture.

   Owner, 10 Oct 2026, of the eyebrow, the red tick and the title: "these
   items.. in 1 page, it is in 1-1 place.. no consistency at present. fix
   this issue- site wide". And of a caption beside a photograph drawn
   narrower than its frame: "it is not properly aligned with the photo.
   never have such issue. do a site wide scan and fix".

   A browser measure of all 25 pages at 1440, 1024, 768 and 390 wide now
   finds one pattern: the eyebrow on the logo's line, 72px under the header
   (36px on a phone); the red tick 18px under it; the title 18px under the
   tick, one size and face; the line 26px under the title and the buttons
   32px under the line. A scan of every caption against where its picture is
   actually drawn finds none off its edge. These hold the parts that make it
   so. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['academy', 'achievements', 'ask', 'campaign', 'campus', 'careers', 'caregiver-card', 'csr', 'donate', 'events',
  'founder', 'get-involved', 'laws', 'legacy', 'library', 'newsroom', 'privacy', 'quiz', 'report', 'search', 'sgacc', 'shop',
  'track', 'units', 'wall'].map((n) => n + '.html');

test('every page has the title block: an eyebrow, then the title', () => {
  for (const file of PAGES) {
    const doc = new JSDOM(read(file)).window.document;
    const titles = doc.querySelectorAll('main h1');
    assert.equal(titles.length, 1, `${file}: one title`);
    const h1 = titles[0];
    assert.ok(h1.classList.contains('pfa-title'), `${file}: the title carries the shared block`);
    const kicker = h1.previousElementSibling;
    assert.ok(kicker && kicker.classList.contains('pfa-kicker') && kicker.textContent.trim(), `${file}: an eyebrow right above the title`);
    assert.match(read(file), /<link rel="stylesheet" href="assets\/pfa-theme\.css/, `${file}: loads the shared rules`);
  }
});

test('one set of rules draws it, heavy enough to beat any page\'s own', () => {
  const css = read('assets/pfa-theme.css');
  assert.match(css, /main \.pfa-kicker\.pfa-kicker\{display:block;margin:0 0 18px;/);
  assert.match(css, /main h1\.pfa-title\.pfa-title\{margin:0;[^}]*font-size:clamp\(38px,5\.2vw,74px\);[^}]*text-transform:uppercase;text-align:left;/);
  /* no red line over the title, anywhere (owner, 31 Oct 2026: "why the heck that red line .. dont need it anywhere") */
  assert.doesNotMatch(css, /pfa-title\.pfa-title::before/);
  assert.match(css, /main h1\.pfa-title\.pfa-title \+ p,main h1\.pfa-title\.pfa-title \+ \.nr-strap\{margin-top:26px\}/);
});

test('the block starts at one height and on the header\'s gutter', () => {
  assert.match(read('assets/micro.css'), /\.m-hero__in\{[^}]*align-items:start;/, 'not floated to the middle of a tall picture');
  assert.match(read('shop.html'), /\.hero\{[^}]*align-items:start;/);
  assert.match(read('founder.html'), /\.fhero__in\{[^}]*align-items:start\}/);
  for (const [file, rule] of [['academy.html', /\.deck\{[^}]*padding:calc\(var\(--ann\) \+ var\(--nav\) \+ 72px\)/], ['get-involved.html', /\.gi\{padding:calc\(var\(--ann\) \+ var\(--nav\) \+ 72px\)/], ['quiz.html', /\.qz\{padding:calc\(var\(--ann\) \+ var\(--nav\) \+ 72px\)/]]) {
    assert.match(read(file), rule, `${file}: 72px under the header`);
  }
  for (const file of ['academy.html', 'founder.html', 'get-involved.html', 'quiz.html', 'units.html']) {
    assert.match(read(file), /@media \(max-width:720px\)\{\.[a-z-]+\{padding-top:calc\(var\(--ann\) \+ var\(--nav\) \+ 36px\)\}\}/, `${file}: 36px on a phone, as every other page`);
  }
  const header = 'max(clamp(16px,4vw,72px),(100% - 1440px) / 2)';
  assert.ok(read('donate.html').includes('--gutter-lg:' + header) && read('founder.html').includes('--gutter-lg:' + header), 'the header\'s gutter');
  assert.ok(read('events.html').includes('--ev-gutter:max(clamp(16px,4vw,72px),calc((100% - 1440px) / 2))'));
  assert.doesNotMatch(read('academy.html'), /\.deck__head\{text-align:center/, 'no centred title');
});

test('no stylesheet hides inside a comment', () => {
  /* quiz.html's comment said "its first </style>", and a tool that writes
     before the last </style> put the page's tick and phone rules inside the
     comment, where no browser reads them */
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    for (const m of read(file).matchAll(/<!--([\s\S]*?)-->/g)) {
      assert.ok(!m[1].includes('</style>'), `${file}: a comment that says </style> catches the next tool's CSS`);
      assert.doesNotMatch(m[1], /\n\s*[.#@a-z][^\n{]*\{[^}\n]*:[^}\n]*\}/, `${file}: CSS inside a comment`);
    }
  }
});

test('a caption stands on its picture', () => {
  const css = read('assets/micro.css');
  assert.match(css, /\.m-ph\.m-ph--whole\{aspect-ratio:auto!important;width:fit-content;max-width:100%;margin-left:auto;/, 'the frame is the picture\'s size, so the caption starts at its edge');
  assert.match(css, /\.m-ph--whole img\{position:static;display:block;width:auto;height:auto;max-width:100%;/);
  const events = read('events.html');
  assert.match(events, /\.ev-pola figcaption\{[^}]*font-size:clamp\(15px,12cqi,28px\);[^}]*text-align:center;/, 'a name sized to its polaroid');
  assert.doesNotMatch(events, /\.ev-pola figcaption\{[^}]*text-overflow:ellipsis/, 'never "John Abrah..."');
});
