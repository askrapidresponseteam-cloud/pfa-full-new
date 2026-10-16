'use strict';

/* Firebase Hosting storage, held below the ceiling by arithmetic rather than
   by anyone remembering.

   On 13 Oct 2026 this project stood at 9.73 GB of the 10 GB Firebase gives
   free, having downloaded 8.21 MB all month. Nothing was wrong with the site.
   ship.sh had, since 8 Oct, run `firebase deploy --only functions,hosting` on
   every release so the admin panel stopped going stale, and `hosting` means
   the whole of public/, which build-firebase.js filled with all 31 pages,
   media/ and a second copy of the library's PDFs: about 480 MB. Hosting keeps
   every version for ever and does not dedupe between them, so twenty ships
   stored twenty complete copies of a website Firebase does not serve.

   Two guards replaced that, and these tests hold both:

     the bundle is the panel, not the site
     the bundle times the retained version count stays under half the free tier

   The second is the one that matters, because it fails on the way in. A change
   that puts the site back into the bundle does not reach Firebase at all: the
   build refuses, and says why. */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const limits = require('../scripts/hosting-limits.js');
const build = require('../scripts/build-firebase.js');

const bytesOf = (rel) => {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.statSync(full).size : 0;
};
const bundleBytes = () => build.PANEL_PAGES.concat(build.PANEL_ASSETS).reduce((n, rel) => n + bytesOf(rel), 0);

/* ---- the numbers themselves ------------------------------------------- */

test('the retained version count is one Firebase will accept', () => {
  assert.ok(Number.isInteger(limits.RETAINED_RELEASES), 'must be a whole number');
  assert.ok(limits.RETAINED_RELEASES >= 1 && limits.RETAINED_RELEASES <= 100,
    'the Hosting API accepts 1 to 100 for retainedReleaseCount');
});

test('the safe line leaves real headroom under the free tier', () => {
  assert.ok(limits.SAFE_BYTES < limits.CEILING_BYTES,
    'the budget must sit below the ceiling, not on it');
  assert.ok(limits.SAFE_BYTES <= limits.CEILING_BYTES * 0.6,
    'Hosting storage is an estimate updated once a day, so the number being watched is always behind reality');
});

test('the worst case counts the release being deployed too', () => {
  assert.equal(limits.WORST_CASE_MULTIPLIER, limits.RETAINED_RELEASES + 1,
    'the version going out now is not yet one of the retained ones');
});

test('a bundle at the budget is allowed and one over it is not', () => {
  assert.ok(limits.withinBudget(limits.MAX_BUNDLE_BYTES), 'the stated maximum must itself fit');
  assert.ok(!limits.withinBudget(limits.MAX_BUNDLE_BYTES + 1024 * 1024),
    'a megabyte over the stated maximum must not fit');
});

/* ---- the regression this was written for ------------------------------ */

test('the 480 MB full-site bundle of 8 Oct would be refused', () => {
  const asItWas = 480 * 1024 * 1024;
  assert.ok(!limits.withinBudget(asItWas),
    'the bundle that filled Hosting storage must not pass the budget again');
  assert.ok(limits.worstCaseBytes(asItWas) > limits.SAFE_BYTES);
});

test('the panel bundle is nowhere near the budget', () => {
  const bytes = bundleBytes();
  assert.ok(bytes > 0, 'the panel bundle resolved to nothing, so this test proves nothing');
  assert.ok(limits.withinBudget(bytes),
    `the panel bundle is ${limits.mb(bytes)}, worst case ${limits.gb(limits.worstCaseBytes(bytes))}`);
  assert.ok(bytes < 50 * 1024 * 1024,
    `the panel bundle has grown to ${limits.mb(bytes)}; it should be a page and the files that page loads`);
});

/* ---- the bundle is the panel, not the site ---------------------------- */

test('only the admin panel is published, no other page', () => {
  assert.deepEqual(build.PANEL_PAGES, ['admin.html'],
    'the website is on GitHub and served by Vercel; Hosting serves the panel');
});

