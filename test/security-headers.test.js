'use strict';

/* The deploy configs carry the browser-hardening headers on every page, and
   the build never publishes repository internals or member data. Added
   30 Aug 2026 after a review found dist/ carrying .github/, .firebaserc and
   functions/, and a member register (names, phone numbers) at the root. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const REQUIRED = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security'];

function headerMap(list) {
  const out = {};
  for (const h of list) out[h.key] = h.value;
  return out;
}

test('vercel.json sends the hardening headers on every path', () => {
  const v = JSON.parse(read('vercel.json'));
  const all = v.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, 'a /(.*) header rule exists');
  const map = headerMap(all.headers);
  for (const key of REQUIRED) assert.ok(map[key], `${key} is set`);
  assert.equal(map['X-Content-Type-Options'], 'nosniff');
  assert.match(map['Strict-Transport-Security'], /max-age=\d{7,}/);
  assert.match(map['X-Frame-Options'], /^(SAMEORIGIN|DENY)$/);
});

test('firebase.json sends the same headers', () => {
  const f = JSON.parse(read('firebase.json'));
  /* both Firebase sites: the panel and the public website (24 Nov 2026) */
  for (const h of [].concat(f.hosting)) {
    const all = h.headers.find((x) => x.source === '**');
    assert.ok(all, `a ** header rule exists on ${h.target}`);
    const map = headerMap(all.headers);
    for (const key of REQUIRED) assert.ok(map[key], `${key} is set on ${h.target}`);
  }
});

test('the admin page is never framed, indexed or cached by either host', () => {
  const v = JSON.parse(read('vercel.json'));
  const f = JSON.parse(read('firebase.json'));
  const rules = [v.headers.find((h) => /admin/.test(h.source))].concat([].concat(f.hosting).map((h) => h.headers.find((x) => /admin/.test(x.source || x.regex || ''))));
  /* the public website on Firebase has clean addresses, so its rule covers /admin as well as /admin.html */
  const siteRule = [].concat(f.hosting).find((h) => h.target === 'site').headers.find((x) => /admin/.test(x.source || x.regex || ''));
  assert.ok(new RegExp(siteRule.regex).test('/admin') && new RegExp(siteRule.regex).test('/admin.html'), 'the site covers both addresses of the panel page');
  for (const rule of rules) {
    assert.ok(rule, 'an admin header rule exists');
    const map = headerMap(rule.headers);
    assert.equal(map['X-Frame-Options'], 'DENY');
    assert.match(map['X-Robots-Tag'], /noindex/);
    assert.equal(map['Cache-Control'], 'no-store');
  }
});

test('admin API routes never allow a browser or proxy to cache a response', () => {
  const dir = path.join(ROOT, 'lib', 'routes', 'admin');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const caching = src.match(/Cache-Control',\s*'([^']+)'/g) || [];
    for (const hit of caching) assert.match(hit, /no-store/, `${file}: ${hit}`);
  }
});

test('the build never copies repository internals into dist/', () => {
  const src = read('scripts/minify.js');
  const dirs = src.match(/SKIP_DIRS = new Set\(\[([^\]]*)\]\)/)[1];
  for (const dir of ['.github', 'functions', 'api', 'lib', 'test', 'scripts']) assert.ok(dirs.includes(`'${dir}'`), `${dir} is skipped`);
  const files = src.match(/SKIP_FILES = (\/.*\/);/)[1];
  const keep = new Function(`return ${src.match(/KEEP_FILES = (\/.*\/);/)[1]}`)();
  const skipRe = new Function(`return ${files}`)();
  const re = { test: (n) => skipRe.test(n) && !keep.test(n) };
  for (const name of ['.firebaserc', '.gitignore', '.env.example', 'eslint.config.mjs', 'MEMBER-REGISTER-REVIEW.csv', 'HANDBOOK.md', 'package.json', 'vercel.json', 'firebase.json', 'firestore.rules', 'storage.rules', '.gitkeep']) {
    assert.ok(re.test(name), `${name} is never published`);
  }
  for (const name of ['index.html', 'site.js', 'chrome.css', 'search-index.json', 'logo.png', 'sitemap.xml', 'robots.txt']) {
    assert.ok(!re.test(name), `${name} is still published`);
  }
});

test('no member register or spreadsheet export sits in the tree', () => {
  const offenders = fs.readdirSync(ROOT).filter((f) => /\.(csv|xlsx)$/i.test(f));
  assert.deepEqual(offenders, [], 'CSV/XLSX exports at the root: ' + offenders.join(', '));
  const ignore = read('.gitignore');
  assert.match(ignore, /MEMBER-REGISTER\*\.csv/);
  assert.match(ignore, /^public\/$/m);
});

