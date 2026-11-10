'use strict';

/* Fireworks and animals (owner, 10 Nov 2026: "can you build a page related
   fireworks- indian context. and ensure it aligns with pfa site theme", after
   https://www.rspca.org.uk/adviceandwelfare/fireworks).

   Held here: the facts it states are the ones its sources give (the hours,
   the 125 dB limit, the sections of the law, 112), every way out of it leads
   somewhere real on this site, it is built from the site's own parts, and it
   keeps the house rules on dashes and outside links. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('fireworks.html');
const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
const words = main.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the law as its sources give it', () => {
  assert.match(words, /No crackers from 10 pm to 6 am\./);
  assert.match(words, /100 metres around a hospital, a school, a court or a place of worship/);
  assert.match(words, /Supreme Court, In re Noise Pollution, 2005\./);
  assert.match(words, /between 8 and 10 pm, or the two hours your state sets/);
  assert.match(words, /11:55 pm to 12:30 am/);
  assert.match(words, /Arjun Gopal v Union of India, 2018\./);
  assert.match(words, /No cracker louder than 125 dB at 4 metres\./);
  assert.match(words, /125 dB\(AI\), or 145 dB\(C\) at the peak, measured 4 metres/);
  assert.match(words, /Section 11\(1\)\(a\) of the Prevention of Cruelty to Animals Act, 1960/);
  assert.match(words, /Section 325 of the Bharatiya Nyaya Sanhita carries up to five years/);
  assert.match(words, /30 broke the limit/);
  assert.match(words, /Call 112 first\./);
});

test('every way out leads somewhere real', () => {
  assert.match(main, /href="report\.html"/);
  assert.match(main, /href="units\.html"/);
  assert.match(main, /href="academy\.html#g9"/);
  assert.match(read('academy.html'), /id="g9"/, 'first aid for burns is where the link says');
  assert.match(main, /href="laws\.html#d8"/);
  assert.match(read('laws.html'), /id="d8"/);
  for (const a of main.match(/<a [^>]*href="https:[^"]*"[^>]*>/g) || []) {
    assert.match(a, /target="_blank"/, a);
    assert.match(a, /rel="noopener noreferrer"/, a);
  }
  for (const id of ['top', 'loud', 'who', 'safe', 'when', 'law', 'instead']) assert.match(main, new RegExp(`<section class="[^"]*" id="${id}"`), id);
  assert.match(main, /href="#safe"/);
  assert.match(main, /href="#law"/);
});

test('built from the site\'s own parts, and in the menu under Learn', () => {
  assert.match(main, /<h1 class="pfa-title display">A festival of light\. Not of fear\.<\/h1>/);
  assert.match(main, /class="band band--deep fw-loud split"/, 'the theme\'s dark band, so its label and rule read on black');
  assert.match(html, /<link rel="stylesheet" href="assets\/pfa-theme\.css">/);
  assert.match(read('assets/chrome-header.html'), /\{\{CURRENT:fireworks\.html\|Fireworks and animals\}\}/);
  assert.match(read('assets/chrome-footer.html'), /<a href="fireworks\.html">Fireworks and animals<\/a>/);
  assert.equal((main.match(/<details class="fw-more"/g) || []).length, 4, 'more under a plus, as the owner asks');
});

test('no long dashes, anywhere on the two new pages', () => {
  for (const f of ['fireworks.html', 'gifts.html', 'assets/gifts.js', 'assets/admin-gifts.js', 'lib/gift-seasons.js']) {
    assert.doesNotMatch(read(f), /[–—]/, f);
  }
});
