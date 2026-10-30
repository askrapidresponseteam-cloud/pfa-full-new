/* Owner, 30 Oct 2026:
   - "photos render differently in each tile looks diff and odd. make it
     uniform and supreme": every shop photograph is a 2:3 canvas
     (scripts/shop-frames.py), the shape of the tiles, so each tile is filled
     edge to edge by its photograph, which is still whole.
   - "the 2nd photo in crawling inside the landing view.. can never let such
     a thing happen on mobile or anywhere else": the home hero fills the
     first screen on a phone and a tablet, and assets/chrome.js keeps a
     second photograph out of the first screen on every page. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* width and height from a WebP's own header */
function webpSize(file) {
  const b = fs.readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`not a WebP: ${file}`);
}

test('every shop photograph is a framed 2:3 copy, and the tiles are 2:3', () => {
  const html = read('shop.html');
  const all = [...new Set(html.match(/media\/shop\/[\w./-]+\.webp/g))];
  assert.ok(all.length >= 40, 'the shop names its photographs');
  const outside = all.filter((p) => !p.startsWith('media/shop/v3/'));
  assert.deepEqual(outside, [], 'the page uses the framed copies only');
  for (const rel of all) {
    const { w, h } = webpSize(path.join(ROOT, rel));
    if (w > h) continue; /* a front-and-back picture side by side is left as shot */
    assert.ok(Math.abs(w / h - 2 / 3) < 0.004, `${rel} is ${w}x${h}, not 2:3`);
  }
  assert.match(html, /\.item__media,\.feature__pics button,\.line__pic\{aspect-ratio:2\/3\}/);
  assert.match(html, /object-fit:contain/, 'still never cropped');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'shop-frames.py')), 'the frames can be made again');
});

test('the home hero fills the first screen on a phone and a tablet', () => {
  const html = read('index.html');
  assert.match(html, /@media not all and \(min-width:901px\) and \(min-aspect-ratio:23\/20\)\{\s*section\[data-screen-label="Hero"\]\{min-height:calc\(100svh - var\(--bar,115px\) - var\(--tabbar,0px\)\)\}/);
  assert.doesNotMatch(html, /section\[data-screen-label="Hero"\]\{min-height:0\}\}/, 'the shrink-to-fit that let the founder photograph in is gone');
});

test('no page lets a second photograph into its first screen', () => {
  const js = read('assets/chrome.js');
  assert.match(js, /the first screen is one picture/);
  assert.match(js, /window\.PFAFoldGuard = guard/);
  assert.match(js, /document\.querySelector\('\.pfa-tabs'\)/, 'the foot of the screen is the tab bar on a phone');
  assert.match(js, /window\.addEventListener\('resize', later\)/);
  assert.ok(!/[–—]/.test(js.slice(js.indexOf('the first screen is one picture'))), 'no dashes');
});
