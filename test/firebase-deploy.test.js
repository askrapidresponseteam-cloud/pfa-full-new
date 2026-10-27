'use strict';

/* The Firebase deployment, checked the way it will actually be built.

   The risk that matters is not a broken route. It is publishing server code:
   Hosting can be pointed at "." with an ignore list, and one missing entry
   there puts lib/ccavenue.js and the working keys it reads on the open web.
   scripts/build-firebase.js therefore copies an allowlist and refuses to
   finish if anything server-side lands in public/. These tests hold it to that. */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

test('hosting is never pointed at the repository root', () => {
  assert.equal(cfg.hosting.public, 'public',
    'public must be the assembled directory, never "." \u2014 that publishes lib/ and api/');
});

test('every API route resolves from the path alone', () => {
  /* Vercel rewrote /api/<x> to ?__route=<x>. Firebase Hosting cannot add a
     query parameter, so the router's pathname fallback carries all of it. */
  const { _private } = require('../api/index.js');
  const cases = {
    '/api/pfa-submissions': 'pfa-submissions',
    '/api/admin/records?kind=PFA-CR': 'admin/records',
    '/api/payment/response': 'payment/response',
    '/api/webhooks/order-created': 'webhooks/order-created',
    '/api/caregiver/card?id=X': 'caregiver/card'
  };
  for (const [url, want] of Object.entries(cases)) {
    assert.equal(_private.routeKey({ url, query: {} }), want, `${url} did not resolve`);
  }
});

test('every route the router knows is reachable through the /api rewrite', () => {
  const { _private } = require('../api/index.js');
  const rewrite = cfg.hosting.rewrites.find((r) => r.source === '/api/**');
  assert.ok(rewrite && rewrite.function, 'no /api/** rewrite to the function');
  for (const key of Object.keys(_private.ROUTES)) {
    assert.equal(_private.routeKey({ url: `/api/${key}`, query: {} }), key, `${key} is unreachable`);
  }
});

test('nothing from vercel.json was dropped in the port', () => {
  for (const r of vercel.redirects) {
    assert.ok(cfg.hosting.redirects.some((x) => x.source === r.source && x.destination === r.destination),
      `redirect ${r.source} was not ported`);
  }
  assert.equal(cfg.hosting.headers.length, vercel.headers.length,
    'a caching header rule was lost in the port');
});

test('the worker Vercel runs daily still runs on Firebase, and more often', () => {
  const wrapper = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  const cron = vercel.crons[0];
  assert.equal(cron.path, '/api/caregiver/email-worker');
  assert.match(wrapper, /onSchedule/, 'the cron is gone');
  /* daily on Vercel; every ten minutes on Firebase since 27 Oct 2026 */
  assert.match(wrapper, /exports\.caregiverEmailWorker = onSchedule\(\s*\{ region: REGION, schedule: 'every 10 minutes'/);
});

test('vercel.json is left intact so the site can still deploy there', () => {
  assert.ok(vercel.rewrites.length && vercel.headers.length,
    'the Vercel config was damaged; moving back would not work');
});

test('the build refuses to publish anything server-side', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'build-firebase.js'), 'utf8');
  assert.match(script, /REFUSING TO BUILD/, 'the leak guard is gone');
  assert.match(script, /process\.exit\(1\)/, 'the guard warns but does not stop the build');
  for (const dir of ['lib', 'api', 'test', 'scripts']) {
    assert.ok(script.includes(dir), `${dir} is no longer named in the leak guard`);
  }
});

test('if public/ has been built, it holds no server file', () => {
  const pub = path.join(ROOT, 'public');
  if (!fs.existsSync(pub)) return;                  // not built in this checkout
  const bad = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (/^(lib|api|test|scripts|functions)\//.test(r) || /\.(md)$/.test(r)
               || /firestore\./.test(r) || r === 'package.json') bad.push(r);
    }
  };
  walk(pub);
  assert.deepEqual(bad, [], 'server or private files are in public/');
});

