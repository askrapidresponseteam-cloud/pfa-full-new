'use strict';
/* Owner, 23 Nov 2026, of a caregiver application's drawer: "why the f do u
   have this style..it should be the one that you see under caregivers tab
   right.. not vertical like this..it is the credit card style layout", "ensure
   that the photo border is not too close to title above- in any situation",
   and "how is it still certificates and not certificates and letters". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the card in a case\'s drawer: one card, the whole row, never narrow enough to stand upright', () => {
  const js = read('assets/admin-cardcheck.js');
  assert.match(js, /'\.preview\.ccx-wide\{grid-template-columns:minmax\(520px,620px\);overflow-x:auto\}'/, 'at least 520px: the upright layout starts below it (assets/digital-card.css)');
  assert.match(read('assets/digital-card.css'), /@container \(max-width:519px\)/);
  assert.match(js, /grid\.classList\.add\('ccx-wide'\);/);
  assert.match(js, /if \(el\.tagName === 'FIGURE' && el !== mine\) el\.hidden = true;/, 'no empty Back beside it');
  /* drawn again once the photograph arrives, in the same box, never a second card */
  assert.match(js, /next\.hasAttribute\('data-ccx-new'\)/);
  assert.match(js, /box\.setAttribute\('data-ccx-new', ''\);/);
  assert.match(read('assets/digital-card.js'), /box\.className = 'dc';/, 'the reason the mark is an attribute: the card renders its own class');
});

test('the photograph never comes up against the card\'s title', () => {
  const css = read('assets/digital-card.css');
  assert.match(css, /\.dc__front\{[^}]*row-gap:2\.8cqw/);
  assert.match(css, /\.dc__photo\{grid-column:2;grid-row:2;align-self:stretch;justify-self:end;aspect-ratio:3\/4;height:100%;width:auto;max-width:100%;/, 'as tall as its row, no taller');
  assert.match(css, /\.dc__front\{row-gap:0\}\n\s+\.dc__photo\{grid-column:2;grid-row:1;align-self:start;justify-self:auto;width:34cqw;height:auto;max-width:none;/, 'upright, beside the title as before');
});

test('the section is Certificates and letters', () => {
  const admin = read('admin.html');
  assert.match(admin, /data-tab="certificates">Certificates and letters<\/button>/);
  assert.match(admin, /aria-label="Certificates and letters"/);
  assert.match(read('lib/admin-modules.js'), /label: 'Certificates and letters'/);
});
