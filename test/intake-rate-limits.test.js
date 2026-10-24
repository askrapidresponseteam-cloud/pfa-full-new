'use strict';

/* The brakes on looking up and on sending (8 Oct 2026, review B, finding 7).

   They were keyed on the first X-Forwarded-For entry, which the client
   writes, so rotating it walked past both. The counts lived in each warm
   instance's memory, separately on Vercel and on Firebase, and were wiped
   for everyone once 5000 keys had been seen. Now the address is the one the
   platform vouches for, the count is one Firestore document per address and
   window that both servers share, and this instance's own count is the
   fallback when Firestore cannot be reached. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { PLACE } = require('./_place');

const PLATFORM = ['VERCEL', 'K_SERVICE', 'FUNCTION_TARGET'];
function onPlatform(name) {
  PLATFORM.forEach((k) => delete process.env[k]);
  if (name === 'vercel') process.env.VERCEL = '1';
  if (name === 'firebase') process.env.K_SERVICE = 'api';
}

function call(handler, { method = 'POST', body, query = {}, headers = {}, ip = '198.51.100.7' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, socket: { remoteAddress: ip }, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function build(db) {
  return createHandler({ getDb: () => db, deliver: async () => ({ providerId: 'p' }), isConfigured: () => false, now: () => Date.now(), queue: null });
}

const CR = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping.',
  animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001',
  when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'reporter@example.com'
};
/* every form now sends an address (test/_place.js) */
Object.assign(CR, PLACE);
const lookup = (handler, i, headers, ip) => call(handler, { method: 'GET', ip, headers, query: { reference: 'PFA-CR-2026-' + String(i).padStart(5, '0'), contact: 'x@y.zz' } });

test.beforeEach(() => { S.resetForTests(); process.env.PFA_SUBMISSIONS_INBOX = 'off'; });
test.after(() => { onPlatform(null); delete process.env.PFA_SUBMISSIONS_INBOX; firebase._setDbForTests(null); });

test('B7: on Firebase the brake is keyed on the hop Google adds, not on what the client wrote', async () => {
  onPlatform('firebase');
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': '10.0.0.1, 34.1.1.1' } }), '34.1.1.1');
  let limited = 0;
  for (let i = 0; i < 60; i += 1) {
    const r = await lookup(handler, i, { 'x-forwarded-for': `10.0.${i}.1, 34.1.1.1` });
    if (r.statusCode === 429) limited += 1;
  }
  assert.equal(limited, 20, 'a rotating first entry escaped the brake');
});

test('B7: on Vercel the brake is keyed on the address Vercel sets', async () => {
  onPlatform('vercel');
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  let limited = 0;
  for (let i = 0; i < 50; i += 1) {
    const r = await lookup(handler, i, { 'x-real-ip': '34.2.2.2', 'x-forwarded-for': `10.1.${i}.1` });
    if (r.statusCode === 429) limited += 1;
  }
  assert.equal(limited, 10);
  assert.equal(S.clientIp({ headers: { 'x-vercel-forwarded-for': '34.3.3.3', 'x-forwarded-for': '10.0.0.9' } }), '34.3.3.3');
});

test('B7: anywhere else, the socket\'s own address; a forwarded header counts for nothing', async () => {
  onPlatform(null);
  assert.equal(S.clientIp({ headers: { 'x-forwarded-for': '10.0.0.1' }, socket: { remoteAddress: '192.0.2.5' } }), '192.0.2.5');
});

test('B7: every instance and both servers share one count, kept in Firestore', async () => {
  onPlatform('firebase');
  const db = memoryFirestore(); firebase._setDbForTests(db);
  /* two servers, each a fresh instance on every request: only a shared count can brake */
  const vercel = build(db);
  const fire = build(db);
  let limited = 0;
  for (let i = 0; i < 50; i += 1) {
    S.resetForTests();
    const r = await lookup(i % 2 ? vercel : fire, i, { 'x-forwarded-for': '34.4.4.4' });
    if (r.statusCode === 429) limited += 1;
  }
  assert.equal(limited, 10, 'each instance braked on its own count');
  const rows = Object.entries(db.dump()).filter(([k]) => k.startsWith('rateLimits/')).map(([, v]) => v);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 50);
  assert.equal(rows[0].bucket, 'lookup');
  assert.ok(rows[0].expiresAt instanceof Date && rows[0].expiresAt.getTime() > Date.now(), 'the window says when it ends');
  assert.ok(!JSON.stringify(rows).includes('34.4.4.4'), 'the address is stored as written');

  /* sending, too: thirty-one valid submissions from one address, each on a fresh instance */
  let refused = null;
  for (let i = 0; i < S.WRITE_LIMIT + 1; i += 1) {
    S.resetForTests();
    const r = await call(i % 2 ? vercel : fire, { headers: { 'x-forwarded-for': '34.5.5.5' }, body: { kind: 'PFA-CR', data: CR, clientRequestId: `w${i}` } });
    if (r.statusCode === 429) refused = r;
  }
  assert.ok(refused, 'the sending brake is not shared');
  assert.match(refused.json.error, /call 112/);
});

test('guard (B7): when Firestore cannot be reached, this instance\'s own count still brakes', async () => {
  onPlatform(null);
  const db = memoryFirestore();
  db.runTransaction = async () => { throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }); };
  const handler = build(db);
  const quiet = console.warn; console.warn = () => {};
  try {
    let limited = 0;
    for (let i = 0; i < 45; i += 1) if ((await lookup(handler, i, {}, '192.0.2.9')).statusCode === 429) limited += 1;
    assert.equal(limited, 5);
  } finally { console.warn = quiet; }
});

test('B7: a full map lets go of the stalest addresses, never of everyone\'s count', () => {
  const t = Date.now();
  for (let i = 0; i < 40; i += 1) assert.equal(S.rateLimited('203.0.113.50', t + i), false);
  /* a flood of new addresses past the cap, while the braked one keeps trying */
  for (let i = 0; i < S.MAX_KEYS + 200; i += 1) {
    S.rateLimited(`10.${i >> 16 & 255}.${i >> 8 & 255}.${i & 255}`, t + 50);
    if (i % 100 === 0) assert.equal(S.rateLimited('203.0.113.50', t + 50), true, `the brake was wiped after ${i} new addresses`);
  }
  assert.equal(S._memoryCounts().hits, S.MAX_KEYS, 'the map grew past its cap');
  assert.equal(S.rateLimited('10.0.0.0', t + 60), false, 'the stalest address was let go');
});
