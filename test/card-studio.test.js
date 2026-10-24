'use strict';

/* The photograph is never cropped, and the card studio.

   Owner, 24 Oct 2026: "photo cannot get clipped or cropped. can you update
   and also add a preview the card option for the admin. front and back",
   then the Classical White template "to be updated for admin": its tools
   (actual size, a PNG of each face, Print / Save PDF, A4 paper) in the
   panel, from the register.

   Held here: the photograph is fitted whole inside its box, in its own
   proportions; A4 sheets put each face at exactly 85.6 x 54 mm inside the
   template's margins, with nothing overlapping; the PNGs carry 600 dpi; a
   card is never printed without its photograph; and the panel opens the
   studio from every card it shows, prints only issued cards, and closes
   it on Escape without closing the drawer under it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');

function renderer() {
  const context = {
    window: {}, document: { createElement: () => ({ getContext: () => ({}) }), fonts: null },
    Image: function () { setTimeout(() => this.onerror && this.onerror(), 0); },
    Blob, TextEncoder, atob, URL, setTimeout
  };
  context.self = context.window;
  vm.createContext(context);
  for (const f of ['assets/field-rules.js', 'assets/card-fields.js', 'assets/card-print.js', 'assets/caregiver-card.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context);
  }
  return context.window.PFACaregiverCard;
}

test('the photograph is fitted whole inside its box, in its own proportions, and centred', () => {
  const C = renderer();
  const well = C.photoWell();
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  for (const [w, h, why] of [[1200, 800, 'a landscape photograph'], [600, 1200, 'a tall one'], [900, 900, 'a square one'], [3000, 4000, 'a phone camera\'s'], [40, 30, 'a tiny one']]) {
    const fit = C.photoFit({ naturalWidth: w, naturalHeight: h });
    assert.ok(fit.x >= well.x - 1e-9 && fit.y >= well.y - 1e-9, `${why}: inside the box`);
    assert.ok(fit.x + fit.w <= well.x + well.w + 1e-9 && fit.y + fit.h <= well.y + well.h + 1e-9, `${why}: nothing outside it, so nothing is cut`);
    assert.ok(close(fit.w / fit.h, w / h), `${why}: its own proportions`);
    assert.ok(close(fit.w, well.w) || close(fit.h, well.h), `${why}: as large as the box allows`);
    assert.ok(close(fit.x - well.x, well.x + well.w - fit.x - fit.w) && close(fit.y - well.y, well.y + well.h - fit.y - fit.h), `${why}: centred`);
  }
  /* and the box sits inside the photograph's border, clear of it */
  assert.ok(well.w < 179.328 && well.h < 203.359);
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'caregiver-card.js'), 'utf8');
  const front = source.slice(source.indexOf('function drawFront('), source.indexOf('function drawBack('));
  assert.doesNotMatch(front, /coverDraw|\.clip\(\)/, 'the front never crops: no cover fit, no clipping');
  assert.match(front, /fitWhole\(data\.photoImage, well\)/);
});

test('A4 paper: each face at 85.6 x 54 mm, inside the template\'s 15 mm margins, nothing overlapping', () => {
  const C = renderer();
  const sheets = C.a4Layout(9);
  assert.equal(sheets.length, 3, 'four cards a sheet');
  assert.deepEqual(Array.from(sheets, (s) => s.length), [8, 8, 2], 'a front and a back for each card');
  for (const sheet of sheets) {
    const boxes = sheet.map((f) => ({ x: f.xMm, y: f.yMm, w: C.CARD.w, h: C.CARD.h }));
    for (const b of boxes) {
      assert.ok(b.x >= 15 - 1e-9 && b.y >= 15 - 1e-9 && b.x + b.w <= 210 - 15 + 1e-9 && b.y + b.h <= 297 - 15 + 1e-9, 'within the margins');
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, 'no face overlaps another');
      }
    }
  }
  const first = sheets[0];
  assert.equal(first[0].side, 'front'); assert.equal(first[1].side, 'back');
  assert.equal(first[0].yMm, first[1].yMm, 'a card\'s front and back side by side');
});

