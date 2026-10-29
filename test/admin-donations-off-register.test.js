'use strict';

/* Donations are off the Submissions register (owner, 26 Oct 2026:
   "donations dont need to appear here in submissions as they dont have a
   status or action"). A donation lives under Payments & donations. Here the
   real routes run against the in-memory Firestore: a donation sits beside a
   help desk query, and only the query is on the register, in its kind list,
   and in its counts. The donation record itself is kept and still opens by
   reference. */

const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const { OFF_REGISTER } = require('../lib/submissions');

const ADMIN = { authorization: 'Bearer test-admin' };
let db;

test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  require('../lib/routes/admin/records.js')._resetHeal();
});
test.afterEach(() => { firebase._setDbForTests(null); });

function call(handler, { method = 'GET', query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, headers: Object.assign({ host: 'pfa.test' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const records = (query) => call(require('../lib/routes/admin/records.js'), { query: Object.assign({ type: 'submissions', limit: '25' }, query), headers: ADMIN });
const metrics = () => call(require('../lib/routes/admin/metrics.js'), { headers: ADMIN });

async function seed() {
  const now = Date.now();
  const put = (ref, kind, ago) => db.collection('submissions').doc(ref).set({
    reference: ref, kind, status: 'new', receivedAtMs: now - ago, createdAt: new Date(now - ago).toISOString(), fields: { name: 'Asha Rao', email: 'asha@example.com' }
  });
  await put('PFA-DON-2026-00001', 'PFA-DON', 60000);
  await put('PFA-DON-2026-00002', 'PFA-DON', 30000);
  await put('PFA-Q-2026-00001', 'PFA-Q', 90000);
}

test('donations are the kinds kept off the register', () => {
  /* shop orders joined on 28 Oct 2026: they have a section of their own */
  assert.deepEqual([...OFF_REGISTER], ['PFA-DON', 'PFA-SHP']);
});

test('the register lists the query and none of the donations, under any status', async () => {
  await seed();
  for (const status of ['', 'new']) {
    const res = await records(status ? { status } : {});
    assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
    assert.deepEqual(res.json.rows.map((r) => r.reference), ['PFA-Q-2026-00001'], `status=${status || 'every'}`);
  }
});

test('a donation still opens by its reference', async () => {
  await seed();
  const res = await records({ q: 'PFA-DON-2026-00001' });
  assert.deepEqual(res.json.rows.map((r) => r.reference), ['PFA-DON-2026-00001']);
});

test('the counts, the waiting badge and the kind list leave donations out', async () => {
  await seed();
  const m = (await metrics()).json;
  assert.equal(m.cards.submissionsTotal, 1, 'the total');
  assert.equal(m.cards.submissionsWaiting, 1, 'the Submissions badge and the overview figure');
  assert.equal(m.cards.submissionsLast7, 1, 'this week');
  assert.equal((m.submissions.byStatus || {}).new, 1, 'the status bucket');
  assert.equal(m.submissions.arrivals.reduce((n, d) => n + (d.count || 0), 0), 1, 'the arrivals chart');
  assert.ok(!('PFA-DON' in m.byKind), 'Donation is not in the Every kind list');
  assert.ok('PFA-Q' in m.byKind);
});
