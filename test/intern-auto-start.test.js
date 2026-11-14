'use strict';

/* The internship starts on its own (owner, 14 Nov 2026: "can you make the
   starting of internship automated. starting should not need an okay go
   ahead from admin. let the one interested just click apply. and they should
   get a link to start the internship"), and everyone who has not started is
   reminded every three days ("to all those who applied, send a reminder
   every 3 days if they have not started the internship"). Through the real
   form handler, panel route, portal and email worker, on an in-memory
   Firestore. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const audit = require('../lib/admin-audit');
const S = require('../lib/intern-store');
const R = require('../lib/intern-reminders');
const APPS = require('../lib/intern-applications');
const AR = require('../lib/intern-applications-report');
const PORTAL = require('../lib/routes/intern/portal');
const ADMIN = require('../lib/routes/admin/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (iso) => Date.parse(iso);
const DAY = 86400000;

let NOW; let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_RRT_REFERRAL_SECRET', 'PFA_RRT_API', 'PFA_PUBLIC_SITE_URL', 'PFA_INTERN_PEPPER'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async (who, entry) => entry;
  /* Thursday 5 Nov 2026, India time */
  NOW = at('2026-11-05T06:00:00.000Z');
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
function admin(method, { body, query } = {}) {
  const h = ADMIN.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'priya@pfa.test', role: 'super' }), now: () => NOW });
  return respond(h, { method, url: '/api/admin/internship', query: query || {}, body, headers: {} });
}
function signIn(email, mobile, dob) {
  const h = PORTAL.createHandler('session', { getDb: () => db, now: () => NOW });
  return respond(h, { method: 'POST', url: '/api/intern/session', query: {}, body: { email, mobile, dob }, headers: { 'x-real-ip': '203.0.113.9', 'x-pfa-intern': '1' }, socket: { remoteAddress: '203.0.113.9' } });
}
const FORM = () => require('../lib/routes/pfa-submissions')._private.createHandler({ getDb: () => db, deliver: mail.deliver, isConfigured: mail.isConfigured, smtpConfigured: mail.smtpConfigured, now: () => NOW });
function apply(data) {
  return respond(FORM(), { method: 'POST', url: '/api/pfa-submissions', query: {}, body: { kind: 'PFA-VI', page: 'internship.html', data: Object.assign({ why: 'I care for the dogs on my street.', guide: 'Read and understood', address: 'House 14, Car Street', pincode: '576101', city: 'Udupi', state: 'Karnataka', district: 'Udupi' }, data), clientRequestId: `r-${Math.random()}` }, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.60' } });
}
function waitingApplication(ref, name, email, mobile, dob) {
  db.collection('submissions').doc(ref).set({ reference: ref, kind: 'PFA-VI', status: 'new', createdAt: '2026-11-01T06:00:00.000Z', history: [], fields: Object.assign({ name, email, mobile, city: 'Udupi' }, dob ? { dob } : { age: '22' }) });
}
async function batch(startDate) {
  const r = await admin('POST', { body: { action: 'batch-save', name: 'November 2026', startDate } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.batch.batchId;
}
const internByEmail = async (email) => (await S.listInterns(db)).find((i) => i.email === email && i.status !== 'reserving');
const to = (email, subject) => sent.filter((m) => m.to === email && (!subject || m.subject === subject));

test('apply, and it has started: no Approve, the start link by email, the page says so', async () => {
  const id = await batch('2026-11-09');
  const r = await apply({ name: 'Asha Rao', email: 'asha@example.com', mobile: '9876512345', dob: '2004-05-14' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.started, true, 'the page is told it started');
  assert.equal(r.json.startUrl, '/intern.html');
  assert.match(r.json.confirmation.lines[0], /The link to start your internship has been emailed to asha@example\.com/);

  const intern = await internByEmail('asha@example.com');
  assert.ok(intern, 'an intern, made with nobody pressing Approve');
  assert.deepEqual([intern.status, intern.batchId, intern.approvedBy, intern.applicationRef], ['active', id, 'automatic', r.json.reference]);
  const rec = (await db.collection('submissions').doc(r.json.reference).get()).data();
  assert.deepEqual([rec.status, rec.handledBy], ['approved', 'automatic'], 'the application shows Accepted');

  /* their email: the start link, in place of the plain "application is in" */
  const start = to('asha@example.com', 'Your PFA internship has started');
  assert.equal(start.length, 1);
  assert.match(start[0].text, /thank you for applying\. You are in November 2026/);
  assert.match(start[0].text, /intern\.html/);
  assert.match(start[0].html, /Start my internship/);
  assert.doesNotMatch(start[0].text, /approved/, 'nobody approved it, so it does not say so');
  assert.equal(to('asha@example.com').length, 1, 'one email to them, not two');
  /* no copy to gandhim as each one comes in (14 Nov 2026): the monthly report carries them */
  assert.deepEqual(sent.map((m) => m.to), ['asha@example.com'], 'nothing to PFA\'s inbox');

  /* nothing waits in the panel, and the three let them in at once */
  assert.equal((await admin('GET', { query: { applications: '1' } })).json.applications.length, 0);
  assert.equal((await signIn('asha@example.com', '9876512345', '2004-05-14')).status, 200);
});

test('a batch already under way is not joined: a new one from the coming Monday', async () => {
  const running = await batch('2026-11-09');
  /* Friday 20 Nov: the November batch is in its second week */
  NOW = at('2026-11-20T06:00:00.000Z');
  const r = await apply({ name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9876500011', dob: '2003-02-01' });
  assert.equal(r.json.started, true);
  const intern = await internByEmail('ravi@example.com');
  assert.notEqual(intern.batchId, running, 'not dropped into week 2');
  const own = await S.getBatch(db, intern.batchId);
  assert.equal(own.startDate, '2026-11-23', 'the coming Monday');
  /* within the first three days, the batch under way is joined */
  NOW = at('2026-11-25T06:00:00.000Z');
  const r2 = await apply({ name: 'Meera Das', email: 'meera@example.com', mobile: '9876500012', dob: '2003-02-01' });
  assert.equal(r2.json.started, true);
  assert.equal((await internByEmail('meera@example.com')).batchId, intern.batchId);
});

test('everyone already waiting is started by the email worker; anyone missing a detail is asked every 3 days', async () => {
  await batch('2026-11-09');
  waitingApplication('PFA-VI-2026-00001', 'Anushka Das', 'anushka@example.com', '9880847070', '2007-10-14');
  waitingApplication('PFA-VI-2026-00002', 'Kiran B', 'kiran@example.com', '9880847071', null);
  db.collection('submissions').doc('PFA-VI-2026-00003').set({ reference: 'PFA-VI-2026-00003', kind: 'PFA-VI', status: 'rejected', createdAt: '2026-11-01T06:00:00.000Z', history: [], fields: { name: 'Not Taken', email: 'no@example.com', mobile: '9880847072', dob: '2004-01-01' } });

  const one = await R.run({ db, nowMs: NOW });
  assert.deepEqual(one.applications, { started: 1, asked: 1, failed: 0 });
  assert.ok(await internByEmail('anushka@example.com'));
  assert.equal(to('anushka@example.com', 'Your PFA internship has started').length, 1);
  assert.equal((await db.collection('submissions').doc('PFA-VI-2026-00001').get()).data().status, 'approved');
  assert.equal(to('kiran@example.com', 'One more step for your PFA internship application').length, 1, 'asked for the date of birth');
  assert.equal(await internByEmail('no@example.com'), undefined, 'one PFA turned down stays turned down');

  /* the worker runs every ten minutes: nothing twice */
  await R.run({ db, nowMs: NOW + 10 * 60000 });
  assert.equal(to('anushka@example.com', 'Your PFA internship has started').length, 1);
  assert.equal(to('kiran@example.com').length, 1);
  /* three days on, asked again */
  await R.run({ db, nowMs: NOW + 3 * DAY });
  assert.equal(to('kiran@example.com', 'One more step for your PFA internship application').length, 2);
});

test('not signed in yet: the start link again every 3 days, until they sign in', async () => {
  await batch('2026-11-09');
  await apply({ name: 'Asha Rao', email: 'asha@example.com', mobile: '9876512345', dob: '2004-05-14' });
  const waiting = 'Your PFA internship is waiting for you';
  const run = async (days) => R.run({ db, nowMs: NOW + days * DAY });

  await run(2);
  assert.equal(to('asha@example.com', waiting).length, 0, 'not before three days');
  const r = await run(3);
  assert.equal(to('asha@example.com', waiting).length, 1);
  const m = to('asha@example.com', waiting)[0];
  assert.match(m.text, /you have not signed in yet/);
  assert.match(m.text, /mobile number \(ending 2345\)/);
  assert.match(m.text, /intern\.html/);
  assert.match(m.text, /You get this every 3 days until you sign in\./);
  assert.doesNotMatch(m.text + m.html, /2004|14\/05|9876512345/, 'no secret in it');
  assert.ok(r.reminders.some((x) => x.kind === 'not-started' && x.sent === 1), 'logged');
  const log = await R.logs(db, (await internByEmail('asha@example.com')).batchId);
  assert.ok(log.some((x) => x.kind === 'not-started' && x.sent === 1), 'in the panel\'s reminder log');

  await run(3.01);
  await run(5);
  assert.equal(to('asha@example.com', waiting).length, 1, 'once in three days');
  await run(6);
  assert.equal(to('asha@example.com', waiting).length, 2);

  /* they sign in: no more */
  NOW += 7 * DAY;
  assert.equal((await signIn('asha@example.com', '9876512345', '2004-05-14')).status, 200);
  NOW -= 7 * DAY;
  await run(9);
  await run(12);
  assert.equal(to('asha@example.com', waiting).length, 2);
});

test('the pages, the panel and the worker say what happens now', () => {
  const page = read('internship.html');
  assert.match(page, /Your internship starts as soon as you apply\./);
  assert.match(page, /<a class="btn" href="intern\.html" data-done-start hidden>Start my internship<\/a>/);
  assert.match(page, /if \(!r \|\| !r\.started\) return;/);
  assert.doesNotMatch(page + read('intern.html') + read('intern-guide.html'), /reads every application|within a week|once PFA approves|not approved yet|still with PFA/i, 'no wait for an okay, anywhere');
  assert.match(read('admin.html'), /Applications start on their own/);
  assert.match(read('admin.html'), /x\.kind === 'not-started' \? 'Not signed in yet \(every 3 days\)'/);
  assert.match(read('lib/intern-reminders.js'), /require\('\.\/intern-applications'\)\.sweep/);
  assert.equal(R.NUDGE_DAYS, 3);
  assert.equal(APPS.REMIND_DAYS, 3);
});

test('gandhim gets everyone who applied once a month, not an email for each', async () => {
  await batch('2026-11-09');
  /* October: one, before the month */
  NOW = at('2026-10-30T06:00:00.000Z');
  await apply({ name: 'Old Timer', email: 'old@example.com', mobile: '9876500020', dob: '2001-01-01' });
  /* November: three; one signs in, one does not, one from before the form asked for all three */
  NOW = at('2026-11-05T06:00:00.000Z');
  const a = await apply({ name: 'Asha Rao', email: 'asha@example.com', mobile: '9876512345', dob: '2004-05-14' });
  await apply({ name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9876500011', dob: '2003-02-01' });
  db.collection('submissions').doc('PFA-VI-2026-00099').set({ reference: 'PFA-VI-2026-00099', kind: 'PFA-VI', status: 'new', createdAt: '2026-11-20T06:00:00.000Z', history: [], fields: { name: 'Kiran B', email: 'kiran@example.com', mobile: '9880847071', city: 'Udupi', age: '22' } });
  assert.equal((await signIn('asha@example.com', '9876512345', '2004-05-14')).status, 200);
  assert.ok(sent.every((m) => !/gandhim/.test(m.to)), 'none to gandhim as they came in');

  /* not before the 1st */
  assert.equal((await AR.run({ db, nowMs: at('2026-11-30T12:00:00.000Z') })).state, 'not-due');
  sent = [];
  const r = await AR.run({ db, nowMs: at('2026-12-01T03:00:00.000Z') });
  assert.equal(r.state, 'sent', JSON.stringify(r));
  assert.equal(r.month, '2026-11');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'gandhim@exmpls.sansad.in', 'the forms inbox, and no one else');
  assert.equal(m.subject, 'Remote internship applications: November 2026 (3 people, 2 started)');
  assert.match(m.text, /3 people applied; 2 started \(1 signed in, 1 not yet\); 1 missing a detail\./);
  assert.match(m.text, new RegExp(`5 Nov: Asha Rao \\(${a.json.reference}\\), asha@example\\.com, 9876512345, Udupi, Karnataka\\. Started, signed in, PFA-IN-\\w{6}, November 2026\\.`));
  assert.match(m.text, /Ravi Kumar .* Started, not signed in yet/);
  assert.match(m.text, /20 Nov: Kiran B \(PFA-VI-2026-00099\).* Missing date of birth\./);
  assert.doesNotMatch(m.text, /Old Timer/, 'October is October\'s');
  assert.doesNotMatch(m.text + m.html, /2004-05-14|14\/05\/2004/, 'never the date of birth');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'PFA-internship-applications-2026-11.csv');
  const csv = Buffer.from(m.attachments[0].content).toString('utf8');
  assert.match(csv, /^﻿Applied \(IST\),Application,Name,Email,Mobile,Age,Place,Status,Intern ID,Batch,College or work,Instagram or YouTube,Why they want to do it\r\n/);
  assert.equal(csv.trim().split('\r\n').length, 4);
  assert.match(csv, /I care for the dogs on my street\./);
  assert.doesNotMatch(csv, /2004-05-14/);
  /* once */
  assert.equal((await AR.run({ db, nowMs: at('2026-12-02T03:00:00.000Z') })).state, 'already');
  assert.equal(sent.length, 1);
  /* wired into the worker, off in tests */
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/\.\.\/intern-applications-report'\)\.run/);
  assert.match(read('test/_isolate-env.js'), /PFA_INTERN_APPS_REPORT = 'off'/);
});
