'use strict';

/* What a failed send means (8 Oct 2026, review C items 2 and 5).

   Item 2: a wrong mailbox password (535) was treated as the person's bad
   address. The page said "check that the address is right", every row was
   parked after six tries, the panel showed only copies to the inbox and
   could resend only those, so once the password was mended nothing sent the
   confirmations, receipts and relayed replies.

   Item 5: a timeout after the whole message had been handed to GoDaddy's
   server was "failed over" to Titan's, which sent the same email again. */

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
const { PLACE } = require('./_place');

const INBOX = 'gandhim@exmpls.sansad.in';
const PERSON = 'asha.rao@example.com';
const HOST1 = 'smtpout.secureserver.net';
const HOST2 = 'smtp.titan.email';
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_ADMIN_TOKEN', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES'];
const saved = {};
let db;
let smtp;
let behave;

const AUTH = () => Object.assign(new Error('Invalid login: 535 5.7.8 Error: authentication failed'), { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN', response: '535 5.7.8 Error: authentication failed' });

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = { sent: [], hosts: [] };
  behave = null;
  mailer._setSmtpTransport((options) => ({
    async sendMail(message) {
      smtp.hosts.push(options.host);
      if (behave) await behave(options.host, message);
      smtp.sent.push(Object.assign({ host: options.host }, message));
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

const quietly = async (fn) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; } };
const ask = { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON };
const submit = () => quietly(() => call(require('../lib/routes/pfa-submissions'), { body: { kind: 'PFA-Q', data: ask, page: 'ask.html', clientRequestId: 'req-' + Math.random() } }));
const worker = () => quietly(() => call(require('../lib/routes/caregiver/email-worker'), { headers: { authorization: 'Bearer cron-secret' } }));
const check = (method, body) => quietly(() => call(require('../lib/routes/admin/mail-check'), { method, body, headers: { authorization: 'Bearer test-admin' } }));
const rows = () => Object.entries(db.dump()).filter(([k]) => /^caregiverEmails\/[^/]+$/.test(k)).map(([k, v]) => Object.assign({ id: k.split('/')[1] }, v));
const row = (template) => rows().find((r) => r.template === template);
/* time passing, without a clock: every row is made due now */
/* Time passing: every row due, and the mailbox's login gate open again
   (lib/caregiver-store.js loginGate, 8 Oct 2026). */
const allDue = async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  for (const r of rows()) await db.collection('caregiverEmails').doc(r.id).set({ nextAttemptAt: past, leaseUntil: past }, { merge: true });
  const gate = await db.collection('mailHealth').doc('login').get();
  if (gate.exists) await db.collection('mailHealth').doc('login').set({ nextTryAt: past }, { merge: true });
};
const to = (address) => smtp.sent.filter((m) => m.to === address);

test('C2 a refused login (535) does not tell the person to check their address, is not counted, and stays retryable', async () => {
  behave = async () => { throw AUTH(); };
  const res = await submit();
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.confirmation.state, 'queued', 'the email waits for the password to be mended');
  assert.doesNotMatch(res.json.confirmation.lines.join(' '), /check that the address/i, 'the person is not blamed for the site\'s password');
  for (const template of ['submission_received', 'submission_forward']) {
    const r = row(template);
    assert.equal(r.status, 'retry', template);
    assert.equal(r.attempts, 0, `${template}: a refused login is not an attempt at this email`);
    assert.equal(r.lastErrorKind, 'config');
  }
});

test('C2 the page names the address as the problem only when the receiving server refused it', () => {
  const plain = CONFIRM.notice({ state: 'unsent', to: 'asha@exmaple.com' });
  assert.match(plain.lines[0], /asha@exmaple\.com/, 'the address is still shown, so a typo can be seen');
  assert.doesNotMatch(plain.lines[0], /check that the address/i);
  const refused = CONFIRM.notice({ state: 'unsent', to: 'asha@exmaple.com', reason: 'RECIPIENT_REFUSED' });
  assert.match(refused.lines[0], /Check that the address is right/);
});

test('C2 the worker never parks an email for a refused login, and sends it once the password is mended', async () => {
  behave = async () => { throw AUTH(); };
  await submit();
  for (let run = 0; run < 8; run += 1) {   // four days of two runs a day
    await allDue();
    const out = await worker();
    assert.equal(out.statusCode, 200);
  }
  for (const r of rows()) {
    assert.equal(r.status, 'retry', `${r.template} was parked for the site's own password`);
    assert.equal(r.attempts, 0);
  }
  behave = null;
  await allDue();
  const out = await worker();
  assert.equal(out.json.sent, 2, JSON.stringify(out.json));
  assert.equal(to(PERSON).length, 1, 'the confirmation reached the person');
  assert.equal(to(INBOX).length, 1, 'the copy reached the inbox');
});

test('C2 an address the receiving server refuses for good (550 at RCPT TO) is parked at once', async () => {
  behave = async () => { throw Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 5.1.1 <nobody@example.com>: Recipient address rejected'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', response: '550 5.1.1 <nobody@example.com>: Recipient address rejected' }); };
  await store.queueEmail({ template: 'inbox_test', to: 'nobody@example.com', payload: { at: new Date().toISOString() }, dedupeKey: 'park-1' });
  await allDue();
  const out = await worker();
  assert.equal(out.json.failed, 1, JSON.stringify(out.json));
  const r = row('inbox_test');
  assert.equal(r.status, 'failed', 'not retried six times against an address that will never accept it');
  assert.equal(r.attempts, 1);
  assert.equal(r.lastErrorKind, 'recipient');
});

