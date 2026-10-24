'use strict';

/* Review C item 1 (8 Oct 2026): the queue's keys for a submission's emails
   carry its threadId (CONTRACT section 4). A reference issued a second time
   (the counters were emptied while caregiverEmails was not) found its
   predecessor's row, the copy to PFA's inbox was never sent, the page said
   it was, and the panel's "never copied" list did not show it. */

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
const mailer = require('../lib/caregiver-mail');
const CONFIRM = require('../lib/confirmations');
const store = require('../lib/caregiver-store');
const FORWARD = require('../lib/submission-forward');

const INBOX = 'gandhim@exmpls.sansad.in';
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = [];
  mailer._setSmtpTransport(() => ({
    async sendMail(message) { smtp.push(message); return { messageId: message.messageId }; },
    close() {}
  }));
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
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

const ask = (o) => Object.assign({ question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: 'asha.rao@example.com' }, o || {});
const submit = (data) => call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-Q', data: ask(data), page: 'ask.html', clientRequestId: 'req-' + Math.random() } });
const { PLACE } = require('./_place');

test('C1 a reference issued a second time still sends its own copy to the inbox', async () => {
  const first = await submit({ name: 'Old Person', email: 'old@example.com', mobile: '9876500001' });
  assert.equal(first.json.reference, 'PFA-Q-2026-00001');
  /* the database emptied, the outbound queue left as it was */
  for (const k of [...db._store.keys()]) if (/^(submissions|counters|submissionIdempotency)\//.test(k)) db._store.delete(k);
  smtp.length = 0;
  const second = await submit({ name: 'New Person', email: 'new@example.com', mobile: '9876500002', question: 'Can I foster a kitten?' });
  assert.equal(second.json.reference, 'PFA-Q-2026-00001', 'the same number, issued again');
  const record = db.dump()['submissions/PFA-Q-2026-00001'];
  const copies = smtp.filter((m) => m.to === INBOX);
  assert.equal(copies.length, 1, 'the new submission was copied to the inbox');
  assert.match(copies[0].text, /New Person/);
  assert.equal(copies[0].messageId, `<PFA-Q-2026-00001.${record.threadId}.forward@peopleforanimalsindia.org>`, 'under its own thread');
  const rows = Object.keys(db.dump()).filter((k) => k.startsWith('caregiverEmails/submission_forward_'));
  assert.equal(rows.length, 2, 'two rows, one per submission; the old one untouched');
});

test('C1 the panel lists a reused reference whose copy was never made, and not one copied under the old key', async () => {
  const { missedSubmissions } = require('../lib/routes/admin/mail-check')._private;
  const ref = 'PFA-Q-2026-00001';
  /* the old submission's copy, queued before threads joined the key */
  await store.queueEmail({ template: 'submission_forward', to: INBOX, payload: { reference: ref, threadId: 'aaaaaaaaaaaa' }, dedupeKey: `submission_forward:${ref}:${INBOX}` });
  await db.collection('submissions').doc(ref).create({ reference: ref, kind: 'PFA-Q', kindLabel: 'Help desk query', threadId: 'bbbbbbbbbbbb', createdAt: '2026-10-08T05:00:00.000Z' });
  let missed = await missedSubmissions(db, [INBOX]);
  assert.deepEqual(missed.map((m) => m.reference), [ref], 'the new submission has no copy, whatever its predecessor had');

  /* a record copied before this release: its row is under the old key, with its own thread */
  const older = 'PFA-Q-2026-00002';
  await db.collection('submissions').doc(older).create({ reference: older, kind: 'PFA-Q', threadId: 'cccccccccccc', createdAt: '2026-10-07T05:00:00.000Z' });
  await store.queueEmail({ template: 'submission_forward', to: INBOX, payload: { reference: older, threadId: 'cccccccccccc' }, dedupeKey: `submission_forward:${older}:${INBOX}` });
  /* and one copied under the new key */
  const record = { reference: 'PFA-Q-2026-00003', threadId: 'dddddddddddd' };
  await db.collection('submissions').doc(record.reference).create(Object.assign({ kind: 'PFA-Q', createdAt: '2026-10-08T06:00:00.000Z' }, record));
  await store.queueEmail({ template: 'submission_forward', to: INBOX, payload: record, dedupeKey: FORWARD.forwardKey(record, INBOX) });
  missed = await missedSubmissions(db, [INBOX]);
  assert.deepEqual(missed.map((m) => m.reference), [ref]);
});

test('C1 the forward key carries the thread, and a record with none keeps the old key', () => {
  assert.equal(FORWARD.forwardKey({ reference: 'PFA-Q-2026-00001', threadId: 'abcdefabcdef' }, 'Gandhim@Exmpls.Sansad.in'), 'submission_forward:PFA-Q-2026-00001:abcdefabcdef:gandhim@exmpls.sansad.in');
  assert.equal(FORWARD.forwardKey({ reference: 'PFA-Q-2026-00001' }, INBOX), `submission_forward:PFA-Q-2026-00001:${INBOX}`);
});

test('C1 the provider\'s Idempotency-Key tells two submissions under one number apart', () => {
  const a = mailer.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00001', threadId: 'aaaaaaaaaaaa' });
  const b = mailer.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00001', threadId: 'bbbbbbbbbbbb' });
  assert.notEqual(a, b, 'a reused reference would be swallowed by the provider for a day');
  assert.equal(mailer.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00001' }), mailer.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00001' }));
});

test('C1 a confirmation is queued under exactly the key it is given (guard)', async () => {
  const mail = { isConfigured: () => true, smtpConfigured: () => true, deliver: (m) => mailer.deliver(m) };
  const payload = (threadId) => ({ kind: 'PFA-Q', name: 'Asha', reference: 'PFA-Q-2026-00001', threadId, receivedAt: new Date().toISOString() });
  const one = await CONFIRM.send({ to: 'asha@example.com', template: 'submission_received', payload: payload('aaaaaaaaaaaa'), dedupeKey: 'submission_received:PFA-Q-2026-00001:aaaaaaaaaaaa', mail, queue: store });
  const two = await CONFIRM.send({ to: 'asha@example.com', template: 'submission_received', payload: payload('bbbbbbbbbbbb'), dedupeKey: 'submission_received:PFA-Q-2026-00001:bbbbbbbbbbbb', mail, queue: store });
  const again = await CONFIRM.send({ to: 'asha@example.com', template: 'submission_received', payload: payload('bbbbbbbbbbbb'), dedupeKey: 'submission_received:PFA-Q-2026-00001:bbbbbbbbbbbb', mail, queue: store });
  assert.deepEqual([one.state, two.state, again.state], ['sent', 'sent', 'sent']);
  assert.equal(again.duplicate, true);
  assert.equal(smtp.length, 2, 'one email per key, the repeat sends nothing');
  assert.ok(db.dump()[`caregiverEmails/${store.emailIdFor('submission_received', 'submission_received:PFA-Q-2026-00001:bbbbbbbbbbbb')}`]);
});
