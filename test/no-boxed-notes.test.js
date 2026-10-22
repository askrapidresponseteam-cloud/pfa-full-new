'use strict';

/* No boxed notes, anywhere on the site.

   Owner, 9 Oct 2026, of the Academy's "Careful" block (a pink tint, a red
   bar down its left edge and a small-caps CAREFUL over the sentence): it looked
   like a stock template, and nothing like it belongs anywhere on the
   website. The stock note box is what template pages look like. A warning,
   an instruction or a standing note is set the way a printed guide sets it:
   a sentence that starts with its bold word. "Careful. Never give an
   injectable by mouth ...". These hold that: no bar down the left of
   anything, no tinted wash behind a note, and the run-in words where the
   boxes were. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SOURCES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.css')).map((f) => 'assets/' + f));

test('no bar down the left of anything', () => {
  const found = [];
  for (const file of SOURCES) {
    const css = read(file);
    for (const m of css.matchAll(/([^{};]*)\{([^}]*)\}/g)) {
      if (/(?:^|;)\s*border-(?:left|inline-start)\s*:\s*(?:[2-9]|\d{2,})(?:\.\d+)?px/.test(m[2])) found.push(`${file}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(found, [], 'a coloured bar down the left edge is the stock note box');
});

test('no tinted wash behind a warning', () => {
  for (const file of ['academy.html', 'laws.html']) {
    const css = read(file);
    assert.doesNotMatch(css, /\.qa__(?:do|care)\{[^}]*background/, `${file}: the Do and Careful lines sit on the page`);
    assert.doesNotMatch(css, /\.qa__(?:do|care) span\{[^}]*text-transform:uppercase/, `${file}: the word is a word, not a label`);
  }
  assert.doesNotMatch(read('academy.html'), /\.qa__case\{[^}]*background/);
  assert.doesNotMatch(read('academy.html'), /\.bdg\{[^}]*border:/, 'what a lesson holds is a line of words, not boxed tags');
});

test('the warnings read as sentences that start with their bold word', () => {
  for (const file of ['academy.html', 'laws.html']) {
    const css = read(file);
    assert.match(css, /\.qa__do span::after,\.qa__care span::after\{content:"\."\}/, `${file}: "Careful." then the sentence`);
  }
  const academy = new JSDOM(read('academy.html')).window.document;
  assert.ok(academy.querySelectorAll('.qa__care > span').length >= 10, 'the Careful lines are still there');
  assert.equal(academy.querySelector('.note p > b').textContent, 'Read this first.');
  const laws = new JSDOM(read('laws.html')).window.document;
  assert.equal(laws.querySelector('.note p > b').textContent, 'Before you cite any of this.');
  assert.equal(laws.querySelector('.note > b'), null, 'no badge beside the note');
});
