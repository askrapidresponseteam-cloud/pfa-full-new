'use strict';

/* A picture with words in it is never cut by its frame.

   Owner, 10 Oct 2026, of the PFA Campus poster ("Main focus", twelve parts)
   in a hero frame that filled itself by cutting the top and bottom away:
   "this looks clipped. can you check and ensure it isnt". A browser scan of
   every page, desktop and phone, measuring how much of each picture a frame
   cuts, found one more: the newsroom's protest panorama, whose wide frame
   lost to a later 3:2 rule and cut the banner's last word and the placards
   at both edges. Photographs framed on purpose (faces, T-shirts, film
   stills) keep their framing. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the PFA Campus poster is shown whole, and described', () => {
  const html = read('campus.html');
  assert.match(html, /<figure class="m-ph m-ph--whole" data-ph><img src="media\/site\/campus\/campus\.jpg" alt="The main focus of a PFA Campus society, in twelve parts: [^"]{60,}"/);
  const css = read('assets/micro.css');
  assert.match(css, /\.m-ph\.m-ph--whole\{aspect-ratio:auto!important;/, 'its own shape, over any hero ratio');
  assert.match(css, /\.m-ph--whole img\{position:static;display:block;width:auto;height:auto;max-width:100%;max-height:/, 'drawn at its own proportions, never cut');
  assert.match(css, /\.m-ph\.m-ph--whole\.is-gone\{aspect-ratio:4\/3!important;/, 'a picture that did not arrive still leaves its plate');
});

test('no hero picture is cut by more than a quarter', () => {
  /* the old site's campaign graphics and anything added later: past a
     quarter cut away, the frame takes the picture's own shape */
  const js = read('assets/micro.js');
  assert.match(js, /if \(Math\.min\(rn \/ rb, rb \/ rn\) < 0\.75\) fig\.classList\.add\('m-ph--whole'\);/);
  assert.match(js, /\$\$\('\.m-hero__media \.m-ph:not\(\.m-ph--whole\)'\)\.forEach\(keepWhole\);/);
  for (const f of ['campus.html', 'campaign.html', 'csr.html', 'legacy.html', 'sgacc.html', 'careers.html']) {
    assert.match(read(f), /<script src="assets\/micro\.js/, `${f} carries the rule`);
  }
});

test('the newsroom panorama is the shape of the picture, at every width', () => {
  const html = read('newsroom.html');
  const wide = /\.leg__figs \.frame\.frame--wide\{([^}]*)\}/.exec(html);
  assert.ok(wide, 'the wide frame outranks the 3:2 rule');
  assert.match(wide[1], /aspect-ratio:1800\/679/);
  assert.ok(html.indexOf('.leg__figs .frame{aspect-ratio:3/2}') < html.indexOf('.leg__figs .frame.frame--wide{'));
  assert.doesNotMatch(html, /\.leg__figs \.frame--wide\{aspect-ratio:2\/1\}/, 'no phone ratio cutting it again');
});

test('achievements, the founder gallery and the newsroom case photos show every photograph whole', () => {
  /* owner, 22 Oct 2026, of the achievements on a phone: "these photos are
     getting clipped.. can you fix this issue across the site". A browser
     scan of every page found the founder gallery cutting 88% of one picture
     away and the newsroom's protest losing 30%. */
  const ach = read('achievements.html');
  assert.match(ach, /\.rec__image\{display:block;width:100%;height:auto;background:#f5f3ef\}/, 'its own shape');
  assert.doesNotMatch(ach, /\.rec__image\{[^}]*(aspect-ratio|object-fit:cover)/, 'no frame shape forced on it, at any width');
  assert.match(ach, /\.arcc__photo\{[^}]*object-fit:contain/, 'whole inside each carousel card');
  const f = read('founder.html');
  const gal = f.slice(f.indexOf('<section class="gal" id="gallery"'), f.indexOf('</section>', f.indexOf('<section class="gal" id="gallery"')));
  const frames = [...gal.matchAll(/<div class="frame" style="--r:([\d.]+)"[^>]*><img[^>]*?\ssrc="([^"]+)"/g)];
  assert.equal(frames.length, 5, 'every frame carries its picture\'s shape');
  /* a JPEG's width and height, from its frame header */
  const jpegSize = (file) => {
    const b = fs.readFileSync(file);
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  };
  for (const [, r, src] of frames) {
    const s = jpegSize(path.join(ROOT, src));
    assert.ok(s, `${src} read`);
    assert.ok(Math.abs(s.w / s.h - Number(r)) < 0.01, `${src}: --r ${r} is its own shape (${s.w}x${s.h})`);
  }
  assert.match(f, /\.gal \.gal__grid > \.frame\{flex:var\(--r,1\.5\) 1 calc\(var\(--r,1\.5\) \* clamp\(150px,18vw,260px\)\);aspect-ratio:var\(--r,1\.5\)/);
  const n = read('newsroom.html');
  assert.match(n, /\.leg__figs \.frame\.frame--pair-a\{aspect-ratio:1800\/1715\}/);
  assert.match(n, /\.leg__figs \.frame\.frame--pair-b\{aspect-ratio:1690\/920\}/);
  assert.match(n, /class="frame frame--pair-a"><img[^>]*case-001-protest\.webp/);
});
