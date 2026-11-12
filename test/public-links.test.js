'use strict';
/* Every link the public gets is on the public site, never the admin panel's
   Firebase address (lib/public-site.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/public-site');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('a Firebase address is never the public site, whichever setting names it', () => {
  const saved = { a: process.env.PFA_PUBLIC_SITE_URL, b: process.env.PUBLIC_SITE_URL };
  try {
    process.env.PFA_PUBLIC_SITE_URL = 'https://pfa-new-website.firebaseapp.com';
    process.env.PUBLIC_SITE_URL = 'https://pfa-new-website.web.app';
    assert.equal(P.publicSite(), 'https://peopleforanimalsindia.org');
    process.env.PUBLIC_SITE_URL = 'https://preview.example.vercel.app/x';
    assert.equal(P.publicSite(), 'https://preview.example.vercel.app');
    process.env.PFA_PUBLIC_SITE_URL = 'https://www.peopleforanimalsindia.org/';
    assert.equal(P.publicSite(), 'https://www.peopleforanimalsindia.org');
  } finally {
    for (const [k, v] of [['PFA_PUBLIC_SITE_URL', saved.a], ['PUBLIC_SITE_URL', saved.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the reports, a caregiver\'s card link and a submission\'s links use the public site', () => {
  assert.equal((read('lib/routes/caregiver/email-worker.js').match(/siteUrl: require\('\.\.\/\.\.\/public-site'\)\.publicSite\(\)/g) || []).length, 2, 'both monthly reports');
  assert.match(read('lib/routes/caregiver/admin-shipment.js'), /const cardUrl = `\$\{require\('\.\.\/\.\.\/public-site'\)\.publicSite\(\)\}\/caregiver-card\.html/);
  assert.match(read('lib/routes/pfa-submissions.js'), /return require\('\.\.\/public-site'\)\.publicSite\(\);/);
});
