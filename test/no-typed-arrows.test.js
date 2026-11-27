'use strict';

/* No typed arrows anywhere a visitor, an intern or PFA's staff reads
   (owner, 27 Nov 2026: "never have this kinda arrows", of "ROSIE'S HEROES ↗"
   and "PARTNER WITH PFA ↗"). Not as a character, not as an HTML entity,
   not as a JavaScript escape: a back link or a step carries the site's drawn
   chevron (.pfa-chev in assets/chrome.css), a keyboard key is named in words
   (Left, Right, Up, Down), and a link needs nothing after it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ARROW = /[←-⇿➔-➿⬀-⬑‹›▶◀▸◂]|&(lsaquo|rsaquo|rarr|larr|uarr|darr|harr|nearr|nwarr|searr|swarr|rArr|lArr|xrarr);|&#(8592|8593|8594|8595|8596|8598|8599|8600|8601|x219[0-9a-f]);|\\u21[9a-f][0-9a-f]|\\u203[9a]|\\u2b0[0-9a-f]/i;

function files() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (/\.html$/.test(f) || f === 'pfa-search.js') out.push(f);
  for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) if (/\.(js|css|html)$/.test(f)) out.push(path.join('assets', f));
  /* the emails, letters and certificates the server writes */
  for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) if (/\.js$/.test(f)) out.push(path.join('lib', f));
  return out;
}

test('no typed arrow on any page, in any script or style the site sends, or in any email', () => {
  const found = [];
  for (const f of files()) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const m = ARROW.exec(line);
      if (m) found.push(`${f}:${i + 1}: ${line.slice(Math.max(0, m.index - 40), m.index + 20).trim()}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the drawn chevron that stands in for them is defined once, for every page', () => {
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.css'), 'utf8');
  assert.match(css, /\.pfa-chev\{[^}]*border-left:1\.5px solid currentColor;border-bottom:1\.5px solid currentColor;transform:rotate\(45deg\)/);
  assert.match(css, /\.pfa-chev--r\{transform:rotate\(-135deg\)/);
});
