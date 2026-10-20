'use strict';

/* Removing a record from the panel, and why it is not a delete.

   Owner, 20 Oct 2026: "can we delete the items from admin panel and make it
   clean". The panel's oldest rule says no server code ever deletes a stored
   record (test/admin-master-record.test.js: an earlier admin destroyed posts,
   replies and whole member profiles). So "delete" here is remove: the record
   keeps its messages, its files and its history, and leaves every register,
   every count, search, the public wall and the public tracker, under a status
   no flow can reach. Restore puts it back exactly where it stood, wall
   placement included. Everything below drives the real routes against the
   in-memory Firestore. */

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

const ADMIN = { authorization: 'Bearer test-admin' };
const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PUBLIC_SITE_URL', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};
let db;
const realFetch = global.fetch;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test' });
  delete process.env.PFA_SUBMISSIONS_INBOX;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  require('../lib/routes/admin/records.js')._resetHeal();
  global.fetch = async () => new Response(JSON.stringify({ id: 'mail_x' }), { status: 200, headers: { 'content-type': 'application/json' } });
});
test.afterEach(() => {
  global.fetch = realFetch;
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const caseRoute = () => require('../lib/routes/admin/case');
const act = (body) => call(caseRoute(), { body, headers: ADMIN });

async function seeded() {
  const res = await call(require('../lib/routes/pfa-submissions'), {
    body: {
      kind: 'PFA-Q', page: 'ask.html', clientRequestId: 'req-' + Math.random(),
      data: { question: 'A community dog near the market has a wound on its leg and needs a vet soon.', topic: 'An animal I found or feed', state: 'Delhi', city: 'New Delhi', name: 'Asha Rao', contact: '9876543210', email: 'asha@example.com' }
    }
  });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  return res.json.reference;
}

async function register(query) {
  const res = await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: Object.assign({ type: 'submissions', limit: '50' }, query || {}), headers: ADMIN });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  return res.json.rows.map((r) => r.reference);
}

test('remove keeps everything, leaves every list, and says who and from where', async () => {
  const ref = await seeded();
  await act({ reference: ref, action: 'note', text: 'Called the caller; vet goes tomorrow.' });

  const res = await act({ reference: ref, action: 'remove' });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.equal(res.json.status, 'removed');
  assert.equal(res.json.case.statusLabel, 'Removed');
  assert.deepEqual(res.json.case.moves, [], 'a removed record offers no moves');

  const doc = (await db.collection('submissions').doc(ref).get()).data();
  assert.equal(doc.status, 'removed');
  assert.equal(doc.removed.was, 'new', 'where it stood is written on it');
  assert.equal(doc.removed.by, 'admin@pfa.test');
  assert.equal(doc.noteCount, 1, 'the note it carried is still counted');
  const msgs = await db.collection('submissions').doc(ref).collection('messages').get();
  assert.ok(msgs.size >= 1, 'and still there: nothing was deleted');
  assert.equal(doc.history[doc.history.length - 1].event, 'remove');

  const audits = await db.collection('adminAudit').get();
  const line = audits.docs.map((d) => d.data()).find((e) => e.action === 'remove');
  assert.ok(line, 'the audit says it happened');
  assert.equal(line.subject, ref, 'and to what, so it can be found and restored from the log alone');

  assert.ok(!(await register()).includes(ref), 'gone from the register');
  assert.ok(!(await register({ status: 'new' })).includes(ref), 'and from its old status bucket');
  assert.ok((await register({ status: 'removed' })).includes(ref), 'listed only when asked for by name');

  const second = await act({ reference: ref, action: 'remove' });
  assert.equal(second.json.unchanged, true, 'removing again changes nothing');
});

test('a removed record is read only until it is restored', async () => {
  const ref = await seeded();
  await act({ reference: ref, action: 'remove' });
  for (const body of [
    { reference: ref, action: 'note', text: 'should not land' },
    { reference: ref, action: 'status', status: 'handled' },
    { reference: ref, action: 'assign', to: 'x@pfa.test' }
  ]) {
    const res = await act(body);
    assert.equal(res.statusCode, 409, `${body.action}: ${res.raw.slice(0, 200)}`);
    assert.equal(res.json.code, 'REMOVED');
  }
});

