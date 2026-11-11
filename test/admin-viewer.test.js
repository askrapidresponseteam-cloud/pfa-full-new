'use strict';
/* The panel's photograph viewer (owner, 11 Nov 2026, of a case's
   photographs: "not able to view any of these within viewer"). Each opened
   as a link to its own data: address in a new tab, which browsers refuse to
   open. They open in assets/admin-viewer.js instead, over the panel.
   Checked in a browser at 1280 and 390 wide: whole on the screen, Next and
   Previous and the arrow keys, Rotate (redrawn turned, so it still fits and
   scrolls at actual size), Actual size, a PDF in the browser's own reader,
   Download, and Escape to close. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const admin = read('admin.html');
const js = read('assets/admin-viewer.js');

test('a case\'s photographs open in the panel\'s viewer, never as a data: link in a new tab', () => {
  assert.doesNotMatch(admin, /open\.href = img\.src; open\.target = '_blank'/);
  assert.doesNotMatch(admin, /href = 'data:/);
  assert.match(admin, /open\.type = 'button'; open\.className = 'shot-open';/);
  assert.match(admin, /window\.PFAViewer\.open\(figs\.map\(function \(f\) \{ return \{ src: f\.dataset\.src, type: f\.dataset\.type, label: f\.dataset\.label \}; \}\), figs\.indexOf\(b\.closest\('figure'\)\)\);/, 'all of them, in the order they were sent, from the one pressed');
  assert.match(admin, /if \(\/pdf\/i\.test\(type\)\) \{ var doc = document\.createElement\('span'\); doc\.className = 'shot-doc'; doc\.textContent = 'PDF';/, 'a PDF shows as one, not a broken picture');
  assert.match(admin, /<script src="assets\/admin-site-designs\.js"><\/script>\n<script src="assets\/admin-viewer\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-viewer\.js'/, 'shipped with the panel');
  assert.ok(fs.statSync(path.join(__dirname, '..', 'admin.html')).size < 409600, 'the panel stays under its ceiling');
});

test('the viewer is the panel\'s own: a top bar, the stage, one control bar, the strip; a PDF drawn by pdf.js, never the browser\'s reader', () => {
  /* owner, 11 Nov 2026: "it has to be enterprise grade viewer within the portal not like a pdf viewed" */
  assert.doesNotMatch(js, /createElement\('iframe'\)|<iframe|<embed|<object/, 'no browser PDF reader');
  assert.match(js, /libPromise = import\(BASE \+ 'pdf\.min\.js'\)/, 'the site\'s own pdf.js');
  assert.match(js, /pdfjs\.getDocument\(\{ data: bytesFrom\(it\.src\), wasmUrl: BASE \+ 'wasm\/', isEvalSupported: false, enableXfa: false \}\)/);
  assert.match(js, /p\.render = page\.render\(\{ canvasContext: c\.getContext\('2d'\), viewport: vp \}\);/, 'each page drawn on a canvas, near the screen');
  assert.match(js, /\$\('\[data-pv-pageat\]'\)\.textContent = 'Page ' \+ n \+ ' of ' \+ v\.pages\.length;/);
  for (const part of ['data-pv-name', 'data-pv-meta', 'data-pv-strip', 'data-pv-zoom', 'data-pv-pageat']) assert.ok(js.includes(part), part);
  for (const what of ['prev', 'next', 'in', 'out', 'reset', 'fit', 'rotate', 'save', 'close']) assert.ok(js.includes(`data-pv="${what}"`), what);
  /* a photograph whole on the screen, zoomed about the pointer, dragged when larger, pinched on a phone */
  assert.match(js, /return Math\.min\(\(b\.w - 48\) \/ v\.w, \(b\.h - 96\) \/ v\.h, 1\);/, 'fitted, never cut, never blown up past its own size');
  assert.match(js, /if \(e\.ctrlKey \|\| e\.metaKey\) \{/);
  assert.match(js, /if \(d > 0\) view\.zoomBy\(d \/ drag\.pinch,/, 'two fingers pinch');
  assert.match(js, /g\.rotate\(quarter \* Math\.PI \/ 2\);/, 'turned by redrawing, so it lays out at its new shape');
  assert.match(js, /else if \(k === '0'\) \{ e\.preventDefault\(\); view\.fit\(\); \}/);
  assert.match(js, /'\.pv \[hidden\]\{display:none!important\}'/);
  assert.doesNotMatch(js, /[^\x00-\x7f]/, 'plain ASCII, so it reads the same however it is served');
  assert.doesNotMatch(js, /[–—]/, 'no long dash');
  /* pdf.js goes with the panel */
  const fb = read('scripts/build-firebase.js');
  for (const f of ['assets/vendor/pdfjs/pdf.min.js', 'assets/vendor/pdfjs/pdf.worker.min.js', 'assets/vendor/pdfjs/wasm/openjpeg.wasm']) assert.ok(fb.includes(`'${f}'`), f);
});
