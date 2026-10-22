'use strict';

/* PFA's old site is where the unit photographs and the microsites' photographs
   were first taken from. It was peopleforanimalsindia.org, and that address
   has been this site since Oct 2026, so every fetch from it failed and a tree
   without those files could not be completed at deploy. The old site lives on,
   unchanged, at pf-acurrent.vercel.app (owner, 22 Oct 2026: "units you can
   stream from https://pf-acurrent.vercel.app/units.html;
   https://github.com/askrapidresponseteam-cloud/PFAcurrent"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const OLD_SITE = 'https://pf-acurrent.vercel.app';

test('the photographs are fetched from where the old site lives now', () => {
  const site = JSON.parse(read('data/site-photos.json'));
  for (const entry of [...site.photos, ...site.documents]) {
    assert.ok(entry.from.startsWith(OLD_SITE + '/'), `${entry.file} comes from ${entry.from}`);
  }
  const units = JSON.parse(read('media/units/manifest.json'));
  assert.equal(units.length, 80);
  for (const u of units) {
    assert.ok(u.page.startsWith(OLD_SITE + '/units/details/'), `${u.city}: ${u.page}`);
    if (u.source) assert.ok(u.source.startsWith(OLD_SITE + '/uploads/unit/'), `${u.city}: ${u.source}`);
  }
  assert.match(read('scripts/fetch-unit-photos.js'), /process\.env\.PFA_OLD_SITE \|\| 'https:\/\/pf-acurrent\.vercel\.app'/);
});

test('nothing on the site still points at the old site\'s files on this site\'s own address', () => {
  const dead = /https?:\/\/(?:www\.)?peopleforanimalsindia\.org\/(?:front|uploads|public)\//;
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .concat(['data/site-photos.json', 'media/units/manifest.json', 'pfa-search.js']);
  for (const f of files) assert.doesNotMatch(read(f), dead, `${f} names a file that address no longer serves`);
  /* the founder page falls back to the old site when its own copy is missing */
  const founder = read('founder.html');
  assert.ok((founder.match(/data-alt-src="https:\/\/pf-acurrent\.vercel\.app\/front\/img\//g) || []).length >= 5);
  assert.match(read('vercel.json'), /img-src 'self' data: blob: https:\/\/pf-acurrent\.vercel\.app /, 'and the browser is allowed to show them');
});

test('a local copy of the old site can stand in for it', () => {
  const { sourceOf } = require('../scripts/fetch-site-photos.js');
  const saved = process.env.PFA_OLD_SITE;
  try {
    delete process.env.PFA_OLD_SITE;
    assert.equal(sourceOf(OLD_SITE + '/front/img/center1.jpg'), OLD_SITE + '/front/img/center1.jpg');
    process.env.PFA_OLD_SITE = 'http://127.0.0.1:8200/';
    assert.equal(sourceOf(OLD_SITE + '/front/img/center1.jpg'), 'http://127.0.0.1:8200/front/img/center1.jpg');
  } finally {
    if (saved === undefined) delete process.env.PFA_OLD_SITE; else process.env.PFA_OLD_SITE = saved;
  }
});
