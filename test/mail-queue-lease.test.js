'use strict';

/* The outbound queue's lease (8 Oct 2026, review C item 4).

   The site runs on Vercel and Firebase over one Firestore, so two workers,
   a worker and the panel's Resend, Resend pressed twice, or Resend while a
   form is still sending can all reach the same row at once. Picking a row
   did not mark it, so each of them sent it. Now a row is claimed in a
   transaction (status 'sending', leaseUntil, the claimer) before anything
   sends it. The database here makes every read and commit wait 3 ms, so
   requests fired together really do overlap. */

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
const store = require('../lib/caregiver-store');

const INBOX = 'gandhim@exmpls.sansad.in';
const PERSON = 'asha.rao@example.com';
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_ADMIN_TOKEN', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES'];
const saved = {};
let db;
let smtp;
let gate;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret' });
  db = memoryFirestore({ latency: 3 });
  firebase._setDbForTests(db);
  smtp = [];
  gate = null;
  mailer._setSmtpTransport(() => ({
    async sendMail(message) {
      if (gate) await gate(message);
      await new Promise((r) => setTimeout(r, 30));   // a real server takes a moment
      smtp.push(message);
      return { messageId: message.messageId };
    },
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

const worker = () => call(require('../lib/routes/caregiver/email-worker'), { headers: { authorization: 'Bearer cron-secret' } });
const resend = (body) => call(require('../lib/routes/admin/mail-check'), { body: Object.assign({ action: 'resend' }, body || {}), headers: { authorization: 'Bearer test-admin' } });
const { PLACE } = require('./_place');
const rows = () => Object.entries(db.dump()).filter(([k]) => /^caregiverEmails\/[^/]+$/.test(k)).map(([k, v]) => Object.assign({ id: k.split('/')[1] }, v));
const past = () => new Date(Date.now() - 1000).toISOString();
const sentTo = (address) => smtp.filter((m) => m.to === address).length;
const perMessage = () => smtp.reduce((m, x) => Object.assign(m, { [`${x.to}|${x.subject}`]: (m[`${x.to}|${x.subject}`] || 0) + 1 }), {});

async function queueDue(n, status) {
  for (let i = 1; i <= n; i += 1) {
    const q = await store.queueEmail({ template: 'inbox_test', to: `person${i}@example.com`, payload: { at: new Date().toISOString(), by: `run ${i}` }, dedupeKey: `lease-${i}` });
    await db.collection('caregiverEmails').doc(q.emailId).set({ status: status || 'queued', nextAttemptAt: past() }, { merge: true });
  }
}

test('C4 two workers at once send each queued email exactly once', async () => {
  await queueDue(3);
  const [a, b] = await Promise.all([worker(), worker()]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(smtp.length, 3, `${smtp.length} sends for 3 emails: ${JSON.stringify([a.json, b.json])}`);
  for (const [key, n] of Object.entries(perMessage())) assert.equal(n, 1, key);
  assert.equal(a.json.sent + b.json.sent, 3);
  assert.ok(rows().every((r) => r.status === 'sent' && r.attempts === 1));
});

test('C4 Resend pressed twice at once sends each email once', async () => {
  for (let i = 1; i <= 3; i += 1) {
    const q = await store.queueEmail({ template: 'submission_forward', to: INBOX, payload: { reference: `PFA-Q-2026-0000${i}`, kindLabel: 'Help desk query', name: 'Asha Rao', email: PERSON }, dedupeKey: `submission_forward:PFA-Q-2026-0000${i}:${INBOX}` });
    await db.collection('caregiverEmails').doc(q.emailId).set({ status: 'failed', attempts: 6, nextAttemptAt: past(), lastError: 'Mailbox server refused: Invalid login: 535' }, { merge: true });
  }
  const [a, b] = await Promise.all([resend(), resend()]);
  assert.equal(smtp.length, 3, `${smtp.length} sends for 3 copies: ${JSON.stringify([a.json, b.json])}`);
  for (const [key, n] of Object.entries(perMessage())) assert.equal(n, 1, key);
  assert.equal(a.json.sent + b.json.sent, 3);
});

test('C4 Resend leaves alone a copy the form is still sending', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let first = true;
  gate = async (message) => { if (message.to === INBOX && first) { first = false; await held; } };
  const ask = { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON };
  const pending = call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-Q', data: ask, page: 'ask.html', clientRequestId: 'req-1' } });
  await new Promise((r) => setTimeout(r, 150));   // the form is mid-send
  const pressed = await resend();
  release();
  const res = await pending;
  assert.equal(res.statusCode, 200);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sentTo(INBOX), 1, `the copy went ${sentTo(INBOX)} times; Resend said ${JSON.stringify(pressed.json)}`);
  assert.equal(sentTo(PERSON), 1);
});

test('C4 a row sent and queued by an older route is not raced by the worker inside its head start', async () => {
  /* the routes that queue and then send at once without a claim
     (card issued, shipments) get HEAD_START_MS before anything else may */
  await store.queueEmail({ template: 'inbox_test', to: PERSON, payload: { at: new Date().toISOString() }, dedupeKey: 'route-1' });
  const out = await worker();
  assert.equal(out.statusCode, 200);
  assert.equal(smtp.length, 0, 'the worker sent an email its route was about to send');
  assert.equal(rows()[0].status, 'queued');
});

test('C4 a claim is exclusive while its lease runs, anyone\'s once it runs out, and a stale claimer cannot undo the new one', async () => {
  await queueDue(1);
  const id = rows()[0].id;
  const [x, y] = await Promise.all([store.claimEmail(id, { by: 'a' }), store.claimEmail(id, { by: 'b' })]);
  assert.equal([x, y].filter(Boolean).length, 1, 'two claims at once: one wins');
  const winner = x || y;
  assert.equal(rows()[0].status, 'sending');
  assert.equal(await store.claimEmail(id, { by: 'c', includeFailed: true, ignoreSchedule: true }), null, 'not even Resend takes a live lease');

  await db.collection('caregiverEmails').doc(id).set({ leaseUntil: past() }, { merge: true });   // the first sender died
  const second = await store.claimEmail(id, { by: 'd' });
  assert.ok(second, 'a lease that ran out is claimable again');
  const late = await store.recordEmailResult({ emailId: id, claimToken: winner.claimToken, ok: false, error: 'socket hang up' });
  assert.equal(late.ignored, true, 'the stale claimer\'s failure does not overwrite the new claim');
  assert.equal(rows()[0].claimToken, second.claimToken);
  await store.recordEmailResult({ emailId: id, claimToken: second.claimToken, ok: true, providerId: 'p' });
  assert.equal(rows()[0].status, 'sent');
  assert.equal(rows()[0].attempts, 1);
  assert.equal(await store.claimEmail(id, { by: 'e', includeFailed: true, ignoreSchedule: true }), null, 'a sent email is never claimed again');
});
