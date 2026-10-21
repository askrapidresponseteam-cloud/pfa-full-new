'use strict';

/* The phone pass of 21 Oct 2026 (owner: "make the website look perfectly cool
   on the mobile screen as well. IT NEEDS TO BE SUPREME"). Measured at 390 wide
   in a browser; these hold what was fixed so it does not drift back. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('no reading line under 11px on a phone: the labels that were 10px are lifted', () => {
  const want = {
    'achievements.html': ['.rec__c'],
    'laws.html': ['.cites__label'],
    'academy.html': ['.cites__label', '.card__pill', '.film__n', '.modnav__k', '.deck__meta'],
    'units.html': ['.u-state__region'],
    'careers.html': ['.m-tag'],
    'shop.html': ['.item__tag', '.mosaic__t span'],
    'cinekind.html': ['.honours .roll .t', '.ckreel__src', '.ckreel__no', '.ckreel__go'],
    'founder.html': ['.vtile__no', '.vtile__src', '.vtile__go', '.vapp'],
  };
  for (const [f, sels] of Object.entries(want)) {
    const block = (read(f).match(/@media \(max-width:719px\)\{(html body [^{]+)\{font-size:11px\}\}/) || [])[1] || '';
    for (const s of sels) assert.ok(block.includes('html body ' + s), `${f}: ${s} is lifted to 11px on a phone`);
  }
  assert.match(read('assets/chrome.css'), /\.announce\{font-size:11px;line-height:1\.35;/, 'the announcement bar too');
});

test('a photo picker wears the site button, not the browser grey one', () => {
  assert.match(read('assets/chrome.css'), /body input\[type=file\]::file-selector-button\{[^}]*background:#111;color:#fff/);
});

test('on a phone the founder films and reels are rows to swipe, not a stack', () => {
  const f = read('founder.html');
  const phone = f.slice(f.lastIndexOf('MAKE THE MOBILE VIDEO PLAYING EXPERIENCE'));
  assert.match(phone, /\.vgrid,\.reels\{display:grid;grid-template-columns:none;grid-auto-flow:column;[^}]*overflow-x:auto;[^}]*scroll-snap-type:x mandatory/);
  assert.match(phone, /\.vgrid\{grid-auto-columns:80%\}/, 'the next film peeks in');
  assert.match(phone, /\.vtile\{padding:0;gap:0;scroll-snap-align:start\}/);
  assert.match(f, /content:"Swipe the row \\00b7  tap a frame to play"/, 'a touch screen is told to swipe and tap, not hover');
});

test('units: the search takes the width on a phone and the regions swipe under it', () => {
  const u = read('units.html');
  assert.match(u, /\.u-search\{flex:1 0 100%;min-width:0\}/);
  assert.match(u, /html body #uchips\{display:flex!important;[^}]*overflow-x:auto/);
});

test('newsroom: the four desks sit on one line on a phone', () => {
  assert.match(read('newsroom.html'), /\.nr-desks\{flex-wrap:nowrap;[^}]*overflow-x:auto/);
});

test('the CineKind red carpet poster hides rather than showing a broken image', () => {
  assert.match(read('cinekind.html'), /hqdefault\.jpg'\)\}else\{this\.style\.visibility='hidden'\}/);
});
