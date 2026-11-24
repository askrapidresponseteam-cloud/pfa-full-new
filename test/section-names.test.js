'use strict';

/* The Wire became Newsroom. The section carries actual news, so it is named
   the way a news section is named - the term press and visitors look for.

   Two earlier candidates were dropped for concrete reasons, not taste:
   "The Wire" collides with thewire.in, a major Indian news publication, and
   sat beside The Wall in the nav; "Dispatches" collides with `dispatched`,
   which already means "the card has been posted" throughout the caregiver
   shipment flow in lib/caregiver.js. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { walk } = require('../scripts/rename-section.js');

const ROOT = path.join(__dirname, '..');
const live = () => walk(ROOT).filter((f) => !f.includes(`${path.sep}test${path.sep}`));

test('the page exists under the new slug and the old one is gone', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'newsroom.html')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'the-wire.html')));
});

test('no live file still says The Wire or Dispatches, or links to the old slugs', () => {
  /* The host configs are the exception and have to be: a redirect's whole job
     is to name the old URL. Both are listed, because the site can deploy to
     either and each carries the same four redirects. */
  const HOST_CONFIG = new Set(['vercel.json', 'firebase.json']);
  const offenders = live()
    .filter((f) => !HOST_CONFIG.has(path.basename(f)))
    .filter((file) => /The Wire|the-wire\.html|\bDispatches\b|dispatch\.html/.test(fs.readFileSync(file, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [], `still carrying the old name: ${offenders.join(', ')}`);
});

test('the old URL redirects rather than 404s', () => {
  /* Checked on both hosts. A redirect that exists on Vercel and not on Firebase
     would 404 the moment the site moved. */
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  /* the public website's Firebase site carries the site's redirects (24 Nov 2026) */
  const onFirebase = ([].concat(firebase.hosting || []).find((h) => h.target === 'site') || {}).redirects || [];
  for (const source of ['/the-wire.html', '/dispatch.html']) {
    assert.ok(onFirebase.some((r) => r.source === source && r.destination === '/newsroom.html'),
      `Firebase would 404 on ${source}`);
  }
  const redirects = vercel.redirects || [];
  /* Both former URLs, so nothing that ever pointed here breaks. */
  for (const source of ['/the-wire.html', '/dispatch.html']) {
    const hit = redirects.find((r) => r.source === source);
    assert.ok(hit, `${source} must not 404`);
    assert.equal(hit.destination, '/newsroom.html');
    assert.equal(hit.permanent, true, 'permanent, so search engines follow it');
  }
});

test('someone who remembers either old name still finds the page', () => {
  const search = fs.readFileSync(path.join(ROOT, 'pfa-search.js'), 'utf8');
  const row = search.match(/\{ t: 'Newsroom',[\s\S]*?k: '([^']*)'/);
  assert.ok(row, 'the curated row must exist');
  assert.match(row[1], /\bwire\b/, 'The Wire has to stay searchable');
  assert.match(row[1], /\bdispatch/, 'and so does Dispatches');
});

test('every page in the nav points at a file that exists', () => {
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* index.html's header does not carry class="site"; the first <header> is it. */
  const start = home.indexOf('<header');
  assert.ok(start > -1, 'sanity: the home page has a header');
  const header = home.slice(start, home.indexOf('</header>', start));
  const targets = [...header.matchAll(/href="([\w-]+\.html)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 5, 'sanity: the nav links were found');
  const missing = [...new Set(targets)].filter((t) => !fs.existsSync(path.join(ROOT, t)));
  assert.deepEqual(missing, [], `nav points at missing pages: ${missing.join(', ')}`);
});

test('the rename did not touch the caregiver shipment vocabulary', () => {
  /* `dispatched` is a shipment status, not the news section. A blanket
     find-and-replace on the word would have broken the card flow. */
  const flow = fs.readFileSync(path.join(ROOT, 'lib', 'caregiver.js'), 'utf8');
  assert.match(flow, /'dispatched'/, 'the status must survive');
  assert.match(flow, /dispatched: 'Dispatched'/, 'and its label');
});
