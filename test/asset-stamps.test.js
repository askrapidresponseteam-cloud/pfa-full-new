'use strict';

/* Every stylesheet and script a page loads goes live stamped with the file
   as it ships (owner, 27 Nov 2026: "buttons cannot be black like this,
   anywhere. fix": a new page met the old the-wall.css a browser still held,
   and "Share your video" was ink on ink). scripts/stamp-assets.js, run by
   scripts/build-firebase.js on site/. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const S = require('../scripts/stamp-assets.js');

test('a page\'s own styles and scripts are stamped with the file as it is, and change when it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'units'));
  fs.writeFileSync(path.join(dir, 'assets', 'the-wall.css'), '.tw a.btn{color:#fff}');
  fs.writeFileSync(path.join(dir, 'assets', 'the-wall.js'), 'x');
  fs.writeFileSync(path.join(dir, 'pfa-search.css'), 'y');
  const page = '<link rel="stylesheet" href="assets/the-wall.css"><link rel="stylesheet" href="pfa-search.css"><script src="assets/the-wall.js?v=0000000000" defer></script><a href="assets/missing.css">x</a><img src="https://example.org/assets/a.js">';
  fs.writeFileSync(path.join(dir, 'the-wall.html'), page);
  fs.writeFileSync(path.join(dir, 'units', 'agra.html'), '<link rel="stylesheet" href="/assets/the-wall.css"><script src="../assets/the-wall.js"></script>');
  S.stampTree(dir);
  const out = fs.readFileSync(path.join(dir, 'the-wall.html'), 'utf8');
  const css = S.fingerprint(path.join(dir, 'assets', 'the-wall.css'));
  assert.ok(out.includes(`href="assets/the-wall.css?v=${css}"`));
  assert.match(out, /href="pfa-search\.css\?v=[a-f0-9]{10}"/);
  assert.match(out, /src="assets\/the-wall\.js\?v=[a-f0-9]{10}" defer/);
  assert.doesNotMatch(out, /0000000000/, 'an old stamp is replaced');
  assert.ok(out.includes('href="assets/missing.css"'), 'a file that is not there is left alone');
  assert.ok(out.includes('https://example.org/assets/a.js"'), 'another site is left alone');
  const unit = fs.readFileSync(path.join(dir, 'units', 'agra.html'), 'utf8');
  assert.ok(unit.includes(`href="/assets/the-wall.css?v=${css}"`), 'from the root');
  assert.match(unit, /src="\.\.\/assets\/the-wall\.js\?v=[a-f0-9]{10}"/, 'from a folder');
  fs.writeFileSync(path.join(dir, 'assets', 'the-wall.css'), '.tw a.btn{color:#fff;background:#111}');
  S.stampTree(dir);
  assert.ok(!fs.readFileSync(path.join(dir, 'the-wall.html'), 'utf8').includes(css), 'a changed file gets a new stamp');
});

test('the build stamps the copy that goes live', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-firebase.js'), 'utf8');
  assert.match(build, /const files = copySite\(DIST, SITE\);\s*\/\*[\s\S]*?\*\/\s*require\('\.\/stamp-assets\.js'\)\.stampTree\(SITE\);/);
  const site = path.join(ROOT, 'site');
  if (!fs.existsSync(path.join(site, 'the-wall.html'))) return;
  /* where the live copy has been built, nothing in it is left unstamped */
  const loose = [];
  for (const f of fs.readdirSync(site).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(site, f), 'utf8');
    for (const m of html.matchAll(/\b(?:href|src)="\/?((?:assets\/[\w./-]+|pfa-search|search-index)\.(?:css|js))(\?v=[a-f0-9]{10})?"/g)) {
      if (!m[2] && fs.existsSync(path.join(site, m[1]))) loose.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(loose, []);
});
