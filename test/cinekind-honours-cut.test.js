'use strict';

/* The ten honours on cinekind.html, every tile filled the same way (owner,
   6 Nov 2026: "ensure you find images for all the people named here and
   they have to render the same way. not like some with edges and some
   not"). Each photograph carries its own cut, measured on the source and
   exactly the tile's 3:4, so no tile shows a band or a printed border and
   nothing is stretched. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'cinekind.html'), 'utf8');
const wall = html.slice(html.indexOf('<ol class="rollwall" id="honours">'), html.indexOf('</ol>', html.indexOf('<ol class="rollwall" id="honours">')));
const tiles = [...wall.matchAll(/<li class="rt has-photo" id="(h25-\d\d)">([\s\S]*?)<\/li>/g)];

test('all ten honourees have a photograph, none from an address that expires', () => {
  assert.equal(tiles.length, 10);
  for (const [, id, body] of tiles) {
    const img = /<img ([^>]+)>/.exec(body);
    assert.ok(img, `${id} has a photograph`);
    assert.doesNotMatch(img[1], /licdn\.com|[?&]e=\d{10}/, `${id}: not a signed address`);
  }
  assert.match(wall, /id="h25-06">[\s\S]*?src="https:\/\/timesofindia\.indiatimes\.com\/authorphoto\//, 'Kushagra Dixit, from his Times of India author page');
});

test('every cut is the tile\'s own 3:4, inside the photograph', () => {
  for (const [, id, body] of tiles) {
    const tag = /<img ([^>]+)>/.exec(body)[1];
    assert.match(tag, /class="cut"/, id);
    const [W, H] = /data-size="(\d+)x(\d+)"/.exec(tag).slice(1).map(Number);
    const v = Object.fromEntries([...tag.matchAll(/--(cx|cy|cw|ch):([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    for (const k of ['cx', 'cy', 'cw', 'ch']) assert.ok(Number.isFinite(v[k]), `${id} --${k}`);
    const ratio = (v.cw * W) / (v.ch * H);
    assert.ok(Math.abs(ratio - 0.75) < 0.006, `${id}: the cut is ${ratio.toFixed(4)}, not 3:4`);
    assert.ok(v.cx >= 0 && v.cy >= 0 && v.cx + v.cw <= 1.0001 && v.cy + v.ch <= 1.0001, `${id}: the cut stays inside the photograph`);
  }
});

test('the cut rule is the last word on the tiles, after the 26 Oct whole-photograph rule', () => {
  const whole = html.indexOf('<style id="ck-whole">');
  const cut = html.indexOf('<style id="ck-cut">');
  assert.ok(whole > 0 && cut > whole);
  const rule = /<style id="ck-cut">([\s\S]*?)<\/style>/.exec(html)[1];
  assert.match(rule, /\.rt \.shot img\.cut\{object-fit:fill!important;inset:auto!important;left:calc\(-100% \* var\(--cx\) \/ var\(--cw\)\)!important;top:calc\(-100% \* var\(--cy\) \/ var\(--ch\)\)!important;width:calc\(100% \/ var\(--cw\)\)!important;height:calc\(100% \/ var\(--ch\)\)!important/);
  assert.doesNotMatch(rule, /[\u2013\u2014]/);
});
