'use strict';

/* Owner, 29 Oct 2026, of the colony card previews: "can u ensure no part of
   the photo is clipped". Every card draws the whole photograph inside its
   window, and the membership photo control starts from the whole picture,
   so no part of anyone's photograph is ever cut to fit. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the colony card fits the whole photograph in its window: the scale is the smaller one, never the larger', () => {
  const src = read('assets/caregiver-card.js');
  assert.match(src, /function fitWhole\(image, b\) \{[\s\S]*?var ratio = Math\.min\(b\.w \/ iw, b\.h \/ ih\);/);
  assert.match(src, /var fit = fitWhole\(data\.photoImage, well\);\s*ctx\.drawImage\(data\.photoImage, P\.v\(fit\.x\), P\.v\(fit\.y\), P\.v\(fit\.w\), P\.v\(fit\.h\)\);/);
  /* and the numbers: a tall full-length photo and a wide one both land wholly inside the well */
  const ctx = { window: {}, document: { createElement: () => ({ getContext: () => ({}) }) }, Image: function () {}, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const C = ctx.window.PFACaregiverCard;
  const well = C.photoWell();
  for (const [w, h] of [[400, 1200], [1600, 900], [700, 790]]) {
    const fit = C.photoFit({ naturalWidth: w, naturalHeight: h });
    assert.ok(fit.x >= well.x - 1e-9 && fit.y >= well.y - 1e-9 && fit.x + fit.w <= well.x + well.w + 1e-9 && fit.y + fit.h <= well.y + well.h + 1e-9, `${w}x${h} inside the window`);
    assert.ok(Math.abs(fit.w / fit.h - w / h) < 1e-9, `${w}x${h} keeps its shape`);
  }
});

test('the membership photo control starts from the whole photograph on white, and the membership card draws it whole', () => {
  const ed = read('assets/photo-editor.js');
  const paint = ed.slice(ed.indexOf('function paint('), ed.indexOf('function maxZoom('));
  assert.match(paint, /var whole = Math\.min\(targetWidth \/ image\.width, targetHeight \/ image\.height\);/);
  assert.match(paint, /context\.fillStyle = '#ffffff';/);
  assert.doesNotMatch(paint, /Math\.max\(targetWidth \/ image\.width/, 'not the old fill-and-crop');
  assert.match(ed, /zoomInput\.max = String\(Math\.round\(maxZoom\(image\) \* 100\)\);/, 'zooming in is the person\'s choice');
  assert.match(read('assets/member-card.js'), /var scale = Math\.min\(P\.w \/ photo\.width, P\.h \/ photo\.height\);/);
});