test('C2 the panel lists emails of every template that did not go, and Resend sends any one of them, or all', async () => {
  const at = new Date().toISOString();
  const make = async (template, address, payload, status) => {
    const q = await store.queueEmail({ template, to: address, payload, dedupeKey: `${template}:x` });
    await db.collection('caregiverEmails').doc(q.emailId).set({ status, attempts: status === 'failed' ? 6 : 2, lastError: 'Mailbox server refused: Invalid login: 535 Authentication failed', lastErrorAt: at, nextAttemptAt: at }, { merge: true });
    return q.emailId;
  };
  const confirmation = await make('submission_received', PERSON, { kind: 'PFA-Q', name: 'Asha Rao', reference: 'PFA-Q-2026-00001', receivedAt: at }, 'failed');
  const receipt = await make('payment_received', 'donor@example.com', { name: 'Ravi', orderId: 'PFA-DON-1', amount: 500, paidAt: at }, 'retry');
  const relay = await make('submission_followup', INBOX, { reference: 'PFA-Q-2026-00001', kindLabel: 'Help desk query', email: PERSON, text: 'More detail', n: 1 }, 'failed');
  const copy = await make('submission_forward', INBOX, { reference: 'PFA-Q-2026-00001', kindLabel: 'Help desk query', name: 'Asha Rao', email: PERSON }, 'failed');

  const seen = await check('GET');
  assert.equal(seen.statusCode, 200);
  const listed = seen.json.failing.map((r) => r.id).sort();
  assert.deepEqual(listed, [confirmation, receipt, relay, copy].sort(), 'every template is shown, not only the copies to the inbox');
  assert.equal(seen.json.failing.find((r) => r.id === confirmation).what, 'Confirmation to the sender');
  assert.equal(seen.json.failing.find((r) => r.id === receipt).what, 'Donation receipt');

  const one = await check('POST', { action: 'resend', id: confirmation });
  assert.equal(one.json.sent, 1, JSON.stringify(one.json));
  assert.equal(to(PERSON).length, 1, 'the confirmation went');
  assert.equal(smtp.sent.length, 1, 'and nothing else');
  assert.equal(db.dump()[`caregiverEmails/${confirmation}`].status, 'sent');

  const rest = await check('POST', { action: 'resend' });
  assert.equal(rest.json.sent, 3, JSON.stringify(rest.json));
  assert.deepEqual(rows().map((r) => r.status), ['sent', 'sent', 'sent', 'sent']);
  const again = await check('POST', { action: 'resend', id: confirmation });
  assert.equal(again.json.sent, 0, 'an email already sent is never sent again');
  assert.equal(smtp.sent.length, 4);
});

