'use strict';

/* Test data out of the panel, and nothing destroyed.

   Owner, 23 Oct 2026: "dont need any record of 20 oct and earlier cause all
   of them are test data." lib/test-data.js moves every record made up to
   the end of 20 Oct 2026 (India time), and everything tied to one, into an
   archive beside the live data; restore() puts them all back. These tests
   seed a database with both kinds, press the panel's button, and check
   what moved, what stayed, that each copy is the record exactly, and that
   putting them back gives the very database there was before. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) {
        if (token === 'test-admin') return { uid: 'u1', email: 'admin@pfa.test' };
        if (token === 'test-staff') return { uid: 'u2', email: 'staff@pfa.test' };
        throw new Error('bad token');
      },
      async getUser(uid) {
        return uid === 'u1'
          ? { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }
          : { uid: 'u2', email: 'staff@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['submissions', 'payments', 'people'] } };
      }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const TEST = require('../lib/test-data');

const ts = (iso) => Timestamp.fromMillis(Date.parse(iso));
const ARCHIVE = `${TEST.ROOT}/${TEST.SET}`;
let db;

test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
});
test.afterEach(() => { firebase._setDbForTests(null); });

async function put(path, data) {
  const parts = path.split('/');
  let ref = db.collection(parts[0]).doc(parts[1]);
  for (let i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
  await ref.set(data);
}

/* Test records, up to the end of 20 Oct 2026 in India, and live ones after. */
const TESTS = {
  'submissions/PFA-CG-2026-00001': { reference: 'PFA-CG-2026-00001', kind: 'PFA-CG', createdAt: '2026-10-15T06:00:00.000Z', receivedAtMs: Date.parse('2026-10-15T06:00:00.000Z'), fields: { name: 'Test Person', mobile: '9876543210' }, payment: { orderId: 'PFA-CGA-OLD00001', amount: '50.00' } },
  'submissions/PFA-CG-2026-00001/messages/m1': { type: 'email', direction: 'out', at: '2026-10-15T06:00:01.000Z', text: 'Copy' },
  'submissions/PFA-CG-2026-00001/attachments/1': { label: 'Photograph', storage: 'gcs', bucket: 'b', path: 'submissions/PFA-CG-2026-00001/1', size: 1200, createdAt: '2026-10-15T06:00:00.000Z' },
  'transactions/PFA-CGA-OLD00001': { orderId: 'PFA-CGA-OLD00001', type: 'caregiver-application', amount: 50, status: 'success', createdAt: ts('2026-10-15T05:59:00.000Z'), applicationReference: 'PFA-CG-2026-00001' },
  'paymentEvents/ev-old-1': { orderId: 'PFA-CGA-OLD00001', status: 'success', receivedAt: ts('2026-10-15T06:00:00.000Z') },
  'caretakerCards/PFA-CCT-OLDCARD1': { cardId: 'PFA-CCT-OLDCARD1', applicantId: 'app-old-1', applicationRef: 'PFA-CG-2026-00001', mobile: '9876543210', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caretakerPublic/PFA-CCT-OLDCARD1': { cardId: 'PFA-CCT-OLDCARD1', issuedAt: '2026-10-16T06:00:00.000Z' },
  'caretakerApplicants/app-old-1': { applicantId: 'app-old-1', cardId: 'PFA-CCT-OLDCARD1', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caretakerAddresses/addr-old-1': { addressId: 'addr-old-1', cardId: 'PFA-CCT-OLDCARD1', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caregiverMobileIndex/9876543210': { mobile: '9876543210', cardId: 'PFA-CCT-OLDCARD1', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caregiverIdentityIndex/test-person-110024': { cardId: 'PFA-CCT-OLDCARD1', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caretakerAudit/cev-old-1': { entity: 'card:PFA-CCT-OLDCARD1', action: 'card.issued', at: '2026-10-16T06:00:00.000Z', createdAt: ts('2026-10-16T06:00:00.000Z') },
  'caregiverEmails/em-old-1': { template: 'submission_forward', to: 'pfadcmho@gmail.com', status: 'sent', createdAt: ts('2026-10-15T06:00:00.000Z'), payload: { reference: 'PFA-CG-2026-00001' } },
  /* a test case's email resent after the cutoff still goes with it */
  'caregiverEmails/em-old-2': { template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', status: 'sent', createdAt: ts('2026-10-22T06:00:00.000Z'), payload: { reference: 'PFA-CG-2026-00001' } },
  'caregiverDocuments/tok-old-1': { createdAt: '2026-10-15T05:58:00.000Z', consumed: true, movedTo: 'PFA-CG-2026-00001' },
  'caregiverDocuments/tok-old-1/attachments/1': { label: 'Photograph', size: 0, droppedAt: '2026-10-15T06:00:00.000Z' },
  'transactions/PFA-SHP-OLD00001': { orderId: 'PFA-SHP-OLD00001', type: 'shop', amount: 500, status: 'cancelled', createdAt: ts('2026-10-14T06:00:00.000Z') },
  'submissions/PFA-SHP-OLD00001': { reference: 'PFA-SHP-OLD00001', kind: 'PFA-SHP', createdAt: '2026-10-14T06:01:00.000Z', fields: {} },
  'shopOrders/PFA-SHP-OLD00001': { orderId: 'PFA-SHP-OLD00001', createdAt: '2026-10-14T06:00:00.000Z' },
  /* 20 Oct, 11 pm in India: the last minute of test data */
  'transactions/PFA-DON-TESTLAST': { orderId: 'PFA-DON-TESTLAST', type: 'donate', amount: 111, status: 'success', createdAt: ts('2026-10-20T17:30:00.000Z') },
  'submissions/PFA-DON-TESTLAST': { reference: 'PFA-DON-TESTLAST', kind: 'PFA-DON', createdAt: '2026-10-20T17:31:00.000Z', fields: {} },
  'adminSearch/0001-case-a': { type: 'case', id: 'PFA-CG-2026-00001', terms: ['test'] },
  'adminSearch/0002-payment-a': { type: 'payment', id: 'PFA-CGA-OLD00001', terms: ['test'] },
  'adminSearch/0003-card-a': { type: 'card', id: 'PFA-CCT-OLDCARD1', terms: ['test'] },
  'adminSearch/0004-email-a': { type: 'email', id: 'em-old-1', terms: ['test'] }
};
/* the records themselves, not what sits under them */
const TOP = Object.keys(TESTS).filter((k) => k.split('/').length === 2).length;
const LIVE = {
  /* 21 Oct, half past midnight in India: real */
  'transactions/PFA-DON-LIVEFRST': { orderId: 'PFA-DON-LIVEFRST', type: 'donate', amount: 100, status: 'success', createdAt: ts('2026-10-20T19:00:00.000Z') },
  'submissions/PFA-DON-LIVEFRST': { reference: 'PFA-DON-LIVEFRST', kind: 'PFA-DON', createdAt: '2026-10-20T19:01:00.000Z', fields: {} },
  'submissions/PFA-CG-2026-00012': { reference: 'PFA-CG-2026-00012', kind: 'PFA-CG', createdAt: '2026-10-23T16:03:00.000Z', receivedAtMs: Date.parse('2026-10-23T16:03:00.000Z'), fields: { name: 'Trisha Dey' }, payment: { orderId: 'PFA-CGA-LGGRFRB9' } },
  'submissions/PFA-CG-2026-00012/messages/m1': { type: 'email', direction: 'out', at: '2026-10-23T16:03:01.000Z' },
  'transactions/PFA-CGA-LGGRFRB9': { orderId: 'PFA-CGA-LGGRFRB9', type: 'caregiver-application', amount: 50, status: 'success', createdAt: ts('2026-10-23T16:02:00.000Z') },
  'caretakerCards/PFA-CCT-NEWCARD1': { cardId: 'PFA-CCT-NEWCARD1', applicationRef: 'PFA-CG-2026-00012', createdAt: ts('2026-10-23T17:00:00.000Z') },
  'caregiverMobileIndex/9000000001': { cardId: 'PFA-CCT-NEWCARD1', createdAt: ts('2026-10-23T17:00:00.000Z') },
  'caregiverEmails/em-new-1': { template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', createdAt: ts('2026-10-23T16:03:00.000Z'), payload: { reference: 'PFA-CG-2026-00012' } },
  'adminSearch/0005-case-b': { type: 'case', id: 'PFA-CG-2026-00012', terms: ['trisha'] },
  'adminSearch/0006-audit-a': { type: 'audit', id: 'old-audit', terms: ['test'] },
  /* never touched, whatever their dates */
  'adminAudit/0001': { action: 'remove', at: '2026-10-10T06:00:00.000Z', atMs: Date.parse('2026-10-10T06:00:00.000Z') },
  'counters/PFA-CG-2026': { next: 13 },
  'members/PFA-MBR-OLDMEMB1': { memberId: 'PFA-MBR-OLDMEMB1', memberSince: '2019-01-01', createdAt: ts('2019-01-01T00:00:00.000Z') },
  'siteSettings/visibility': { hidden: [], updatedAt: '2026-10-01T00:00:00.000Z' }
};

async function seed() {
  for (const [p, d] of Object.entries(Object.assign({}, TESTS, LIVE))) await put(p, d);
}
const dump = () => db.dump();
const liveKeys = () => Object.keys(dump()).filter((k) => !k.startsWith(TEST.ROOT + '/'));

function call(handler, { method = 'GET', body, token = 'test-admin' } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api/admin/test-data', query: {}, body, headers: { host: 'pfa.test', 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
const route = () => require('../lib/routes/admin/test-data.js');

test('the line is the end of 20 Oct 2026 in India', () => {
  assert.equal(TEST.CUTOFF_ISO, '2026-10-20T18:30:00.000Z');
  assert.equal(TEST.isTest({ createdAt: '2026-10-20T18:29:59.999Z' }), true, '20 Oct, 11:59 pm in India');
  assert.equal(TEST.isTest({ createdAt: '2026-10-20T18:30:00.000Z' }), false, '21 Oct, midnight in India');
  assert.equal(TEST.isTest({ createdAt: ts('2026-10-01T00:00:00.000Z') }), true, 'a Firestore time');
  assert.equal(TEST.isTest({ receivedAtMs: Date.parse('2026-10-01T00:00:00.000Z') }), true, 'milliseconds');
  assert.equal(TEST.isTest({ name: 'no date' }), false, 'a record with no date is left alone');
});

test('the panel is told what would move, and nothing moves until it is asked', async () => {
  await seed();
  const before = JSON.stringify(dump());
  const seen = await call(route());
  assert.equal(seen.statusCode, 200, seen.raw);
  assert.equal(seen.json.until, '20 Oct 2026');
  assert.deepEqual(seen.json.counts, { cases: 3, payments: 3, cards: 1, emails: 2, records: TOP });
  assert.equal(seen.json.moved, null);
  assert.equal(JSON.stringify(dump()), before, 'looking changed nothing');
});

test('only a super administrator can move them', async () => {
  await seed();
  const staff = await call(route(), { method: 'POST', body: { action: 'archive' }, token: 'test-staff' });
  assert.equal(staff.statusCode, 403);
  const nobody = await call(route(), { method: 'POST', body: { action: 'archive' }, token: 'nope' });
  assert.equal(nobody.statusCode, 401);
  assert.ok(dump()['submissions/PFA-CG-2026-00001'], 'nothing moved');
});

test('one press moves every test record, and everything tied to one, whole into the archive; everything else stays exactly as it was', async () => {
  await seed();
  const before = dump();
  const res = await call(route(), { method: 'POST', body: { action: 'archive' } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.more, false);
  assert.deepEqual(res.json.went, { cases: 3, payments: 3, cards: 1, emails: 2, records: TOP, documents: Object.keys(TESTS).length });
  const told = await call(route());
  assert.deepEqual(told.json.counts, { cases: 0, payments: 0, cards: 0, emails: 0, records: 0 }, 'nothing left to move');
  assert.equal(told.json.moved.counts.cases, 3, 'and the panel is told it is done');

  const after = dump();
  for (const p of Object.keys(TESTS)) {
    assert.equal(after[p], undefined, `${p} left the live data`);
    assert.deepEqual(after[`${ARCHIVE}/${p}`], before[p], `${p} is in the archive, exactly as it was`);
  }
  for (const p of Object.keys(LIVE)) assert.deepEqual(after[p], before[p], `${p} untouched`);
  assert.deepEqual(liveKeys().filter((k) => !k.startsWith('adminAudit/')).sort(), Object.keys(LIVE).filter((k) => !k.startsWith('adminAudit/')).sort(), 'and nothing else changed');

  /* the record of it */
  const meta = after[ARCHIVE];
  assert.equal(meta.cutoff, TEST.CUTOFF_ISO);
  assert.equal(meta.movedBy, 'admin@pfa.test');
  const log = Object.entries(after).filter(([k, v]) => k.startsWith('adminAudit/') && v.action === 'test-data-out');
  assert.equal(log.length, 1, 'written to the admin log');
  assert.match(log[0][1].detail, /3 forms, 3 payments, 1 colony card, 2 emails/);

  /* pressing again moves nothing more */
  const again = await call(route(), { method: 'POST', body: { action: 'archive' } });
  assert.deepEqual(again.json.went, { cases: 0, payments: 0, cards: 0, emails: 0, records: 0, documents: 0 });
  assert.equal(dump()[ARCHIVE].counts.cases, 3, 'the record of the first press stands');
  const seen = await call(route());
  assert.equal(seen.json.moved.counts.cases, 3);
});

test('after the move the panel, its search and the public card know nothing of them; a test card\'s mobile can apply again', async () => {
  await seed();
  await call(route(), { method: 'POST', body: { action: 'archive' } });
  const records = require('../lib/routes/admin/records.js');
  const list = await new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {}, getHeader() {}, end(raw) { out.raw = raw; try { out.json = JSON.parse(raw); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(records({ method: 'GET', url: '/api/admin/records', query: { type: 'payments' }, headers: { host: 'pfa.test', authorization: 'Bearer test-admin' } }, response)).catch(reject);
  });
  assert.equal(list.statusCode, 200, list.raw);
  assert.deepEqual(list.json.rows.map((r) => r.orderId).sort(), ['PFA-CGA-LGGRFRB9', 'PFA-DON-LIVEFRST']);
  const SEARCH = require('../lib/admin-search');
  const found = await SEARCH.search(db, 'PFA-CG-2026-00001', () => true);
  assert.deepEqual(found.results, [], 'search finds nothing of it');
  assert.equal((await db.collection('caretakerPublic').doc('PFA-CCT-OLDCARD1').get()).exists, false, 'the public card page has nothing to show');
  assert.equal((await db.collection('caregiverMobileIndex').doc('9876543210').get()).exists, false, 'the mobile is free');
});

test('put back: every record returns exactly where it was, and the archive is empty', async () => {
  await seed();
  const before = dump();
  await call(route(), { method: 'POST', body: { action: 'archive' } });
  const back = await call(route(), { method: 'POST', body: { action: 'restore' } });
  assert.equal(back.statusCode, 200, back.raw);
  assert.equal(back.json.kept, 0);
  assert.deepEqual(back.json.back, { cases: 3, payments: 3, cards: 1, emails: 2, records: TOP, documents: Object.keys(TESTS).length });
  const now = dump();
  for (const p of Object.keys(before)) assert.deepEqual(now[p], before[p], `${p} as it was`);
  assert.deepEqual(Object.keys(now).filter((k) => k.startsWith(`${ARCHIVE}/`)), [], 'nothing left in the archive');
  assert.ok(now[ARCHIVE].restoredAt);
  assert.equal((await call(route())).json.moved, null);
  assert.deepEqual((await call(route())).json.counts.cases, 3, 'and they would move again');
});

test('a run out of time stops part way, leaves every document in one place, and the next press finishes', async () => {
  await seed();
  for (let i = 0; i < 300; i += 1) await put(`submissions/PFA-CG-2026-00001/messages/bulk-${String(i).padStart(3, '0')}`, { type: 'email', at: '2026-10-15T07:00:00.000Z', text: 'x' });
  const all = Object.keys(TESTS).length + 300;
  /* time already up: it reads, then stops after the first transaction */
  const first = await TEST.archive(db, { by: 'admin@pfa.test', deadline: Date.now() - 1 });
  assert.equal(first.more, true);
  const inBoth = () => Object.keys(dump()).filter((k) => !k.startsWith(TEST.ROOT + '/') && dump()[`${ARCHIVE}/${k}`]);
  assert.deepEqual(inBoth(), [], 'never in both places');
  let total = first.moved.documents;
  for (let i = 0; i < 50; i += 1) {
    const step = await TEST.archive(db, { by: 'admin@pfa.test', deadline: Date.now() - 1 });
    total += step.moved.documents;
    assert.deepEqual(inBoth(), []);
    if (!step.more) break;
  }
  assert.equal(total, all, 'every document, once');
  for (const p of Object.keys(TESTS)) assert.equal(dump()[p], undefined);
  for (const p of Object.keys(LIVE)) assert.ok(dump()[p], `${p} stays`);
  assert.equal(dump()[ARCHIVE].counts.cases, 3);
});

test('a case whose messages moved but not itself is put back whole by restore', async () => {
  await seed();
  for (let i = 0; i < 300; i += 1) await put(`submissions/PFA-CG-2026-00001/messages/bulk-${String(i).padStart(3, '0')}`, { type: 'email', at: '2026-10-15T07:00:00.000Z', text: 'x' });
  const before = dump();
  /* the reviewer's case: stopped between the case's messages and the case */
  const part = await TEST.archive(db, { deadline: Date.now() - 1 });
  assert.equal(part.more, true);
  const back = await TEST.restore(db, {});
  assert.equal(back.more, false);
  assert.equal(back.kept, 0);
  const now = dump();
  for (const p of Object.keys(before)) assert.deepEqual(now[p], before[p], `${p} back as it was`);
  assert.deepEqual(Object.keys(now).filter((k) => k.startsWith(`${ARCHIVE}/`)), []);
});

test('photographs kept inside their documents move a few at a time, never more than 6 MB in one go', async () => {
  await seed();
  const big = Buffer.alloc(900 * 1024, 7);
  for (let i = 1; i <= 20; i += 1) await put(`submissions/PFA-CG-2026-00001/attachments/p${i}`, { label: 'Photograph', bytes: big, size: big.length, createdAt: '2026-10-15T06:00:00.000Z' });
  const sizes = [];
  const real = db.runTransaction.bind(db);
  db.runTransaction = async (fn) => real(async (tx) => {
    let bytes = 0;
    const create = tx.create.bind(tx);
    tx.create = (ref, data) => { bytes += TEST.sizeOf(data); return create(ref, data); };
    const out = await fn(tx);
    sizes.push(bytes);
    return out;
  });
  const done = await TEST.archive(db, {});
  assert.equal(done.more, false);
  assert.ok(Math.max(...sizes) <= 6 * 1024 * 1024, `largest transaction ${Math.max(...sizes)} bytes`);
  assert.ok(sizes.filter((n) => n > 1024 * 1024).length >= 3, 'the twenty went in several');
  assert.ok(Buffer.from(dump()[`${ARCHIVE}/submissions/PFA-CG-2026-00001/attachments/p20`].bytes).equals(big), 'each whole');
});

test('a reply filed on a test case while it is being moved is in the archive with it, not lost', async () => {
  await seed();
  const real = db.runTransaction.bind(db);
  let once = false;
  db.runTransaction = async (fn) => real(async (tx) => {
    const out = await fn(tx);
    /* someone writes the case between this transaction's read and its commit */
    if (!once && (await db.collection('submissions').doc('PFA-CG-2026-00001').get()).exists && out.moved.includes('submissions/PFA-CG-2026-00001')) {
      once = true;
      await db.collection('submissions').doc('PFA-CG-2026-00001').set({ replyCount: 1 }, { merge: true });
    }
    return out;
  });
  const done = await TEST.archive(db, {});
  assert.equal(done.more, false);
  assert.ok(once, 'the write happened mid-move');
  assert.equal(dump()['submissions/PFA-CG-2026-00001'], undefined);
  assert.equal(dump()[`${ARCHIVE}/submissions/PFA-CG-2026-00001`].replyCount, 1, 'the copy has the reply: the move ran again');
});

test('nothing is written over: a place in the archive already taken leaves that record where it is', async () => {
  await seed();
  await put(`${ARCHIVE}/caregiverEmails/em-old-1`, { kept: 'from an earlier put-back' });
  const done = await TEST.archive(db, {});
  assert.equal(done.taken, 1);
  assert.deepEqual(dump()[`${ARCHIVE}/caregiverEmails/em-old-1`], { kept: 'from an earlier put-back' }, 'the archive copy untouched');
  assert.ok(dump()['caregiverEmails/em-old-1'], 'and the live one left where it is');
});

test('a public form cannot tie itself to a test payment by naming its order', async () => {
  await seed();
  await put('submissions/PFA-Q-2026-00050', { reference: 'PFA-Q-2026-00050', kind: 'PFA-Q', createdAt: '2026-10-23T10:00:00.000Z', fields: { orderId: 'PFA-CGA-OLD00001' } });
  await TEST.archive(db, {});
  assert.ok(dump()['submissions/PFA-Q-2026-00050'], 'a question asked on 23 Oct stays');
});

test('a payment made after the line for a test case goes with the case, even across presses', async () => {
  await seed();
  await put('transactions/PFA-CGA-LATEPAY1', { orderId: 'PFA-CGA-LATEPAY1', type: 'caregiver-application', createdAt: ts('2026-10-21T06:00:00.000Z'), applicationReference: 'PFA-CG-2026-00002' });
  await put('submissions/PFA-CG-2026-00002', { reference: 'PFA-CG-2026-00002', kind: 'PFA-CG', createdAt: '2026-10-20T10:00:00.000Z', payment: { orderId: 'PFA-CGA-LATEPAY1' }, fields: {} });
  /* the first press moves the case and stops before its payment */
  await TEST.archive(db, { deadline: Date.now() - 1 });
  for (let i = 0; i < 50; i += 1) if (!(await TEST.archive(db, { deadline: Date.now() - 1 })).more) break;
  assert.equal(dump()['transactions/PFA-CGA-LATEPAY1'], undefined, 'the payment went too');
  assert.ok(dump()[`${ARCHIVE}/transactions/PFA-CGA-LATEPAY1`]);
});

test('a failure part way through a record still says what moved, for the log', async () => {
  await seed();
  for (let i = 0; i < 300; i += 1) await put(`adminSearch/zz-bulk-${String(i).padStart(3, '0')}`, { type: 'case', id: 'PFA-CG-2026-00001', terms: [] });
  const real = db.runTransaction.bind(db);
  let n = 0;
  db.runTransaction = async (fn) => { n += 1; if (n === 2) throw new Error('ABORTED: Too much contention'); return real(fn); };
  const done = await TEST.archive(db, {});
  assert.equal(done.more, true);
  assert.match(done.error, /ABORTED/);
  assert.ok(done.moved.documents > 0, 'what went is counted');
  db.runTransaction = real;
  const rest = await TEST.archive(db, {});
  assert.equal(rest.more, false, 'the next press finishes');
  for (const p of Object.keys(TESTS)) assert.equal(dump()[p], undefined);
});
