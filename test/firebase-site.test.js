'use strict';
/* The public website on Firebase Hosting (owner, 24 Nov 2026: "can you prep
   the whole site to work on firebase pls", "cant risk a disruption in the
   service"). Its own Hosting site beside the panel's, the same pages and
   rules as on Vercel, nothing server-side published, donors never sent to a
   Firebase address, and a check that says READY before the domain moves. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cfg = JSON.parse(read('firebase.json'));
const vercel = JSON.parse(read('vercel.json'));
const site = [].concat(cfg.hosting).find((h) => h.target === 'site');
const panel = [].concat(cfg.hosting).find((h) => h.target === 'panel');

test('two Hosting sites: the panel as it was, and the website from site/', () => {
  assert.ok(panel && site, 'both targets are configured');
  assert.equal(panel.public, 'public');
  assert.equal(site.public, 'site');
  const rc = JSON.parse(read('.firebaserc'));
  assert.deepEqual(rc.targets['pfa-new-website'].hosting.panel, ['pfa-new-website'], 'the panel keeps its own address');
  assert.ok(!rc.targets['pfa-new-website'].hosting.site || rc.targets['pfa-new-website'].hosting.site[0] !== 'pfa-new-website',
    'the website is never served from the panel\'s address');
});

test('the website on Firebase follows vercel.json: clean addresses, redirects, rewrites, headers', () => {
  assert.equal(site.cleanUrls, true);
  assert.deepEqual(site.rewrites[0], { source: '/api/**', function: { functionId: 'api', region: 'asia-south1' } });
  for (const r of vercel.redirects) {
    assert.ok(site.redirects.some((x) => x.source === r.source && x.destination === r.destination && x.type === (r.permanent ? 301 : 302)), r.source);
  }
  for (const r of vercel.rewrites.filter((x) => !x.source.startsWith('/api'))) {
    assert.ok(site.rewrites.some((x) => x.source === r.source && x.destination === r.destination), r.source);
  }
  const all = (h) => Object.fromEntries(h.headers.map((x) => [x.key, x.value]));
  assert.deepEqual(all(site.headers.find((h) => h.source === '**')), all(vercel.headers.find((h) => h.source === '/(.*)')), 'the same security headers');
  const admin = site.headers.find((h) => h.regex && /admin/.test(h.regex));
  assert.ok(admin && new RegExp(admin.regex).test('/admin') && new RegExp(admin.regex).test('/admin.html'));
  assert.equal(all(admin)['Cache-Control'], 'no-store');
});

test('site/ is the website and nothing server-side: built from dist/, guarded', () => {
  const B = require('../scripts/build-firebase.js');
  for (const bad of ['assets/vendor/india-districts/india-districts.json', 'donate.html.orig', 'product.html']) {
    assert.ok(B.SITE_NEVER.some((re) => re.test(bad)), `${bad} is kept off the website`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-site-'));
  for (const f of ['index.html', 'lib/ccavenue.js', '.env', 'functions/.env', 'firebase.json', 'notes.md', 'pfa-new-website-firebase-adminsdk-x.json']) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), 'x');
  }
  const leaked = B.leaksIn(tmp).sort();
  assert.deepEqual(leaked, ['.env', 'firebase.json', 'functions/.env', 'lib/ccavenue.js', 'notes.md', 'pfa-new-website-firebase-adminsdk-x.json'].sort());
  fs.rmSync(tmp, { recursive: true, force: true });
  /* the minified copy never takes in the folders built from it */
  assert.match(read('scripts/minify.js'), /const SKIP_DIRS = new Set\(\['dist', 'public', 'site',/);
});

