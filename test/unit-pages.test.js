'use strict';

/* A page of its own for every unit (owner, 3 Nov 2026: unit pages that rank
   for "animal ambulance near me"), in the sitemap, linked from units.html,
   and a Google Business Profile sheet with a row for each unit and the
   Care Centre. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UP = require('../scripts/build-unit-pages');

test('every unit has a current page, and only those', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-unit-pages.js'), '--check'], { stdio: 'pipe' });
  const list = JSON.parse(read('assets/unit-pages.json')).units;
  assert.ok(list.length >= 80, `${list.length} units`);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'units')).filter((f) => f.endsWith('.html')).sort(), list.map((u) => u.slug + '.html').sort());
  assert.equal(new Set(list.map((u) => u.slug)).size, list.length, 'one page per unit');
});

test('a unit page: its facts, its structured data, links that work from one folder down', () => {
  const list = JSON.parse(read('assets/unit-pages.json')).units;
  for (const u of list) {
    const html = read(`units/${u.slug}.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://peopleforanimalsindia\\.org/units/${u.slug}">`));
    assert.match(html, /<base href="\/">/);
    assert.match(html, /<title>Animal rescue in [^<]+ \| People for Animals<\/title>/);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const shelter = ld.find((x) => x['@type'] === 'AnimalShelter');
    assert.ok(shelter, u.slug);
    assert.equal(shelter.address.addressRegion, u.state);
    if (u.phones.length) assert.match(html, new RegExp(`href="tel:${UP.tel(u.phones[0]).replace('+', '\\+')}"`));
    assert.doesNotMatch(html, /[–—]/, `${u.slug}: no long dashes`);
    assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /href="(?!\/|https?:|tel:|mailto:|#)[^"]+"/, `${u.slug}: every link resolves from the root`);
    assert.match(html, /<footer class="pfa-footer"/);
  }
});

test('found from the list page, the sitemap and site analytics', () => {
  const list = JSON.parse(read('assets/unit-pages.json')).units;
  const units = read('units.html');
  const sitemap = read('sitemap.xml');
  for (const u of list) {
    assert.ok(units.includes(`href="units/${u.slug}.html"`), `units.html links ${u.slug}`);
    assert.ok(sitemap.includes(`<loc>https://peopleforanimalsindia.org/units/${u.slug}</loc>`), `sitemap has ${u.slug}`);
  }
  const A = require('../lib/analytics'); A._reset();
  assert.equal(A.pageKey(`/units/${list[0].slug}`), `units~${list[0].slug}`);
  assert.match(read('scripts/build-firebase.js'), /'units'\]/);
});

test('the Google Business Profile sheet: the Care Centre and every unit, each pointing at its page', () => {
  const rows = require('../scripts/build-gbp-sheet').rows();
  const list = JSON.parse(read('assets/unit-pages.json')).units;
  assert.equal(rows.length, list.length + 1);
  assert.equal(rows[0]['Business name'], 'Sanjay Gandhi Animal Care Centre');
  assert.equal(rows[0]['Postal code'], '110027');
  for (const r of rows.slice(1)) {
    assert.match(r.Website, /^https:\/\/peopleforanimalsindia\.org\/units\/[a-z0-9-]+$/);
    if (!r['Postal code'] || !r['Address line 1']) assert.match(r.Labels, /needs address/);
  }
  assert.doesNotMatch(read('scripts/build-gbp-sheet.js'), /\ufeff/, 'the byte order mark is written as an escape');
});

test('search titles: the laws, units and library pages say what people search for', () => {
  assert.match(read('laws.html'), /<title>Animal law in India: cruelty, dog bites, FIRs \| People for Animals<\/title>/);
  assert.match(read('laws.html'), /How to file a cruelty complaint\./);
  assert.match(read('units.html'), /<title>Animal rescue near you: PFA units across India/);
  assert.match(read('library.html'), /<title>Animal welfare laws and handbooks: PFA Library/);
  assert.match(read('search.html'), /<meta name="robots" content="noindex, follow">/, 'search results are not pages to index');
});
