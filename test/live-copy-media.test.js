'use strict';
/* Owner, 27 Nov 2026, of the internship's hero and the Sanjay Gandhi Animal
   Care Centre's photograph missing on the live site: "how can u fucking miss
   images.. there cant be empty spots anywhere where there was an image
   previously". scripts/minify.js, which makes the copy the live site serves,
   left out every folder named "site" anywhere in the tree, so media/site/
   (the internship, SGACC, campus and Gau Seva pictures) never went live.
   Build folders are now left out only at the top of the project, and every
   picture a page names is checked against the copy that goes live. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('build folders are skipped only at the top: media/site/ goes live', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/minify.js'), 'utf8');
  assert.doesNotMatch(src, /SKIP_DIRS\.has\(path\.basename\(rel\)\)/, 'a folder named like a build folder anywhere in the tree was dropped');
  assert.match(src, /const top = !rel\.includes\(path\.sep\);/);
});

test('every picture, film poster and document a page names is in the copy that goes live', { skip: !fs.existsSync(path.join(ROOT, 'site', 'index.html')) && 'no built copy here' }, () => {
  const SITE = path.join(ROOT, 'site');
  /* fetched on the deploy machine, never in the zip (scripts/ship.sh KEEP_EXCLUDES) */
  const FETCHED = /^media\/cinekind-2026\/reels\/.*\.mp4$|^media\/cinekind-(elephant|langur|lion)\.mp4$|^resources\//;
  const missing = new Set();
  for (const f of fs.readdirSync(SITE).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(SITE, f), 'utf8');
    const refs = [...html.matchAll(/(?:src|poster|data-src|data-full|data-image|data-still|data-gr-pic)=["']((?:media|img)\/[^"'?#\s|]+)/g)].map((m) => m[1]);
    for (const set of html.matchAll(/srcset="([^"]+)"/g)) refs.push(...set[1].split(',').map((x) => x.trim().split(' ')[0]));
    for (const r of refs) if (r && !FETCHED.test(r) && !fs.existsSync(path.join(SITE, r))) missing.add(`${f}: ${r}`);
  }
  assert.deepEqual([...missing], []);
});
