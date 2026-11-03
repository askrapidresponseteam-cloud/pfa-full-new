'use strict';

/* Site analytics (owner, 3 Nov 2026: "admin to get analytics of how many
   visited which page..and whatever other analytics that is actually
   useful"): counts per day, never a person; the panel's Analytics section. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_review-recheck-harness');
const A = require('../lib/analytics');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-03T06:30:00Z'); /* 12:00 in India */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

test('a page view is read into page, visit, source, device, place and hour', () => {
  const h = A.readHit({ p: '/laws.html', n: 1, r: 'www.google.co.in', w: 390 }, { 'user-agent': UA, 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'KA' }, NOW);
  assert.deepEqual(h, { day: '2026-11-03', hour: 12, page: 'laws', visit: true, source: 'Google', campaign: '', device: 'Phone', country: 'IN', region: 'KA', error: '' });
  assert.equal(A.pageKey('/'), 'index');
  assert.equal(A.pageKey('/units/agra'), 'units~agra');
  assert.equal(A.pageKey('/no-such-page'), 'other', 'an invented address adds no field');
  assert.equal(A.pageKey('/admin.html'), 'other');
  assert.equal(A.sourceOf('', 'whatsapp'), 'WhatsApp');
  assert.equal(A.sourceOf('', ''), 'Typed or bookmarked');
  assert.equal(A.sourceOf('l.instagram.com', ''), 'Instagram');
  assert.equal(A.sourceOf('some-blog.example', ''), 'Other websites', 'no host names kept');
  assert.equal(A.readHit({ p: '/' }, { 'user-agent': 'Googlebot/2.1' }, NOW), null, 'crawlers are not visitors');
  assert.equal(A.dayOf(Date.parse('2026-11-03T19:00:00Z')), '2026-11-04', 'the day is India’s');
});

test('page views count up, and the panel adds them up by day, page, source, device and state', async () => {
  const W = H.fresh({ latency: 0 });
  try {
    const HIT = require('../lib/routes/analytics');
    HIT._reset();
    const ADMIN = require('../lib/routes/admin/analytics');
    const post = (body, headers) => H.call((q, s) => HIT(q, s, { now: () => NOW }), { body, token: null, headers: Object.assign({ 'user-agent': UA }, headers || {}) });
    const r1 = await post({ p: '/', n: 1, r: 'www.google.com', w: 390 }, { 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'MH' });
    assert.equal(r1.statusCode, 204);
    assert.equal(r1.raw, '', 'the page learns nothing from the count');
    await post({ p: '/laws', n: 0, w: 390 });
    await post({ p: '/laws.html', n: 0, w: 1400 });
    await post({ p: '/donate', n: 1, us: 'whatsapp', uc: 'Diwali Drive!', w: 1400 }, { 'x-vercel-ip-country': 'US' });
    await post({ p: '/donate', e: 'TypeError: x is undefined' });
    await post({ p: '/', n: 1 }, { 'user-agent': 'curl/8.0' });
    const doc = (await W.db.collection('analytics_days').doc('2026-11-03').get()).data();
    assert.equal(doc.views, 4);
    assert.equal(doc.visits, 2);
    assert.equal(doc.pages.laws, 2);
    assert.equal(doc.errors, 1);
    assert.ok(!JSON.stringify(doc).includes('203.0.113'), 'no network address is kept');
    await H.seed(W.db, 'PFA-CR-2026-00001', { kind: 'PFA-CR', status: 'new', receivedAtMs: NOW - 3600e3 });
    const g = await H.call((q, s) => ADMIN(q, s, { now: () => NOW }), { method: 'GET', query: { days: '7' }, token: 'tok-a' });
    assert.equal(g.statusCode, 200, g.raw);
    const d = g.json;
    assert.equal(d.days, 7);
    assert.equal(d.visits, 2);
    assert.equal(d.views, 4);
    assert.equal(d.perVisit, 2);
    assert.deepEqual(d.pages[0], { key: 'laws', label: 'Laws', n: 2 });
    assert.deepEqual(d.sources.map((x) => x.label).sort(), ['Google', 'WhatsApp']);
    assert.deepEqual(d.regions, [{ key: 'MH', label: 'Maharashtra', n: 1 }]);
    assert.equal(d.campaigns[0].key, 'diwali drive');
    assert.equal(d.hours[12], 4);
    assert.equal(d.errorMessages[0].message, 'TypeError: x is undefined');
    assert.deepEqual(d.actions, [{ kind: 'PFA-CR', label: 'Cruelty report', n: 1 }]);
    const desk = await H.call((q, s) => ADMIN(q, s, { now: () => NOW }), { method: 'GET', query: {}, token: 'tok-desk' });
    assert.equal(desk.statusCode, 403, 'staff without Analytics are refused');
  } finally { W.restore(); }
});

test('wired: the route, the module, the panel, the page script, the Firebase bundle, the privacy page', () => {
  const { ROUTES } = require('../api/index.js')._private;
  assert.ok(ROUTES.analytics && ROUTES['admin/analytics']);
  assert.ok(require('../lib/admin-modules').MODULES.some((m) => m.key === 'analytics'));
  const admin = read('admin.html');
  assert.match(admin, /data-tab="analytics">Analytics</);
  assert.match(admin, /data-pane="analytics"/);
  assert.match(admin, /<script src="assets\/admin-analytics\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-analytics\.js'/);
  const chrome = read('assets/chrome.js');
  assert.match(chrome, /fetch\('\/api\/analytics'/);
  assert.match(chrome, /doNotTrack === '1'/, 'a browser that asks not to be tracked sends nothing');
  assert.match(chrome, /credentials: 'omit'/);
  assert.match(read('privacy.html'), /counts how many times each page is opened/);
  assert.doesNotMatch(read('assets/admin-analytics.js'), /[–—]/);
});