test('nothing heavy is in the panel allowlist', () => {
  for (const rel of build.PANEL_ASSETS) {
    assert.ok(!rel.startsWith('resources/'),
      `${rel}: the library's PDFs are what filled Hosting storage, they do not belong in the bundle`);
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    assert.ok(fs.statSync(full).isFile(),
      `${rel}: name files, never directories - a directory is how media/ and resources/ got in`);
  }
});

test('the full-site build is still available, and still carries the site', () => {
  /* Kept deliberately: comparing the two deployments, or moving off Vercel,
     needs it. The budget is what stops it reaching Firebase by accident. */
  assert.ok(build.PUBLIC_DIRS.includes('resources'), '--full must still build the whole site');
  assert.ok(build.PUBLIC_DIRS.includes('media'));
});

/* ---- the panel will actually work once published ---------------------- */

test('every file the panel loads is in the bundle', () => {
  const { missing } = build.checkPanel();
  assert.deepEqual(missing, [],
    'admin.html or one of its scripts loads a file the bundle does not carry');
});

test('a reference to a file that is not in the tree is not treated as missing', () => {
  /* The card's two brand fonts are optional faces, synthesised when absent.
     They are in no deployment, so they cannot have been left out of this one. */
  const { optional, missing } = build.checkPanel();
  for (const entry of optional) {
    const ref = entry.split(' -> ')[1];
    assert.ok(!fs.existsSync(path.join(ROOT, ref)), `${ref} is in the tree, so it is missing, not optional`);
  }
  assert.ok(Array.isArray(missing));
});

test('the panel asset scanner only follows same-origin paths', () => {
  const found = build.panelReferences([
    '<script src="assets/qr.js"></script>',
    '<script src="https://cdn.example.com/assets/evil.js"></script>',
    '<script src="//cdn.example.com/assets/evil.js"></script>',
    '<img src="data:image/png;base64,AAAA">',
    '<a href="#top">top</a>',
    '<link href="/fonts/marcellus-latin.woff2">',
    'style="background:url(../img/logo.png)"',
    "var f = 'assets/fonts/Archia-Regular.woff2';"
  ].join('\n'));
  assert.ok(found.has('assets/qr.js'), 'a plain relative src was missed');
  assert.ok(found.has('fonts/marcellus-latin.woff2'), 'a root-relative href was missed');
  assert.ok(found.has('assets/fonts/Archia-Regular.woff2'), 'a quoted path inside a script was missed');
  for (const ref of found) {
    assert.ok(!ref.includes('cdn.example.com'), `${ref}: somebody else's server is not this bundle's problem`);
    assert.ok(!ref.startsWith('data:'), 'a data URI carries its own bytes');
  }
});

/* ---- the cap is actually applied on every release --------------------- */

test('ship.sh sets the retained version count before it deploys', () => {
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8');
  const cap = ship.indexOf('scripts/hosting-retention.js');
  const deploy = ship.indexOf('--only functions,hosting');
  assert.ok(cap !== -1, 'ship.sh no longer caps how many versions Firebase keeps');
  assert.ok(deploy !== -1, 'ship.sh no longer deploys hosting');
  assert.ok(cap < deploy, 'the cap must be set before the deploy, not after it');
});

test('capping the versions can never stop a release', () => {
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8');
  const line = ship.split('\n').find((l) => l.includes('scripts/hosting-retention.js'));
  assert.ok(/\|\|\s*true/.test(line),
    'ship.sh runs under `set -e`; without a guard a Firebase hiccup here would abandon the release');
});

test('the deploy script run by hand caps the versions too', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['deploy:firebase'].includes('hosting-retention'),
    'deploying by hand must not quietly skip the cap');
});

test('the retention script names the live channel and the right field', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'hosting-retention.js'), 'utf8');
  assert.ok(src.includes('retainedReleaseCount'), 'that is the field the Hosting API takes');
  assert.ok(src.includes('channels/live'), 'the live channel is the one that accumulates releases');
  assert.ok(src.includes('updateMask=retainedReleaseCount'),
    'a PATCH without an updateMask does not change the field');
});