test('C2 the mail check says plainly when the mailbox refuses the login, and stops saying it once mail goes', async () => {
  behave = async () => { throw AUTH(); };
  await submit();
  const seen = await check('GET');
  assert.equal(seen.json.state, 'login-failing');
  assert.equal(seen.json.login.failing, true);
  assert.match(seen.json.login.problem, /did not accept the mailbox and password/);
  assert.equal(seen.json.login.waiting, 2, 'the confirmation and the copy wait for it');

  behave = null;
  const sent = await check('POST', { action: 'resend' });
  assert.equal(sent.json.sent, 2, JSON.stringify(sent.json));
  const after = await check('GET');
  assert.equal(after.json.state, 'ok');
  assert.equal(after.json.login.failing, false);
});

test('C5 a timeout after the message was handed over is not sent again through the second server', async () => {
  behave = async (host) => {
    if (host === HOST1) {
      smtp.sent.push({ host, note: 'taken by the server; its 250 never came back' });
      /* what nodemailer reports for a socket gone quiet at any point */
      throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' });
    }
  };
  await assert.rejects(mailer.deliver({ to: INBOX, template: 'inbox_test', payload: { at: new Date().toISOString() } }), (error) => {
    assert.equal(error.uncertain, true);
    assert.equal(error.kind, 'unknown');
    assert.match(error.message, /outcome not known/);
    return true;
  });
  assert.deepEqual(smtp.hosts, [HOST1], 'the second server was not asked to send it again');
});

test('C5 a server that could not be reached is still failed over (guard)', async () => {
  const cases = [
    { code: 'ESOCKET', syscall: 'connect', message: 'connect ECONNREFUSED 203.0.113.5:465', command: 'CONN' },
    { code: 'ETIMEDOUT', message: 'Connection timeout', command: 'CONN' },
    { code: 'ETIMEDOUT', message: 'Greeting never received', command: 'CONN' },
    { code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtpout.secureserver.net', command: 'CONN' }
  ];
  for (const failure of cases) {
    smtp.hosts.length = 0;
    behave = async (host) => { if (host === HOST1) throw Object.assign(new Error(failure.message), failure); };
    const out = await mailer.deliver({ to: INBOX, template: 'inbox_test', payload: { at: new Date().toISOString() } });
    assert.ok(out.messageId, failure.message);
    assert.deepEqual(smtp.hosts, [HOST1, HOST2], failure.message);
  }
  assert.equal(mailer.smtpPhase(Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'CONN' })), 'unknown');
  assert.equal(mailer.smtpPhase(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' })), 'unknown');
});

test('C5 a form send whose outcome is not known is marked for the panel, and sent again only after its lease runs out', async () => {
  behave = async (host, message) => {
    if (host === HOST1 && message.to === INBOX) {
      smtp.sent.push({ host, to: INBOX, note: 'taken; no answer' });
      throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' });
    }
  };
  const res = await submit();
  assert.equal(res.statusCode, 200);
  assert.equal(to(INBOX).length, 1, 'one handover, not a second through Titan');
  const r = row('submission_forward');
  assert.equal(r.status, 'sending', 'held: not sent again while it may have gone');
  assert.equal(r.uncertain, true);
  assert.equal(r.attempts, 1);

  behave = null;
  const early = await worker();
  assert.equal(early.json.sent, 0, JSON.stringify(early.json));
  const resend = await check('POST', { action: 'resend' });
  assert.equal(resend.json.sent, 0, 'Resend leaves it alone too while its lease runs');
  assert.equal(to(INBOX).length, 1);

  const seen = await check('GET');
  const listed = seen.json.failing.find((x) => x.template === 'submission_forward');
  assert.ok(listed && listed.uncertain, 'the panel can show it may have gone');
  assert.match(listed.problem, /may already have arrived/);

  await allDue();   // the lease has run out
  const later = await worker();
  assert.equal(later.json.sent, 1, JSON.stringify(later.json));
  assert.equal(to(INBOX).length, 2, 'sent again once, after the lease: a possible duplicate, never a certain one');
  assert.equal(row('submission_forward').status, 'sent');
});
