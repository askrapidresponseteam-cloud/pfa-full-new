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
  assert.match(html, /<header>\s*<div>\s*<h2 class="ttl" id="caseTitle">[\s\S]*?<\/div>\s*(?:<div class="cnav" id="caseNav" hidden>[\s\S]*?<\/div>\s*)?<button class="x pfa-close" type="button" id="caseShut">Close<\/button>\s*<\/header>/);
  assert.match(html, /\.drawer header\{justify-content:space-between\}/);
  assert.match(html, /\.drawer header > div\{flex:1 1 auto;min-width:0\}/);
  assert.doesNotMatch(html, /\.drawer header \.x\{margin-left:auto/, 'a margin the shared style overrides is not what places it');
});

/* Owner, 14 Nov 2026: "this kinda thing on the right is not easy to
   navigate. can you make it full screen and easy to nav from 1 ticket to
   another". */
test('a case opens full screen, and Previous, Next and the arrow keys walk the list it came from', () => {
  const root = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const html = read('admin.html');
  const css = read('assets/admin-case-nav.css');
  const js = read('assets/admin-case-nav.js');
  assert.match(html, /<link rel="stylesheet" href="assets\/admin-case-nav\.css">/);
  assert.match(html, /<script src="assets\/admin-case-nav\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-case-nav\.css', 'assets\/admin-case-nav\.js'/, 'in the panel\'s Firebase bundle');
  assert.match(css, /^\.drawer\{width:100%\}$/m, 'the whole screen');
  assert.match(css, /\.drawer\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(360px,440px\)/, 'what was sent on the left, what to do on the right');
  assert.match(css, /\.drawer \.act\{grid-column:2;grid-row:2;[^}]*overflow-y:auto/, 'the actions always in view');
  assert.match(html, /<button class="ghost" type="button" id="casePrev"[^>]*>[\s\S]*?Previous<\/button>\s*<span class="note" id="caseAt" aria-live="polite"><\/span>\s*<button class="ghost" type="button" id="caseNext"/);
  assert.match(js, /A\.showCase\(asked\)/, 'asks the panel for the case, as a row does');
  assert.match(js, /\$\('caseAt'\)\.textContent = \(nav\.at \+ 1\) \+ ' of ' \+ n;/);
  assert.match(js, /if \(t && \(t\.isContentEditable \|\| \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\.tagName\)\)\) return;/, 'arrows never fight typing');
  assert.match(js, /if \(box && !box\.value && drafts\[ref\]\) box\.value = drafts\[ref\];/, 'a reply typed and not sent is kept when moving on');
  assert.doesNotMatch(css + js, /[\u2013\u2014]/, 'no long dash');
});
