'use strict';

/* Owner, 26 Oct 2026, of the case drawer: "why close is close to text. it
   should at right top corner". The shared close style (button.pfa-close)
   sets margin:0, which beat the drawer's margin-left:auto, so Close sat
   against the title. The title block now takes the free width, so Close is
   always in the top right corner whatever the shared style does. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the case drawer keeps Close in its top right corner', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /<header>\s*<div>\s*<h2 class="ttl" id="caseTitle">[\s\S]*?<\/div>\s*<button class="x pfa-close" type="button" id="caseShut">Close<\/button>\s*<\/header>/);
  assert.match(html, /\.drawer header\{justify-content:space-between\}/);
  assert.match(html, /\.drawer header > div\{flex:1 1 auto;min-width:0\}/);
  assert.doesNotMatch(html, /\.drawer header \.x\{margin-left:auto/, 'a margin the shared style overrides is not what places it');
});
