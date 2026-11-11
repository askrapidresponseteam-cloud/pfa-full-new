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

/* v1.555: the full guide, "A Quieter Celebration", read and downloaded as
   the Library offers its documents (owner, 10 Nov 2026: "have this pdf -
   view + download like in library module within the fireworks page"),
   set in the site's own type, and kept off the Library's shelves. */
test('the fireworks page offers the guide to read and to download', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const R = path.join(__dirname, '..');
  const page = fs.readFileSync(path.join(R, 'fireworks.html'), 'utf8');
  assert.match(page, /<section class="band split" id="guide">/);
  assert.match(page, /<link rel="stylesheet" href="assets\/library\.css">/);
  assert.match(page, /class="book__read" href="read\.html\?r=a-quieter-celebration">Read now</);
  assert.match(page, /class="book__dl" href="media\/library\/a-quieter-celebration\.pdf" download="A Quieter Celebration\.pdf"/);
  assert.ok(fs.existsSync(path.join(R, 'media/library/a-quieter-celebration.pdf')));
  assert.ok(fs.existsSync(path.join(R, 'media/library/covers/a-quieter-celebration.webp')));
  const lib = JSON.parse(fs.readFileSync(path.join(R, 'data/library.json'), 'utf8'));
  const it = lib.items.find((x) => x.slug === 'a-quieter-celebration');
  assert.ok(it && it.own === true && it.listed === false, 'in the catalogue, off the shelves');
  assert.ok(!fs.readFileSync(path.join(R, 'library.html'), 'utf8').includes('a-quieter-celebration'), 'not on a shelf');
  assert.ok(fs.readFileSync(path.join(R, 'assets/library-data.js'), 'utf8').includes('"slug": "a-quieter-celebration"'), 'the reader can open it');
  const pdf = fs.readFileSync(path.join(R, 'media/library/a-quieter-celebration.pdf'), 'latin1');
  assert.match(pdf, /Marcellus/, 'set in the site\'s display face');
  assert.ok(pdf.length < 4 * 1024 * 1024, 'small enough to download on a phone');
});