test('the A4 PDF is a valid document of A4 pages, each image at card size', async () => {
  const C = renderer();
  const jpeg = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'card-sample.jpg')));
  const item = (xMm, yMm) => ({ xMm, yMm, wMm: 85.6, hMm: 54, width: 2022, height: 1276, bytes: jpeg });
  const pdf = Buffer.from(await C._buildSheetPdf([
    { wMm: 210, hMm: 297, items: [item(15, 15), item(109.4, 15)] },
    { wMm: 210, hMm: 297, items: [item(15, 15)] }
  ]).arrayBuffer());
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.equal((text.match(/\/MediaBox \[0 0 595\.276 841\.890\]/g) || []).length, 2, 'two A4 pages');
  assert.match(text, /q 242\.646 0 0 153\.071 42\.520 646\.299 cm \/Im0 Do Q/, '85.6 x 54 mm, 15 mm from the top left');
  const xrefStart = Number(text.slice(text.lastIndexOf('startxref')).split('\n')[1]);
  const entries = text.slice(xrefStart).split('\n').slice(2).filter((line) => /\d{10} \d{5} n/.test(line));
  assert.equal(entries.length, 2 + 2 * 2 + 3, 'catalog, pages, two pages with their contents, three images');
  entries.forEach((entry, index) => {
    assert.ok(text.startsWith(`${index + 1} 0 obj`, Number(entry.slice(0, 10))), `object ${index + 1} is at its cross-reference offset`);
  });
});

test('a PNG of a face carries 600 dpi, so it prints at 85.6 x 54 mm', () => {
  const C = renderer();
  const png = new Uint8Array(fs.readFileSync(path.join(ROOT, 'media', 'caregiver-card-logo.png')));
  const out = Buffer.from(C._pngWithDpi(png, 600));
  assert.equal(out.toString('latin1', 12, 16), 'IHDR');
  const at = 8 + 25;
  assert.equal(out.readUInt32BE(at), 9);
  assert.equal(out.toString('latin1', at + 4, at + 8), 'pHYs');
  assert.equal(out.readUInt32BE(at + 8), 23622, '600 dots an inch, in dots a metre');
  assert.equal(out.readUInt32BE(at + 12), 23622);
  assert.equal(out[at + 16], 1, 'per metre');
  assert.equal(out.readUInt32BE(at + 17), zlib.crc32(out.subarray(at + 4, at + 17)), 'its checksum');
  assert.ok(out.subarray(at + 21).equals(Buffer.from(png.subarray(33))), 'the image itself untouched');
});

test('a card is never printed without its photograph', async () => {
  const C = renderer();
  await assert.rejects(C.printReady({ cardId: 'PFA-CCT-ABCD2345', name: 'Selina Thakur', district: 'Udupi', state: 'Karnataka', issuedShort: '24/10/2026', photoImage: null }), /no photograph/);
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const batch = html.slice(html.indexOf('function makePdf('), html.indexOf('function labels('));
  assert.match(batch, /Promise\.all\(chosen\.map\(cardPhoto\)\)/, 'the batch fetches each photograph before it prints');
  assert.match(batch, /if \(!data\.photoImage\) missing\.push\('photograph'\)/, 'and names any card without one');
});

test('the card studio opens from every card the panel shows, and prints only an issued card', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /<div class="cardview" id="cardView" role="dialog" aria-modal="true"/);
  for (const tool of ['pdf', 'a4', 'png-front', 'png-back', 'photo']) assert.match(html, new RegExp(`data-view-do="${tool}" data-issued>`), `${tool} is for an issued card only`);
  assert.match(html, /data-view-do="actual" aria-pressed="false">Show actual card size</);
  assert.match(html, /\.cardview\[data-mode="preview"\] \[data-issued\]\{display:none\}/, 'an application is shown, never printed');
  assert.match(html, /var issued = Boolean\(opts && opts\.issued\) && window\.PFACaregiverCard\.isIssued\(data\)/);
  /* the ways in */
  assert.match(html, /data-ap="view"/, 'Applications to decide: the card itself');
  assert.match(html, /data-case-view/, 'the application drawer');
  assert.match(html, /data-view-card="/, 'Print and post');
  assert.match(html, /data-studio="/, 'the register in Colony cards');
  /* Escape closes the studio, not the drawer under it */
  assert.match(html, /if \(e\.key !== 'Escape' \|\| \$\('#cardView'\)\.hidden\) return;\s*e\.stopImmediatePropagation\(\);\s*shutView\(\);\s*\}, true\);/);
  /* Print and post offers both PDFs */
  assert.match(html, />PDF for the card printer</);
  assert.match(html, />PDF on A4 paper</);
});
