'use strict';

/* The Pet Parent Series (series.html, 11 Nov 2026). Owner: "it has to play
   like a movie in the right sequence", for a closed user group. A closed
   preview: reached by its address only, never offered by the site. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('series.html');
const data = JSON.parse(read('assets/series.json'));

test('the series list is well formed: every episode has a title and one source', () => {
  assert.ok(data.title && Array.isArray(data.chapters) && data.chapters.length);
  for (const ch of data.chapters) {
    assert.ok(ch.title, 'a chapter has a title');
    assert.ok(Array.isArray(ch.episodes) && ch.episodes.length, `${ch.title}: has episodes`);
    for (const e of ch.episodes) {
      assert.ok(e.title, 'an episode has a title');
      const sources = ['yt', 'vimeo', 'src'].filter((k) => e[k]);
      assert.equal(sources.length, 1, `${e.title}: exactly one of yt, vimeo or src`);
      if (e.poster) assert.ok(fs.existsSync(path.join(ROOT, e.poster)), `${e.title}: poster ${e.poster} is on the site`);
    }
  }
});

test('the page plays the list through the one theatre, in order', () => {
  assert.match(html, /<script src="assets\/theatre\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="assets\/theatre\.css">/);
  assert.match(html, /fetch\('assets\/series\.json'/);
  assert.match(html, /progKey: PROG_KEY/);
  assert.match(html, /onProgress: noted/);
});

test('a closed preview: out of search engines, site search, the sitemap and every page', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /seo:start/);
  const { EXCLUDE } = require('../scripts/build-search-index.js');
  assert.ok(EXCLUDE.has('series.html'));
  assert.doesNotMatch(read('sitemap.xml'), /\/series</);
  const linking = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'series.html')
    .filter((f) => /href="\/?series(\.html)?["#?]/.test(read(f)));
  assert.deepEqual(linking, [], 'no page links to it');
});

test('the panel can still show or hide it', () => {
  const mods = JSON.parse(read('assets/site-modules.json'));
  const page = mods.pages.find((p) => p.id === 'series');
  assert.ok(page, 'listed in the panel');
  assert.deepEqual(page.modules.map((m) => m.id), ['top', 'episodes']);
});

test('no dashes in the words', () => {
  const words = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(words, /[–—]/);
  assert.doesNotMatch(JSON.stringify(data), /[–—]/);
});
