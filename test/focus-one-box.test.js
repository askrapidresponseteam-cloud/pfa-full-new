'use strict';
/* Owner, 1 Nov 2026, on the donate page's amount box: "border within the box
   is fucked up". A field that already draws its own edge shows focus by that
   edge, never by a second ring inside or around it. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the donate page: no ring inside the amount box or any field', () => {
  const s = read('donate.html');
  assert.match(s, /\.give input:focus-visible,\.give select:focus-visible,\.give textarea:focus-visible\{outline:none\}/);
  assert.match(s, /\.other__in input\{border:none;outline:none;/);
});

test('the intern portal and the shop sort: one box when focused', () => {
  assert.match(read('intern.html'), /\.ip-field input:focus-visible,\.ip-field textarea:focus-visible,\.ip-field select:focus-visible\{outline:none;box-shadow:inset 0 0 0 1px var\(--ink\)\}/);
  assert.match(read('shop.html'), /\.bar__sort select:focus-visible\{outline:none;border-color:var\(--ink\)\}/);
});