test('everything api/ and lib/ load is shipped inside the function bundle', () => {
  /* On Vercel the whole tree ships, so a require of ../assets/x.js just works.
     The Firebase bundle holds only api/, lib/ and FN_FILES. Before 7 Oct 2026
     assets/field-rules.js was missing from it, every API route crashed on load
     and the admin panel said it "could not reach its own API". */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-firebase.js'), 'utf8');
  const listed = JSON.parse(src.match(/const FN_FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const missing = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
      const code = fs.readFileSync(full, 'utf8');
      let m;
      while ((m = re.exec(code))) {
        const rel = path.relative(ROOT, path.resolve(path.dirname(full), m[1])).split(path.sep).join('/');
        if (/^(api|lib)\//.test(rel)) continue;
        const file = rel.endsWith('.js') || rel.endsWith('.json') || rel.endsWith('.html') ? rel : rel + '.js';
        if (!listed.includes(file)) missing.push(`${path.relative(ROOT, full)} loads ${file}`);
      }
    }
  };
  walk(path.join(ROOT, 'api'));
  walk(path.join(ROOT, 'lib'));
  assert.deepEqual(missing, [], 'add these to FN_FILES in scripts/build-firebase.js');
});

test('the function names no secret unconditionally', () => {
  /* Naming a secret that was never created fails the whole functions deploy,
     which left the panel stuck on a broken API. scripts/firebase-secrets.js
     names only the ones that exist. */
  const wrapper = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  const line = wrapper.split('\n').find((l) => /^const SECRETS\s*=/.test(l));
  assert.ok(line, 'SECRETS is no longer defined on one line');
  assert.doesNotMatch(line, /'[A-Z_]{4,}'/, 'a secret is hard-coded into SECRETS again');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['deploy:firebase'], /firebase-secrets\.js/, 'deploy no longer checks which secrets exist');
});

test('the function knows the mailbox and its own address without a functions/.env', () => {
  /* 8 Oct 2026: a deploy from a fresh unzip had no functions/.env, lost
     PFA_SMTP_USER, and no submission reached gandhim. The non-secret
     settings are in the code now, applied before the API loads. */
  const wrapper = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  assert.match(wrapper, /PFA_SMTP_USER: 'info@peopleforanimalsindia\.org'/);
  const site = /PUBLIC_SITE_URL: '([^']+)'/.exec(wrapper);
  assert.ok(site, 'PUBLIC_SITE_URL has a default');
  assert.doesNotMatch(site[1], /peopleforanimalsindia\.org/, 'that domain served the old site; links in emails would land there');
  assert.ok(wrapper.indexOf('DEFAULTS') < wrapper.indexOf("require('./api/index.js')"), 'the defaults are set before the API reads them');
  assert.match(wrapper, /if \(!String\(process\.env\[key\] \|\| ''\)\.trim\(\)\)/, 'functions/.env still overrides');
});

test('a secret created with no value is not named, so it cannot fail the deploy', () => {
  /* 21 Oct 2026: CCAVENUE_MERCHANT_ID existed with no version, was named,
     and the deploy stopped twice on "not found or has no versions". */
  const { stateOf } = require('../scripts/firebase-secrets.js');
  const table = (rows) => ['┌─────────┬─────────┐', '│ Version │ State   │', '├─────────┼─────────┤', ...rows, '└─────────┴─────────┘'].join('\n');
  assert.equal(stateOf({ status: 0, stdout: table(['│ 1       │ ENABLED │']) }), true, 'a value to mount');
  assert.equal(stateOf({ status: 0, stdout: table([]) }), false, 'created, never given a value');
  assert.equal(stateOf({ status: 0, stdout: table(['│ 1       │ DESTROYED │', '│ 2       │ DISABLED │']) }), false, 'no version that can be mounted');
  assert.equal(stateOf({ status: 1, stderr: 'Error: Secret projects/x/secrets/A not found or has no versions.' }), false);
  assert.equal(stateOf({ status: 1, stderr: 'HTTP Error: 404, Secret not found' }), false);
  assert.equal(stateOf({ status: 1, stderr: 'Failed to authenticate, have you run firebase login?' }), null, 'unknown: leave functions/.env alone');
  assert.equal(stateOf({ status: 0, stdout: 'something new the CLI prints' }), true, 'an unknown shape still counts, so email is never switched off by a wording change');
});
