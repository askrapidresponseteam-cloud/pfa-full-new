'use strict';
/* The founder page's photograph (owner, 11 Nov 2026, of the one at her desk:
   "instead of this. can you have the cow one. edge to edge (left to right of
   the screen)"). Checked in a browser at 1440, 1920, 820 and 390 wide: the
   frame is the screen's full width at the photograph's own 1660:948, so it
   is whole at every width. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'founder.html'), 'utf8');

test('the founder page opens on her photograph with the cows, the width of the screen, whole', () => {
  assert.match(html, /<figure class="plate plate--wide">\s*<div class="frame" data-label="Smt\. Maneka Sanjay Gandhi">\s*<img src="img\/founder-cows-1660\.jpg"\s*srcset="img\/founder-cows-960\.jpg 960w, img\/founder-cows-1660\.jpg 1660w"\s*sizes="100vw"\s*width="1660" height="948"/);
  assert.match(html, /\.plate\.plate--wide \.frame\{aspect-ratio:1660\/948;width:100%;max-height:none;margin-inline:0\}/, 'edge to edge, at its own shape');
  assert.match(html, /\n\.frame img\{[^}]*object-fit:contain;/, 'never cut');
  assert.doesNotMatch(html, /founder-portrait-1536\.jpg"\s*srcset/, 'the desk photograph is no longer the plate');
  for (const f of ['img/founder-cows-1660.jpg', 'img/founder-cows-960.jpg']) {
    const b = fs.readFileSync(path.join(ROOT, f));
    assert.ok(b[0] === 0xff && b[1] === 0xd8, `${f} is a JPEG`);
  }
});
