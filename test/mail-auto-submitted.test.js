'use strict';

/* Every email the site writes by itself says so with Auto-Submitted:
   auto-generated (RFC 3834), so out-of-office replies and autoresponders do
   not answer it and the reading of replies can tell them from people. A
   reply a member of staff typed in the panel is a person writing and
   carries nothing (8 Oct 2026, review C item 7, outbound part). */

const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', displayName: 'Priya', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const { PLACE } = require('./_place');

const INBOX = 'gandhim@exmpls.sansad.in';
const PERSON = 'asha.rao@example.com';
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES'];
const saved = {};
const realFetch = global.fetch;
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
  global.fetch = realFetch;
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

const header = (m) => (m.headers || {})['Auto-Submitted'];
const at = new Date().toISOString();
const AUTOMATIC = {
  submission_received: { kind: 'PFA-Q', name: 'Asha Rao', reference: 'PFA-Q-2026-00001', receivedAt: at },
  submission_forward: { reference: 'PFA-Q-2026-00001', kindLabel: 'Help desk query', name: 'Asha Rao', email: PERSON },
  submission_followup: { reference: 'PFA-Q-2026-00001', kindLabel: 'Help desk query', email: PERSON, text: 'More detail', n: 1 },
  payment_received: { name: 'Ravi', orderId: 'PFA-DON-1', amount: 500, paidAt: at },
  membership_welcome: { name: 'Ravi', memberId: 'PFA-MEM-2026-00001', orderId: 'PFA-MEM-X', amount: 2500, paidAt: at },
  caregiver_application_received: { name: 'Ravi', applicationRef: 'PFA-CG-2026-00001', orderId: 'PFA-CGA-X', amount: 50, paidAt: at },
  shop_order_confirmed: { name: 'Ravi', orderId: 'PFA-SHP-1', total: 900, items: [], delivery: {}, paidAt: at },
  card_issued: { name: 'Ravi', cardId: 'PFA-CCT-1', issuedAt: at, validUntil: at, cardUrl: 'https://pfa.test/c' },
  inbox_test: { at },
  staff_invite: { name: 'Priya', link: 'https://pfa.test/set', adminUrl: 'https://pfa.test/admin.html' }
};

test('C7 every automatic email carries Auto-Submitted: auto-generated; a reply typed by staff does not', async () => {
  for (const [template, payload] of Object.entries(AUTOMATIC)) {
    smtp.length = 0;
    await mailer.deliver({ to: INBOX, template, payload });
    assert.equal(header(smtp[0]), 'auto-generated', template);
  }
  smtp.length = 0;
  await mailer.deliver({ to: PERSON, template: 'submission_reply', payload: { reference: 'PFA-Q-2026-00001', name: 'Asha Rao', text: 'There is a vet at Lajpat Nagar.' } });
  assert.equal(header(smtp[0]), undefined, 'a person wrote this one');
});

test('C7 through Resend too, beside the threading headers', async () => {
  delete process.env.PFA_SMTP_USER;
  delete process.env.PFA_SMTP_PASS;
  process.env.PFA_MAIL_API_KEY = 'test-key';
  process.env.PFA_MAIL_ENDPOINT = 'https://mail.test/emails';
  const bodies = [];
  global.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'r1' }), { status: 200 }); };
  await mailer.deliver({ to: PERSON, template: 'submission_received', payload: Object.assign({ threadId: 'abcdefabcdef' }, AUTOMATIC.submission_received) });
  await mailer.deliver({ to: PERSON, template: 'submission_reply', payload: { reference: 'PFA-Q-2026-00001', threadId: 'abcdefabcdef', name: 'Asha Rao', text: 'Hello.' } });
  assert.equal(bodies[0].headers['Auto-Submitted'], 'auto-generated');
  assert.match(bodies[0].headers['Message-ID'], /PFA-Q-2026-00001\.abcdefabcdef\.confirm@/);
  assert.equal((bodies[1].headers || {})['Auto-Submitted'], undefined);
});

test('C7 a form\'s confirmation and its copy to the inbox both say so, end to end', async () => {
  const ask = { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON };
  const res = await call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-Q', data: ask, page: 'ask.html', clientRequestId: 'req-auto' } });
  assert.equal(res.statusCode, 200);
  const confirmation = smtp.find((m) => m.to === PERSON);
  const copy = smtp.find((m) => m.to === INBOX);
  assert.equal(header(confirmation), 'auto-generated');
  assert.equal(header(copy), 'auto-generated');

  smtp.length = 0;
  const reply = await call(require('../lib/routes/admin/case'), { body: { reference: res.json.reference, action: 'reply', text: 'There is a vet at Lajpat Nagar.' }, headers: { authorization: 'Bearer test-admin' } });
  assert.equal(reply.statusCode, 200, reply.raw.slice(0, 300));
  const typed = smtp.find((m) => m.to === PERSON);
  assert.ok(typed, 'the staff reply went');
  assert.equal(header(typed), undefined, 'a reply typed in the panel is not automatic');
});
