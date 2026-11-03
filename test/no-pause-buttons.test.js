'use strict';

/* Owner, 3 Nov 2026: "dont need these pause buttons". Moving parts stop on
   hover and focus, and stay still for anyone who asks for reduced motion,
   with no button on the page to do it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('no page carries a pause button for its moving parts', () => {
  const hits = [];
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/<button[^>]*>\s*(Pause|Pause motion|Resume motion)\s*<\/button>/i.test(html) || /class="hero__pause"/.test(html) || /id="motionToggle"/.test(html)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

test('the shop\'s moving cards are square-cornered prints with the same white border all round (owner, 3 Nov 2026)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'shop.html'), 'utf8');
  const last = html.lastIndexOf('main .mosaic__face{border-radius:0;');
  assert.ok(last > html.lastIndexOf('main .mosaic__face{border-radius:10px}'), 'square corners win over the older rounded ones');
  assert.match(html, /main \.mosaic__face img\{inset:8px 8px auto 8px;width:calc\(100% - 16px\);height:calc\(100% - 46px\)/);
  assert.match(html, /main \.stage\{--ch:calc\(\(var\(--cw\) - 16px\) \* 1\.5 \+ 46px\)\}/, 'the card is cut to the 2:3 photograph, so nothing is letterboxed');
});