test('restore puts it back exactly where it stood', async () => {
  const ref = await seeded();
  await act({ reference: ref, action: 'status', status: 'in-progress' });
  await act({ reference: ref, action: 'remove' });
  const res = await act({ reference: ref, action: 'restore' });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.equal(res.json.status, 'in-progress', 'back to the status it held, not to the start');
  const doc = (await db.collection('submissions').doc(ref).get()).data();
  assert.equal(doc.removed, null);
  assert.equal(doc.history[doc.history.length - 1].event, 'restore');
  assert.ok((await register()).includes(ref), 'back on the register');
  const again = await act({ reference: ref, action: 'restore' });
  assert.equal(again.json.unchanged, true, 'restoring a live record changes nothing');
});

test('the dashboard counts what the registers show', async () => {
  const ref = await seeded();
  const other = await seeded();
  const metrics = () => call(require('../lib/routes/admin/metrics.js'), { method: 'GET', headers: ADMIN });
  const before = (await metrics()).json;
  await act({ reference: ref, action: 'remove' });
  const after = (await metrics()).json;
  assert.equal(after.cards.submissionsTotal, before.cards.submissionsTotal - 1, 'a removed record leaves the total');
  assert.equal((after.submissions.byStatus || {}).new, (before.submissions.byStatus || {}).new - 1, 'and its status bucket');
  await act({ reference: ref, action: 'restore' });
  assert.equal((await metrics()).json.cards.submissionsTotal, before.cards.submissionsTotal);
  assert.ok(other, 'a second live record proves the subtraction is not counting to zero');
});

test('a film is taken off the wall by removal and put back by restore', async () => {
  const ref = await seeded();
  /* the wall flag is its own action and only PFA-S and PFA-W carry it, so the
     record is shaped as the wall route reads it */
  await db.collection('submissions').doc(ref).set({ kind: 'PFA-S', wall: { published: true, by: 'admin@pfa.test', at: new Date().toISOString() } }, { merge: true });
  await act({ reference: ref, action: 'remove' });
  let doc = (await db.collection('submissions').doc(ref).get()).data();
  assert.equal(doc.wall.published, false, 'off the wall the moment it is removed');
  assert.equal(doc.removed.wasWall, true, 'and the wall placement is remembered');
  await act({ reference: ref, action: 'restore' });
  doc = (await db.collection('submissions').doc(ref).get()).data();
  assert.equal(doc.wall.published, true, 'back on the wall with everything else');
});

test('the public tracker answers for a removed record as for an unknown one', async () => {
  const ref = await seeded();
  const follow = () => call(require('../lib/routes/pfa-submissions'), { method: 'GET', query: { reference: ref, contact: 'asha@example.com' } });
  assert.equal((await follow()).statusCode, 200, 'found while it is live');
  await act({ reference: ref, action: 'remove' });
  const res = await follow();
  assert.equal(res.statusCode, 404, 'and not after, even with the right contact');
  await act({ reference: ref, action: 'restore' });
  assert.equal((await follow()).statusCode, 200, 'found again once restored');
});

test('search does not bring a removed record back', async () => {
  const ref = await seeded();
  const SEARCH = require('../lib/admin-search');
  await SEARCH.sync(db, { budgetMs: 20000 });
  const hits = async () => (await SEARCH.search(db, 'asha rao', () => true)).results.map((r) => r.id);
  assert.ok((await hits()).includes(ref), 'found while it is live');
  await act({ reference: ref, action: 'remove' });
  await SEARCH.sync(db, { budgetMs: 20000 });
  assert.ok(!(await hits()).includes(ref), 'not after');
  await act({ reference: ref, action: 'restore' });
  await SEARCH.sync(db, { budgetMs: 20000 });
  assert.ok((await hits()).includes(ref), 'found again once restored');
});
