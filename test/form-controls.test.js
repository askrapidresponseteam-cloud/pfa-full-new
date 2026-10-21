'use strict';

/* Dropdowns and field labels, drawn one way across the whole site.

   Owner, 21 Oct 2026: "dropdown cannot be so close to the edge.. anywhere
   across the site.. fix it wholistically. and also look at the pos of your
   mobile number field and name.. they are at diff pos. fix across the site.."

   Measured in Chromium before the fix: 13 dropdowns on five pages left the
   arrow to the browser (Safari draws it against the edge), nine on six pages
   drew their own 13 px in, each page with its own copy, and on ask.html the
   Mobile box stood 4 px below Your name because `.field small`, the rule for
   the hint under an input, also caught the "(optional)" inside the label.
   One rule for each now lives in assets/chrome.css (and in admin.html, which
   does not load it). These tests keep it the only one. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const SELECT_RULE = 'body select:not([multiple]):not([size]){';
const LABEL_RULE = 'body label :is(small,.opt){font-size:inherit;line-height:inherit';

function declarations(css, rule) {
  const at = css.indexOf(rule);
  return at < 0 ? '' : css.slice(at + rule.length, css.indexOf('}', at));
}

test('one rule draws every dropdown: an arrow 20 px in, and the text kept clear of it', () => {
  for (const [file, css] of [['assets/chrome.css', read('assets/chrome.css')], ['admin.html', read('admin.html')]]) {
    const d = declarations(css, SELECT_RULE);
    assert.ok(d, `${file} lost the dropdown rule`);
    assert.match(d, /(^|;)appearance:none/, `${file}: the browser must not draw its own arrow`);
    assert.match(d, /background-position:right 20px center/, `${file}: the arrow sits 20 px in`);
    assert.match(d, /padding-right:46px/, `${file}: and the text stops before it`);
  }
});

test('every page with a dropdown gets that rule', () => {
  for (const page of pages) {
    const html = read(page);
    if (!/<select\b/.test(html)) continue;
    if (page === 'admin.html') { assert.ok(html.includes(SELECT_RULE)); continue; }
    assert.match(html, /<link rel="stylesheet" href="assets\/chrome\.css/, `${page} has a dropdown but does not load assets/chrome.css`);
  }
});

test('no page draws a dropdown arrow of its own, or puts the browser\'s back', () => {
  for (const page of pages) {
    if (page === 'admin.html') continue;
    const css = [...read(page).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    for (const m of css.matchAll(/([^{}]*\bselect\b[^{}]*)\{([^}]*)\}/g)) {
      const [, sel, body] = m;
      assert.doesNotMatch(body, /background-image|background-position/, `${page}: "${sel.trim()}" draws its own arrow`);
      assert.doesNotMatch(body, /appearance:\s*(auto|menulist)/, `${page}: "${sel.trim()}" hands the arrow back to the browser`);
      assert.doesNotMatch(body, /padding-right:[^;]*!important/, `${page}: "${sel.trim()}" forces text under the arrow`);
    }
  }
});

test('a note inside a label can never make that label taller than its neighbour', () => {
  for (const [file, css] of [['assets/chrome.css', read('assets/chrome.css')], ['admin.html', read('admin.html')]]) {
    assert.ok(css.includes(LABEL_RULE), `${file} lost the label-note rule`);
  }
  /* it must outrank `.field small` (one class, one element) without
     !important: :is(small,.opt) counts as a class, body adds an element */
  const pagesWithNotes = pages.filter((p) => /<label[^>]*>[^<]*<(small|span class="opt")/.test(read(p)));
  assert.ok(pagesWithNotes.length >= 10, 'the labels this guards are still there');
  for (const page of pagesWithNotes) {
    const html = read(page);
    assert.doesNotMatch(html, /label (small|\.opt)\{[^}]*(font-size|line-height)[^}]*!important/, `${page} overrides the label note's size`);
  }
});
