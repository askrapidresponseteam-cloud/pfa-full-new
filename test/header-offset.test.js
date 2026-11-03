'use strict';

/* The header is fixed at `top: var(--ann)`, where --ann is the height of the
   announcement bar above it. The shared stylesheet defaults that to 34px.

   quiz.html and get-involved.html both took the stylesheet and
   none of them has an announcement bar, so the header hung 34px down the
   viewport with the page scrolling through the empty strip behind it. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const CHROME_CSS = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.css'), 'utf8');
const CHROME_JS = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.js'), 'utf8');

/* Comments mentioning --ann are not rules; an earlier version of this check
   read its own explanation as a declaration. */
const rules = (html) => html.replace(/\/\*[\s\S]*?\*\//g, '');

function state(html) {
  /* The header rule lives in assets/chrome.css; a page uses it by linking
     the stylesheet and carrying a header.site. */
  const usesAnn = /assets\/chrome\.css/.test(html) && /<header class="site"/.test(html) &&
    /position:fixed[^}]*top:var\(--ann/.test(CHROME_CSS);
  /* index.html names its bar `pfa-ann`, not `announce`. The check knew only
     the shop's naming and reported the home page as broken. */
  const hasBar = /id="announce"|class="[^"]*\b(announce|pfa-ann)\b/.test(html);
  const defs = [...rules(html).matchAll(/--ann:\s*([^;}]+)/g)].map((m) => m[1].trim());
  return { usesAnn, hasBar, effective: defs[defs.length - 1] || null };
}

test('sanity: the pages and the rule were found', () => {
  const using = pages.filter((p) => state(fs.readFileSync(path.join(ROOT, p), 'utf8')).usesAnn);
  assert.ok(using.length >= 10, `only ${using.length} pages pin the header to --ann`);
});

test('no page reserves space for an announcement bar it does not have', () => {
  const broken = [];
  for (const page of pages) {
    const s = state(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    if (!s.usesAnn || s.hasBar) continue;
    if (s.effective !== '0px') broken.push(`${page} (--ann = ${s.effective})`);
  }
  assert.deepEqual(broken, [],
    `the header would hang below the top of these, with the page scrolling behind it: ${broken.join(', ')}`);
});

test('pages that do have a bar still reserve room for it', () => {
  for (const page of pages) {
    const s = state(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    if (!s.usesAnn || !s.hasBar) continue;
    assert.notEqual(s.effective, '0px', `${page} has a bar but reserves no space for it`);
  }
});

test('the header height is re-measured, not assumed', () => {
  /* --nav is a hard-coded 69px in the stylesheet. The nav wraps on a narrow
     window and gets taller, which tucks the top of the page underneath it. */
  assert.match(CHROME_JS, /setProperty\('--nav', head\.offsetHeight \+ 'px'\)/, 'chrome.js must measure the header');
  assert.match(CHROME_JS, /addEventListener\('resize', measure\)/, 'and re-measure on resize');
  for (const page of ['quiz.html', 'get-involved.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="\/?assets\/chrome\.js(?:\?v=[a-f0-9]{10})?"><\/script>/, `${page} must load chrome.js`);
  }
});

test('the check would catch a page that forgot', () => {
  /* Every page has the bar now (sync-chrome stamps it), so the case is
     simulated: take the bar out of quiz.html and the detector must see a
     header pinned to --ann with nothing reserving that space. */
  const html = fs.readFileSync(path.join(ROOT, 'quiz.html'), 'utf8');
  const without = html.replace(/<div class="announce" id="announce"[\s\S]*?<\/div>\n/, '');
  const s = state(without);
  assert.equal(s.usesAnn, true);
  assert.equal(s.hasBar, false);
  assert.notEqual(s.effective, '0px', 'the detector must notice nothing zeroes the reservation');
});

const testW = require('node:test');
const assertW = require('node:assert/strict');
const fsW = require('node:fs');

testW('an anchor jump lands the wall\u2019s third bar on its dock, and the title clear of it', () => {
  /* The wall alone stacks a third sticky bar on top of the announcement and
     the header. Two things have to be true when an anchor arrives, and the
     first fix for one of them broke the other.

     1 Sep 2026: "Browse the wall" landed the LONG FORM title halfway under
     the bar, so the margin was pushed to 63px to clear it. But the bar sits
     exactly 51px above #longform in the flow, so a jump lands its top at
     (ann + nav + N) - 51. At N=63 that is 127 against a dock point of
     ann + nav - 1 = 114: thirteen pixels short. An undocked bar does not
     cover the header's border, so long form showed a rule above the links
     and a rule below them while short form, far enough down to have docked
     already, showed one (reported 15 Sep 2026).

     So N must be small enough to dock the bar, and the title is held clear
     by the section's own --band instead, which is what has the room for it.
     Measured at N=44: bar docked at 114, section top at 159, title at 281,
     one rule on the strip. */
  const wall = fsW.readFileSync(`${__dirname}/../wall.html`, 'utf8');
  const m = /section\[id\]\{scroll-margin-top:calc\(var\(--ann\) \+ var\(--nav\) \+ (\d+)px\)\}/.exec(wall);
  assertW.ok(m, 'wall.html gives its anchor targets a scroll margin');
  const N = Number(m[1]);

  const barH = Number(/\.subnav div\{[^}]*height:(\d+)px/.exec(wall)[1]) + 1;   // 50 and its rule
  assertW.equal(barH, 51, 'the bar is still 50px and a rule; the sums below assume it');
  const dockedAt = N + 64;        // (ann + nav + N) - barH, with ann + nav = 115
  assertW.ok(dockedAt <= 114,
    `a jump parks the bar at ${dockedAt}, past its dock at 114, so the header's rule shows above it and the bar's below: two lines`);

  /* What the docked bar covers of the section it jumped to, and what the
     section's own top padding has to beat for the title to stay below it. */
  const hidden = 165 - (115 + N);
  const bandMin = Number(/--band:clamp\((\d+)px/.exec(wall)[1]);
  assertW.ok(bandMin > hidden,
    `the bar covers ${hidden}px of the section and --band only offers ${bandMin}px, so the title lands under it`);
});