test('built folders never travel: not in the zip, not in the tree copy, not in git', () => {
  assert.match(read('scripts/make-zip.sh'), /--exclude='\.\/site' --exclude='\.\/dist'/);
  assert.match(read('scripts/ship.sh'), /BUILT_EXCLUDES=\(--exclude '\/public' --exclude '\/site' --exclude '\/dist'/);
  assert.match(read('.gitignore'), /^site\/$/m);
});

test('every deploy makes sure of the site, caps both, deploys it, and checks it', () => {
  const ship = read('scripts/ship.sh');
  const make = ship.indexOf('node scripts/firebase-site.js "$PROJECT"');
  const cap = ship.indexOf('node scripts/hosting-retention.js');
  const deploy = ship.indexOf('--only functions,hosting${PANEL_ONLY}');
  assert.ok(make !== -1 && cap !== -1 && deploy !== -1);
  assert.ok(make < cap && cap < deploy, 'made, then capped, then deployed');
  /* Vercel gone (26 Nov 2026): no move check against it; the deploy only
     says whether the domain answers from Firebase, and never stops on it */
  const dc = read('DEPLOY.command');
  assert.doesNotMatch(dc, /firebase-move-check/);
  assert.match(dc, /step "Checking the domain is served by Firebase"/);
  assert.match(dc, /SERVED BY FIREBASE/);
  const retention = read('scripts/hosting-retention.js');
  assert.match(retention, /allSites\(\)/, 'both sites keep only the capped number of versions');
});

test('donors come back to peopleforanimalsindia.org, never to a Firebase address', () => {
  const { getBaseUrl } = require('../lib/ccavenue');
  const keep = {};
  for (const k of ['PFA_PUBLIC_SITE_URL', 'PUBLIC_SITE_URL', 'SITE_URL', 'NODE_ENV']) { keep[k] = process.env[k]; delete process.env[k]; }
  try {
    process.env.PUBLIC_SITE_URL = 'https://pfa-new-website.web.app';
    assert.equal(getBaseUrl({ headers: { host: 'pfa-new-website.web.app' } }), 'https://peopleforanimalsindia.org');
    assert.equal(getBaseUrl({ headers: { 'x-forwarded-host': 'peopleforanimalsindia.org' } }), 'https://peopleforanimalsindia.org');
    delete process.env.PUBLIC_SITE_URL;
    assert.equal(getBaseUrl({ headers: { 'x-forwarded-host': 'peopleforanimalsindia.web.app' } }), 'https://peopleforanimalsindia.org');
    assert.equal(getBaseUrl({ headers: { host: 'pfa-new-website.firebaseapp.com' } }), 'https://peopleforanimalsindia.org');
    assert.equal(getBaseUrl({ headers: { 'x-forwarded-host': 'pfa-full-website.vercel.app' } }), 'https://pfa-full-website.vercel.app', 'a non-Firebase host is still honoured');
    process.env.PFA_PUBLIC_SITE_URL = 'https://www.peopleforanimalsindia.org';
    assert.equal(getBaseUrl({ headers: {} }), 'https://www.peopleforanimalsindia.org');
  } finally {
    for (const k of Object.keys(keep)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
  }
});

test('the health check names the settings it has, never their values', async () => {
  const handler = require('../lib/routes/payment/health.js');
  const before = process.env.CCAVENUE_USD_WORKING_KEY;
  process.env.CCAVENUE_USD_WORKING_KEY = 'a-very-secret-value-123';
  try {
    const out = await new Promise((resolve) => {
      const res = { statusCode: 0, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: String(b) }); } };
      handler({ method: 'GET', headers: {}, socket: {} }, res);
    });
    const j = JSON.parse(out.body);
    assert.ok(j.settings.includes('CCAVENUE_USD_WORKING_KEY'));
    /* the keys themselves are compared by a short fingerprint, never shown */
    assert.match(j.keyPrints.usdWorkingKey, /^[0-9a-f]{4}$/);
    assert.equal(j.keyPrints.workingKey === 'none' || /^[0-9a-f]{4}$/.test(j.keyPrints.workingKey), true);
    assert.ok(!out.body.includes('a-very-secret-value-123'), 'a value is never in the answer');
    assert.ok(['vercel', 'firebase', 'local'].includes(j.host));
    for (const name of handler.SETTINGS) assert.match(name, /^[A-Z0-9_]+$/);
  } finally {
    if (before === undefined) delete process.env.CCAVENUE_USD_WORKING_KEY; else process.env.CCAVENUE_USD_WORKING_KEY = before;
  }
  /* every key the public website needs is mounted on Firebase when set */
  const { KNOWN } = require('../scripts/firebase-secrets.js');
  for (const name of ['CCAVENUE_USD_WORKING_KEY', 'PFA_SHOP_FIREBASE_SERVICE_ACCOUNT', 'PHOTO_CUTOUT_KEY', 'CCAVENUE_WORKING_KEY', 'PFA_AUTH_PEPPER']) assert.ok(KNOWN.includes(name), name);
});

test('the readiness check covers pages, the server, redirects and settings', () => {
  const M = require('../scripts/firebase-move-check.js');
  for (const p of ['/', '/donate', '/report', '/shop', '/.well-known/security.txt']) assert.ok(M.PAGES.includes(p), p);
  for (const p of ['/api/payment/health', '/api/live-chat', '/api/chat-taught']) assert.ok(M.API.some(([x]) => x === p), p);
  for (const [from] of M.REDIRECTS) assert.ok(vercel.redirects.some((r) => r.source === from), from);
  assert.ok(M.SECRET.test('CCAVENUE_WORKING_KEY') && M.SECRET.test('PFA_SMTP_PASS') && !M.SECRET.test('PFA_REGISTER_SHEET_ID'));
  assert.equal(M.buildOf('<meta name="pfa-build" content="v1.632">'), 'v1.632');
});

test('an address not on the site gets the site\'s own page, with links that work from any depth', () => {
  const html = read('404.html');
  assert.match(html, /<head>\n<base href="\/">/);
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /<h1[^>]*>This page is not here\.<\/h1>/);
  assert.ok(!/data-search-page/.test(html), 'not driven by the search page script');
});

test('a deploy can be handed a setting on its command line; only known names, never printed', () => {
  const ship = read('scripts/ship.sh');
  const set = ship.indexOf('node scripts/firebase-set-secrets.js || true');
  assert.ok(set !== -1 && set < ship.indexOf('--only functions,hosting${PANEL_ONLY}'), 'stored before the function deploys, and never stops a release');
  const src = read('scripts/firebase-set-secrets.js');
  assert.ok(!/\$\{value\}|\{env\[k\]\}/.test(src), 'a value is never printed');
  const lines = [];
  const orig = console.log; console.log = (s) => lines.push(String(s));
  try { require('../scripts/firebase-set-secrets.js').main({ PFA_SET_NOT_A_SETTING: 'x', PFA_SET_CCAVENUE_MERCHANT_ID: '' }); } finally { console.log = orig; }
  assert.ok(lines.some((l) => /not a setting the site reads/.test(l)));
  assert.ok(lines.some((l) => /CCAVENUE_MERCHANT_ID: empty/.test(l)));
  assert.match(read('functions/index.js'), /CCAVENUE_MODE: 'production'/, 'live payments on Firebase, as on Vercel');
});
