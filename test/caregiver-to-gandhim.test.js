'use strict';

/* Every colony caregiver application reaches gandhim.

   Owner, 23 Oct 2026: "hope all caregiver application goes to gandhim,
   ensure it does. payment receipt to go to others. but application should
   go to gandhim email ID pls."

   From 21 to 23 Oct 2026 an application was a record of money and went only
   to the payments inboxes. Those applications never reached gandhim. The
   panel's list of submissions with a missing copy now finds them, and one
   press sends each one to gandhim, as the application (with its
   photograph, without the payment); the payments inboxes, which already
   had theirs, are sent nothing again. An application from before 21 Oct
   went to gandhim then, and is left alone.

   The live path, through CCAvenue's callback, is in test/email-thread.test.js
   and test/submissions-end-to-end.test.js; the rule in
   test/payment-inbox.test.js. */

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
const FORWARD = require('../lib/submission-forward');

const GANDHIM = 'gandhim@exmpls.sansad.in';
const PAY = ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'];
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PUBLIC_SITE_URL', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES', 'PFA_SENT_COPY'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  /* no Sent folder here: nothing to reach */
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test', PFA_SENT_COPY: 'off' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = [];
  mailer._setSmtpTransport(() => ({
    async sendMail(message) { smtp.push(message); return { messageId: message.messageId }; },
    close() {}
  }));
  mailer._setAttachmentLoader(async (reference, count) => Array.from({ length: Number(count) || 0 }, (_, i) => ({
    n: i + 1, label: 'photograph', contentType: 'image/jpeg', bytes: Buffer.from('jpeg-bytes-' + reference)
  })));
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  mailer._setAttachmentLoader(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api/admin/mail-check', query, body, headers: { host: 'pfa.test', 'content-type': 'application/json', authorization: 'Bearer test-admin', 'x-forwarded-for': '203.0.113.9' } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
const check = (method, body) => call(require('../lib/routes/admin/mail-check.js'), { method, body });

function application(reference, threadId, createdAt) {
  return {
    reference, kind: 'PFA-CG', kindLabel: 'Colony caregiver application', threadId, createdAt, receivedAtMs: Date.parse(createdAt),
    status: 'new', attachments: 1, page: 'get-involved.html',
    fields: { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road', city: 'New Delhi', district: 'New Delhi', state: 'Delhi', pin: '110024', title: 'Colony caregiver card application', notes: 'About 12 animals.' },
    payment: { orderId: 'PFA-CG-ORDER-' + threadId.slice(0, 4), amount: '50.00', currency: 'INR', trackingId: '114907823013', bankReference: 'BNK900' }
  };
}

/* a copy that went, as the queue keeps it */
async function wentTo(record, to, key) {
  const q = await store.queueEmail({ template: 'submission_forward', to, payload: FORWARD.payloadFor(record, ''), dedupeKey: key || FORWARD.forwardKey(record, to), claim: 'immediate' });
  await store.recordEmailResult({ emailId: q.emailId, claimToken: q.claimToken, ok: true });
}

test('an application that went only to the payments inboxes is found, and one press sends it to gandhim, and only to gandhim', async () => {
  /* 22 Oct: copied to the pair, as the rule then said */
  const between = application('PFA-CG-2026-00012', 'aaaaaaaaaaaa', '2026-10-22T09:00:00.000Z');
  await db.collection('submissions').doc(between.reference).create(between);
  for (const to of PAY) await wentTo(between, to);
  /* 18 Oct: copied to gandhim, as the rule then said */
  const before = application('PFA-CG-2026-00007', 'bbbbbbbbbbbb', '2026-10-18T09:00:00.000Z');
  await db.collection('submissions').doc(before.reference).create(before);
  await wentTo(before, GANDHIM);
  /* 23 Oct, after this release: all three copies */
  const after = application('PFA-CG-2026-00013', 'cccccccccccc', '2026-10-23T09:00:00.000Z');
  await db.collection('submissions').doc(after.reference).create(after);
  for (const to of [GANDHIM, ...PAY]) await wentTo(after, to);

  const seen = await check('GET');
  assert.equal(seen.statusCode, 200, seen.raw.slice(0, 300));
  assert.deepEqual(seen.json.missed.map((m) => m.reference), [between.reference], 'only the one gandhim never had');

  const go = await check('POST', { action: 'send-missed' });
  assert.equal(go.json.ok, true, JSON.stringify(go.json));
  assert.equal(go.json.sent, 1);
  assert.deepEqual(smtp.map((m) => m.to), [GANDHIM], 'gandhim, and nobody else: the pair had their copy');
  const copy = smtp[0];
  assert.equal(copy.subject, `${between.reference}: Colony caregiver application from Asha Rao`);
  assert.equal(copy.attachments.length, 1, 'with the photograph');
  assert.match(copy.text, /16 MG Road/);
  assert.doesNotMatch(copy.text + copy.html, /Amount paid|PFA-CG-ORDER|114907823013|BNK900|Bank reference|tracking ID/, 'without the payment');

  const again = await check('GET');
  assert.deepEqual(again.json.missed, [], 'no longer listed');
  const twice = await check('POST', { action: 'send-missed' });
  assert.equal(twice.json.tried, 0, 'pressing again sends nothing twice');
  assert.equal(smtp.length, 1);
});

test('an application copy to gandhim that the old rule refused can be sent again, and goes', async () => {
  /* queued for gandhim before 21 Oct, still retrying on 21 Oct, refused by
     the rule then: it was parked as a record of money. It is the
     application, so it shows as not gone, and Send again sends it. */
  const record = application('PFA-CG-2026-00009', 'dddddddddddd', '2026-10-20T09:00:00.000Z');
  await db.collection('submissions').doc(record.reference).create(record);
  const q = await store.queueEmail({ template: 'submission_forward', to: GANDHIM, payload: FORWARD.payloadFor(record, ''), dedupeKey: FORWARD.forwardKey(record, GANDHIM), claim: 'immediate' });
  await store.recordEmailResult({ emailId: q.emailId, claimToken: q.claimToken, ok: false, kind: 'recipient', permanent: true, error: 'A record of money is not sent to this inbox. It goes to the payments inboxes (PFA_PAYMENTS_INBOX).' });

  const seen = await check('GET');
  const row = (seen.json.failing || []).find((r) => r.reference === record.reference);
  assert.ok(row, 'listed as not gone, no longer hidden as superseded');
  assert.equal(row.to, GANDHIM);
  const go = await check('POST', { action: 'resend' });
  assert.equal(go.statusCode, 200, go.raw.slice(0, 300));
  assert.deepEqual(smtp.map((m) => m.to), [GANDHIM], JSON.stringify(go.json));
  assert.doesNotMatch(smtp[0].text, /Amount paid|PFA-CG-ORDER|BNK900/);
});

test('a receipt queued for gandhim by mistake is still refused, and not offered again', async () => {
  const record = application('PFA-CG-2026-00014', 'eeeeeeeeeeee', '2026-10-23T10:00:00.000Z');
  const payload = FORWARD.copyPayload(record, '', 'payment');
  await assert.rejects(mailer.deliver({ to: GANDHIM, template: 'submission_forward', payload }), (e) => e.code === 'MONEY_NOT_FOR_THIS_INBOX');
  assert.equal(smtp.length, 0);
  assert.equal(mailer.moneyToWrongInbox(GANDHIM, 'submission_forward', payload), true, 'so the panel treats it as superseded, not failing');
});

test('a membership and a volunteer application kept in the panel only (21 to 23 Oct) are found, and one press sends them to gandhim', async () => {
  /* owner, 23 Oct 2026: "ensure all caregiver and volunteer and job and
     membership applications go to gandhim email id" */
  const member = {
    reference: 'PFA-MEM-2026-00004', kind: 'PFA-MEM', kindLabel: 'Membership', threadId: 'ffffffffffff',
    createdAt: '2026-10-22T09:00:00.000Z', receivedAtMs: Date.parse('2026-10-22T09:00:00.000Z'), status: 'new', page: 'get-involved.html',
    fields: { name: 'Rashid', mobile: '9876500000', email: 'rashid@example.com', tier: 'Annual member', kit: '', address: '2 Park St', city: 'Kolkata', district: '', state: 'West Bengal', pin: '700016',
      amount: 1000, orderId: 'PFA-MEM-Q7ANEQLZ', bankReference: '901132268778', title: 'Annual member - Rashid' }
  };
  const volunteer = {
    reference: 'PFA-V-2026-00021', kind: 'PFA-V', kindLabel: 'Volunteer application', threadId: '111111111111',
    createdAt: '2026-10-22T10:00:00.000Z', receivedAtMs: Date.parse('2026-10-22T10:00:00.000Z'), status: 'new', page: 'get-involved.html',
    fields: { name: 'Meera', mobile: '9876511111', email: 'meera@example.com', city: 'Udupi', title: 'Volunteer: Feeding drives', notes: 'Weekends.' }
  };
  for (const r of [member, volunteer]) await db.collection('submissions').doc(r.reference).create(r);

  const seen = await check('GET');
  assert.deepEqual(seen.json.missed.map((m) => m.reference).sort(), [member.reference, volunteer.reference].sort());
  const go = await check('POST', { action: 'send-missed' });
  assert.equal(go.json.ok, true, JSON.stringify(go.json));
  assert.equal(go.json.sent, 2);

  const to = (address) => smtp.filter((m) => m.to === address);
  assert.deepEqual(to(GANDHIM).map((m) => m.subject).sort(), [
    `${member.reference}: Membership from Rashid`,
    `${volunteer.reference}: Volunteer application from Meera`
  ].sort());
  const application = to(GANDHIM).find((m) => m.subject.startsWith(member.reference));
  assert.match(application.text, /Annual member/);
  assert.doesNotMatch(application.text + application.html, /Amount|PFA-MEM-Q7ANEQLZ|901132268778|Bank reference|₹/, 'no payment in it');
  for (const address of PAY) {
    assert.deepEqual(to(address).map((m) => m.subject), [`${member.reference}: Payment for a membership from Rashid`], `${address}: the receipt, and not the volunteer`);
    assert.match(to(address)[0].text, /Amount paid: ₹1,000/);
  }
  assert.deepEqual((await check('GET')).json.missed, [], 'no longer listed');
});
