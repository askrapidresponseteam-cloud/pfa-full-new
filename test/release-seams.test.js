'use strict';

/* The seams between the parts of the 8 Oct 2026 release (v1.407): the places
   where one part's change needed a matching change in another's file.

   - A bounce read from the mailbox marks the outbound queue row it belongs
     to, so the panel's mail check lists it and Resend can try it again.
   - A relayed reply carries the photographs it brought, read by their ids.
   - The relay says plainly when a file could not be kept.
   - Application stages are counted and filtered under the desk's four
     figures (a card issued is "approved", which is handled, not lost).
   - The page tells the person to check their address only when the
     receiving server refused it.
   - The routes that send their own email write the row already claimed.
   - The two servers can be compared without showing a secret. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USERS = {
  'tok-a': { uid: 'ua', email: 'a@pfa.test', claims: { admin: true, role: 'super' } }
};
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { const u = USERS[token]; if (!u) throw new Error('bad token'); return { uid: u.uid, email: u.email }; },
      async getUser(uid) { const u = Object.values(USERS).find((x) => x.uid === uid); return { uid, email: u.email, customClaims: u.claims }; }
    })
  }
};

const ROOT = path.join(__dirname, '..');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const store = require('../lib/caregiver-store');
const FILES = require('../lib/file-store');
const CONFIRM = require('../lib/confirmations');

const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PUBLIC_SITE_URL', 'PFA_AUTH_PEPPER', 'PFA_MAIL_API_KEY'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'x', PUBLIC_SITE_URL: 'https://pfa.test' });
  delete process.env.PFA_MAIL_API_KEY;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = { sent: [] };
  mailer._setSmtpTransport(() => ({ async sendMail(m) { smtp.sent.push(m); return { messageId: m.messageId }; }, close() {} }));
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  mailer._setAttachmentLoader(null);
  FILES._reset();
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'GET', body, query = {}, token = 'tok-a' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '', headers: {} };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; }, getHeader() {}, writeHead(c) { out.statusCode = c; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: { host: 'pfa.test', authorization: 'Bearer ' + token } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test('a bounce marks the queue row it answers, and the mail check lists it for Resend', async () => {
  const queued = await store.queueEmail({ template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', dedupeKey: 'submission_forward:PFA-Q-2026-00001:t1:gandhim', payload: { reference: 'PFA-Q-2026-00001' }, claim: 'immediate' });
  await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: '<PFA-Q-2026-00001.t1.forward@peopleforanimalsindia.org>' });

  const out = await store.markBounced({ reference: 'PFA-Q-2026-00001', messageId: 'PFA-Q-2026-00001.t1.forward@peopleforanimalsindia.org', to: 'gandhim@exmpls.sansad.in', reason: '552 Mailbox full', at: '2026-10-08T06:00:00.000Z' });
  assert.equal(out.marked, 1);
  const row = db.dump()[`caregiverEmails/${queued.emailId}`];
  assert.equal(row.status, 'failed');
  assert.equal(row.bounced, true);
  assert.match(row.lastError, /Mailbox full/);

  const again = await store.markBounced({ reference: 'PFA-Q-2026-00001', messageId: '<PFA-Q-2026-00001.t1.forward@peopleforanimalsindia.org>', reason: 'second report' });
  assert.equal(again.marked, 0, 'a second report of the same bounce changes nothing');

  const { failingEmails } = require('../lib/routes/admin/mail-check')._private;
  const listed = (await failingEmails(db)).find((r) => r.id === queued.emailId);
  assert.ok(listed && listed.bounced && listed.canResend, 'the panel shows it, and can send it again');
});

test('a bounce for someone else\'s message, or another reference, marks nothing', async () => {
  const queued = await store.queueEmail({ template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', dedupeKey: 'k2', payload: { reference: 'PFA-Q-2026-00002' }, claim: 'immediate' });
  await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: '<m2@peopleforanimalsindia.org>' });
  assert.equal((await store.markBounced({ messageId: '<other@x>' })).marked, 0);
  assert.equal((await store.markBounced({ reference: 'PFA-Q-2026-00009', messageId: '<m2@peopleforanimalsindia.org>' })).marked, 0);
  assert.equal(db.dump()[`caregiverEmails/${queued.emailId}`].status, 'sent');
});

test('a relayed reply carries the files it brought, read by their ids', async () => {
  const JPEG = fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg'));
  await db.collection('submissions').doc('PFA-Q-2026-00003').collection('attachments').doc('m1-1').set({ contentType: 'image/jpeg', size: JPEG.length, bytes: JPEG, filename: 'dog.jpg' });
  const files = await mailer.attachmentsFor('submission_followup', { reference: 'PFA-Q-2026-00003', attachments: 1, attachmentIds: ['m1-1'] });
  assert.equal(files.length, 1);
  assert.equal(Buffer.from(files[0].content, 'base64').length, JPEG.length);
  assert.deepEqual(await mailer.attachmentsFor('submission_followup', { reference: 'PFA-Q-2026-00003', attachments: 1 }), [], 'a relay without ids attaches nothing');
});

test('a file that cannot be read just now is tried again once, then the email goes without it', async () => {
  let tries = 0;
  const real = FILES.readStrict;
  FILES.readStrict = async () => { tries += 1; if (tries === 1) throw Object.assign(new Error('503'), { code: 'FILE_UNAVAILABLE' }); return Buffer.from('ok'); };
  try {
    await db.collection('submissions').doc('PFA-Q-2026-00004').collection('attachments').doc('1').set({ contentType: 'image/jpeg', size: 2, storage: 'gcs', bucket: 'b', path: 'p' });
    const files = await mailer.attachmentsFor('submission_forward', { reference: 'PFA-Q-2026-00004', attachments: 1 });
    assert.equal(tries, 2);
    assert.equal(files.length, 1, 'the second try found it');
    FILES.readStrict = async () => { throw Object.assign(new Error('503'), { code: 'FILE_UNAVAILABLE' }); };
    const original = console.warn; console.warn = () => {};
    try { assert.deepEqual(await mailer.attachmentsFor('submission_forward', { reference: 'PFA-Q-2026-00004', attachments: 1 }), []); } finally { console.warn = original; }
  } finally { FILES.readStrict = real; }
});

test('the relay says when a file could not be kept, and never counts it as in the panel', () => {
  const out = mailer.render('submission_followup', { reference: 'PFA-Q-2026-00005', kindLabel: 'Question', email: 'asha@example.com', name: 'Asha', text: 'See photo', attachments: 0, notKept: 1 });
  assert.match(out.text, /Could not be kept: 1 file/);
  assert.doesNotMatch(out.text, /Attachments:/);
  const two = mailer.render('submission_followup', { reference: 'PFA-Q-2026-00005', kindLabel: 'Question', email: 'asha@example.com', name: 'Asha', text: 'x', attachments: 2, attachedToEmail: 2, notKept: 0 });
  assert.match(two.text, /Attachments: 2 files, attached to this email/);
});

test('application stages count under the desk\'s four figures, and the register finds them there', async () => {
  const put = (ref, kind, status) => db.collection('submissions').doc(ref).set({ reference: ref, kind, status, receivedAtMs: Date.now(), createdAt: new Date().toISOString() });
  await put('PFA-CG-2026-00001', 'PFA-CG', 'approved');
  await put('PFA-CG-2026-00002', 'PFA-CG', 'under-review');
  await put('PFA-V-2026-00001', 'PFA-V', 'shortlisted');
  await put('PFA-Q-2026-00001', 'PFA-Q', 'handled');
  await put('PFA-Q-2026-00002', 'PFA-Q', 'new');

  const metrics = await call(require('../lib/routes/admin/metrics'), {});
  assert.equal(metrics.statusCode, 200, metrics.raw);
  const by = metrics.json.submissions.byStatus;
  assert.equal(by.handled, 2, 'a card issued is handled');
  assert.equal(by['in-progress'], 2, 'under review and shortlisted are in progress');
  assert.equal(by.new, 1);
  assert.equal(Object.values(by).reduce((a, b) => a + b, 0), 5, 'every record counted once');

  const handled = await call(require('../lib/routes/admin/records'), { query: { type: 'submissions', status: 'handled' } });
  assert.equal(handled.statusCode, 200, handled.raw);
  const refs = (handled.json.rows || handled.json.items || []).map((r) => r.reference).sort();
  assert.deepEqual(refs, ['PFA-CG-2026-00001', 'PFA-Q-2026-00001']);
  const row = (handled.json.rows || handled.json.items).find((r) => r.reference === 'PFA-CG-2026-00001');
  assert.equal(row.statusLabel, 'Card issued');
});

test('the page asks the person to check their address only when the receiving server refused it', () => {
  const refused = CONFIRM.notice({ state: 'unsent', to: 'asha@exmaple.com', number: 'Reference number', reference: 'PFA-Q-2026-00001', reason: 'RECIPIENT_REFUSED' });
  assert.match(refused.lines[0], /Check that the address is right/);
  const login = CONFIRM.notice({ state: 'unsent', to: 'asha@example.com', number: 'Reference number', reference: 'PFA-Q-2026-00001', reason: 'MAIL_LOGIN' });
  assert.doesNotMatch(login.lines[0], /Check that the address/);
  for (const file of ['lib/routes/pfa-submissions.js', 'lib/routes/payment/response.js', 'lib/routes/shop/response.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(src, /CONFIRM\.notice\(\{[^}]*reason:/, `${file} passes the reason on`);
  }
});

test('every route that sends its own email writes the row already claimed and records under the claim', () => {
  for (const file of ['lib/routes/admin/case.js', 'lib/routes/admin/cards.js', 'lib/routes/caregiver/admin-shipment.js', 'lib/routes/payment/response.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const queues = src.match(/queueEmail\(\{[\s\S]*?\}\);/g) || [];
    assert.ok(queues.length, `${file} queues an email`);
    for (const q of queues) assert.match(q, /claim:/, `${file}: ${q.slice(0, 80)}`);
    const results = src.match(/recordEmailResult\(\{[^}]*\}\)/g) || [];
    for (const r of results) assert.match(r, /claimToken/, `${file}: ${r}`);
  }
});

test('health lets the two servers be compared without showing the pepper', async () => {
  const health = require('../lib/routes/payment/health');
  FILES._setBucket(() => null);
  process.env.PFA_AUTH_PEPPER = 'a-long-random-secret-value';
  const a = await call(health, {});
  assert.match(a.json.pepper, /^[0-9a-f]{4}$/);
  assert.ok(!a.raw.includes('a-long-random-secret-value'), 'never the value');
  assert.equal(a.json.site, 'https://pfa.test');
  process.env.PFA_AUTH_PEPPER = 'a-different-secret';
  const b = await call(health, {});
  assert.notEqual(b.json.pepper, a.json.pepper);
  delete process.env.PFA_AUTH_PEPPER;
  assert.equal((await call(health, {})).json.pepper, 'none');
  const deploy = fs.readFileSync(path.join(ROOT, 'DEPLOY.command'), 'utf8');
  assert.match(deploy, /pfa-new-website\.web\.app\/api\/payment\/health/, 'DEPLOY.command reads the panel\'s server too');
  assert.match(deploy, /BOTH SERVERS AGREE/);
});

test('Storage rules deploy on their own, and never block the site or the panel', () => {
  const ship = fs.readFileSync(path.join(ROOT, 'scripts/ship.sh'), 'utf8');
  const panel = ship.indexOf('Deploying the admin panel and the API to Firebase');
  const storage = ship.indexOf('--only storage');
  assert.ok(panel > 0 && storage > panel, 'after the panel');
  assert.match(ship, /has not been set up/, '"not set up yet" is a note');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['deploy:firebase'], /--only functions,hosting,firestore/, 'a bare deploy would include storage and fail until it is on');
});