test('no live credential shape appears anywhere in the tree', () => {
  const skip = new Set(['node_modules', 'dist', 'public', '.git']);
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bshpat_[0-9a-f]{20,}/, /\bshpss_[0-9a-f]{20,}/,
    /\brzp_live_[0-9A-Za-z]{8,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bre_[0-9A-Za-z]{24,}\b/
  ];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|json|html|md|txt|yml|yaml|rules|sh|css|example)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const p of patterns) assert.doesNotMatch(text, p, `${path.relative(ROOT, full)} matches ${p}`);
    }
  };
  walk(ROOT);
});

/* The site-wide CSP is report-only until a release has run under it with a
   quiet console. Every origin a page loads from is named; a new third party
   must be added here before it appears on a page. */
test('a report-only CSP names every origin the site talks to, and nothing broader', () => {
  const v = JSON.parse(read('vercel.json'));
  const f = JSON.parse(read('firebase.json'));
  const fromV = headerMap(v.headers.find((h) => h.source === '/(.*)').headers)['Content-Security-Policy-Report-Only'];
  assert.ok(fromV, 'vercel carries the policy');
  for (const h of [].concat(f.hosting)) {
    const fromF = headerMap(h.headers.find((x) => x.source === '**').headers)['Content-Security-Policy-Report-Only'];
    assert.equal(fromV, fromF, `both hosts send the same policy (${h.target})`);
  }
  const directives = Object.fromEntries(fromV.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.ok(!directives['script-src'].includes('*'), 'script-src never wildcards');
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"), 'no unsafe-eval');
  assert.ok(directives['form-action'].includes('https://secure.ccavenue.com'), 'the CCAvenue hand-off form may post');
  assert.ok(directives['connect-src'].includes('https://identitytoolkit.googleapis.com'), 'admin sign-in works');
  assert.ok(!Object.keys(directives).some((k) => k === 'content-security-policy'), 'not enforced yet');
});

/* The comment above says "every origin a page loads from is named". That was a
   claim, not a check: nothing read the pages. This reads them, so the day the
   policy is switched from report-only to enforced it cannot take a page's
   images, its player or its lookups down with it - and a third party added to
   a page fails here first, which is the point of naming them.

   Only subresources are collected. A CSP does not govern where a link goes, so
   the PayPal link on donate.html, the citations on quiz.html and the news
   articles on cinekind.html are none of its business. */
test('every origin a page actually loads from is named in the policy', () => {
  const v = JSON.parse(read('vercel.json'));
  const policy = headerMap(v.headers.find((h) => h.source === '/(.*)').headers)['Content-Security-Policy-Report-Only'];
  const directives = Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...rest]) => [k, rest]));

  const permits = (directive, host) => {
    const list = directives[directive] || directives['default-src'] || [];
    return list.some((entry) => {
      const value = entry.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (value.startsWith('*.')) return host === value.slice(2) || host.endsWith(value.slice(1));
      return value === host;
    });
  };

  /* kind of load -> the directive that governs it */
  const PATTERNS = [
    ['img-src', /<img[^>]+src=["'](https?:\/\/[^"']+)/gi],
    ['script-src', /<script[^>]+src=["'](https?:\/\/[^"']+)/gi],
    ['script-src', /\.src\s*=\s*['"`](https?:\/\/[^'"`]+)/gi],
    ['style-src', /<link[^>]+rel=["']stylesheet["'][^>]+href=["'](https?:\/\/[^"']+)/gi],
    ['connect-src', /fetch\(\s*['"`](https?:\/\/[^'"`]+)/gi],
    ['frame-src', /<iframe[^>]+src=["'](https?:\/\/[^"']+)/gi],
    ['form-action', /<form[^>]+action=["'](https?:\/\/[^"']+)/gi],
    ['img-src', /url\(\s*["']?(https?:\/\/[^)"']+)/gi]
  ];

  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => `assets/${f}`))
    .concat(['pfa-search.js', 'pfa-forms.js', 'pfa-search.css']);

  const unnamed = [];
  for (const file of files) {
    const source = read(file);
    for (const [directive, pattern] of PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const host = match[1].replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
        if (!permits(directive, host)) unnamed.push(`${file}: ${directive} <- ${host}`);
      }
    }
  }
  assert.deepEqual([...new Set(unnamed)], [],
    'these origins are loaded by a page but not named in the CSP, so enforcing it would break them');
});
