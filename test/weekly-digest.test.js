'use strict';

/* The Monday digest (owner, 1 Nov 2026: "on each Monday, a list of people
   who have ordered shop items become members, applied for caregiver card,
   applied for volunteer, jobs etc should go to gandhim cc
   anushkapfacampus@gmail.com . and hyperlink to that application within the
   admin portal. admin should update the status of each application"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const WD = require('../lib/weekly-digest');
const mail = require('../lib/caregiver-mail');
const ROUTE = require('../lib/routes/admin/weekly-digest');
const audit = require('../lib/admin-audit');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Monday 2 Nov 2026, 08:30 in India */
const MON = Date.parse('2026-11-02T03:00:00.000Z');

let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PAYMENTS_INBOX', 'PFA_SUBMISSIONS_INBOX', 'PFA_DIGEST_CC', 'PFA_PANEL_URL'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function file(reference, kind, createdAt, fields, extra) {
  db.collection('submissions').doc(reference).set(Object.assign({ reference, kind, status: 'new', createdAt, fields: fields || {} }, extra || {}));
}

function seed() {
  file('PFA-SHP-ZX81QW22', 'PFA-SHP', '2026-10-27T06:00:00.000Z', { name: 'Asha Rao', total: 2500, items: 'Tote bag (Rs 899)' });
  file('PFA-MEM-2026-00011', 'PFA-MEM', '2026-10-28T06:00:00.000Z', { name: 'Ravi Kumar', city: 'Pune' }, { status: 'photo-requested' });
  file('PFA-CG-2026-00021', 'PFA-CG', '2026-10-29T06:00:00.000Z', { name: 'Meera Iyer' });
  file('PFA-V-2026-00031', 'PFA-V', '2026-10-30T06:00:00.000Z', { name: 'kiran shah', city: 'Udupi' });
  file('PFA-J-2026-00041', 'PFA-J', '2026-11-01T18:00:00.000Z', { fullName: 'Sita Devi' }); // Sunday 11:30 pm IST: still last week
  file('PFA-VI-2026-00051', 'PFA-VI', '2026-10-31T06:00:00.000Z', { name: 'Arjun Nair' });
  file('PFA-A-2026-00061', 'PFA-A', '2026-10-31T07:00:00.000Z', { name: 'Leela' });
  /* left out: a donation, a removed record, last week's Monday 00:00 the week before, and this Monday */
  file('PFA-DON-2026-00071', 'PFA-DON', '2026-10-28T06:00:00.000Z', { name: 'Donor' });
  file('PFA-V-2026-00032', 'PFA-V', '2026-10-28T06:00:00.000Z', { name: 'Removed One' }, { status: 'removed' });
  file('PFA-V-2026-00030', 'PFA-V', '2026-10-25T18:29:00.000Z', { name: 'Week Before' });
  file('PFA-V-2026-00033', 'PFA-V', '2026-11-01T18:30:00.000Z', { name: 'This Monday' });
}

test('the week is Monday to Monday, India time; it is due Monday to Wednesday', () => {
  const b = WD.bounds('2026-11-02');
  assert.equal(new Date(b.from).toISOString(), '2026-10-25T18:30:00.000Z');
  assert.equal(new Date(b.to).toISOString(), '2026-11-01T18:30:00.000Z');
  assert.equal(b.label, '26 Oct to 1 Nov 2026');
  assert.throws(() => WD.bounds('2026-11-03'), /Monday/);
  assert.equal(WD.due(MON), '2026-11-02');
  assert.equal(WD.due(Date.parse('2026-11-01T18:31:00.000Z')), '2026-11-02', 'just after midnight Monday, IST');
  assert.equal(WD.due(Date.parse('2026-11-04T12:00:00.000Z')), '2026-11-02', 'Wednesday catches up');
  assert.equal(WD.due(Date.parse('2026-11-05T12:00:00.000Z')), '', 'Thursday is not due');
  assert.equal(WD.due(Date.parse('2026-11-01T18:00:00.000Z')), '', 'Sunday night, IST');
});

test('orders, members, caregiver, volunteer, job and other forms are listed; donations, removed and other weeks are not', async () => {
  seed();
  const r = await WD.build(db, '2026-11-02');
  const refs = r.groups.flatMap((g) => g.rows.map((x) => x.reference));
  assert.deepEqual(refs.sort(), ['PFA-A-2026-00061', 'PFA-CG-2026-00021', 'PFA-J-2026-00041', 'PFA-MEM-2026-00011', 'PFA-SHP-ZX81QW22', 'PFA-V-2026-00031', 'PFA-VI-2026-00051']);
  const by = Object.fromEntries(r.groups.map((g) => [g.key, g.rows.map((x) => x.name)]));
  assert.deepEqual(by.shop, ['Asha Rao']);
  assert.deepEqual(by.members, ['Ravi Kumar']);
  assert.deepEqual(by.jobs, ['Sita Devi']);
  assert.deepEqual(by.other, ['Leela']);
  assert.equal(r.count, 7);
  assert.equal(r.waiting, 6, 'the member already moved on is not "still new"');
  assert.equal(r.groups.find((g) => g.key === 'members').rows[0].status, 'Photo requested');
});

test('it goes to the forms inbox, copied to anushkapfacampus@gmail.com, once, with each person linked to their record', async () => {
  seed();
  const r = await WD.run({ db, nowMs: MON });
  assert.equal(r.state, 'sent', JSON.stringify(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'gandhim@exmpls.sansad.in');
  assert.equal(sent[0].cc, 'anushkapfacampus@gmail.com');
  assert.match(sent[0].subject, /^PFA this week: 26 Oct to 1 Nov 2026 \(7 new\)$/);
  assert.match(sent[0].html, /href="https:\/\/pfa-new-website\.web\.app\/admin\.html#case=PFA-V-2026-00031"/);
  assert.match(sent[0].html, /href="https:\/\/pfa-new-website\.web\.app\/admin\.html#case=PFA-SHP-ZX81QW22"/);
  assert.match(sent[0].text, /Kiran Shah|kiran shah/);
  assert.doesNotMatch(sent[0].html + sent[0].text, /2500|899|Rs |INR|₹/, 'no amounts');
  assert.doesNotMatch(sent[0].html + sent[0].text, /Donor|Removed One|Week Before|This Monday/);
  assert.doesNotMatch(sent[0].html + sent[0].text, /[–—]/);
  /* every later run that week does nothing */
  assert.equal((await WD.run({ db, nowMs: MON + 600000 })).state, 'already');
  assert.equal((await WD.run({ db, nowMs: MON + 2 * 86400000 })).state, 'already');
  assert.equal(sent.length, 1);
  const rec = await WD.status(db, '2026-11-02');
  assert.deepEqual(rec.sends.map((s) => s.state), ['queued', 'sent']);
  assert.equal(rec.email.status, 'sent');
});

test('the copy list is fixed: a queued payload cannot add anyone', async () => {
  seed();
  await WD.run({ db, nowMs: MON });
  const row = Object.values(db.dump()).find((d) => d.template === 'weekly_digest');
  sent = [];
  await mail.deliver({ to: row.to, template: 'weekly_digest', payload: Object.assign({}, row.payload, { cc: ['someone@else.example'] }) });
  assert.equal(sent[0].cc, 'anushkapfacampus@gmail.com');
  process.env.PFA_DIGEST_CC = 'a@pfa.test, b@pfa.test';
  sent = [];
  await mail.deliver({ to: row.to, template: 'weekly_digest', payload: row.payload });
  assert.equal(sent[0].cc, 'a@pfa.test, b@pfa.test');
});

test('without mail it waits in the queue; a failed make is tried again next run', async () => {
  delete process.env.PFA_SMTP_USER; delete process.env.PFA_SMTP_PASS;
  const r = await WD.run({ db, nowMs: MON });
  assert.equal(r.state, 'queued');
  assert.equal(sent.length, 0);
  assert.equal(Object.values(db.dump()).filter((d) => d.template === 'weekly_digest').length, 1);
});

function call(method, { body } = {}) {
  const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'staff@pfa.test', role: 'super' }), now: () => MON + 86400000 });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/weekly-digest', query: {}, body, headers: {} }, response)).catch(reject);
  });
}

test('the panel: eight weeks with their state, and send again (logged)', async () => {
  seed();
  await WD.run({ db, nowMs: MON });
  const list = await call('GET');
  assert.equal(list.status, 200);
  assert.equal(list.json.weeks.length, 8);
  assert.equal(list.json.weeks[0].week, '2026-11-02');
  assert.equal(list.json.weeks[0].digest.count, 7);
  assert.deepEqual(list.json.recipients, { to: 'gandhim@exmpls.sansad.in', cc: ['anushkapfacampus@gmail.com'] });
  const again = await call('POST', { body: { action: 'send', week: '2026-11-02' } });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(sent.length, 2);
  assert.deepEqual(again.json.digest.sends.map((s) => s.state), ['queued', 'sent', 'queued', 'sent']);
  assert.equal((await call('POST', { body: { action: 'send', week: '2026-11-09' } })).status, 422, 'a week not ended');
  assert.equal((await call('POST', { body: { action: 'send', week: '2026-11-03' } })).status, 400, 'not a Monday');
});

test('wired: the worker runs it, the route is registered, the browser is kept out, the panel opens a linked record', () => {
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/\.\.\/weekly-digest'\)\.run\(/);
  assert.match(read('api/index.js'), /'admin\/weekly-digest': \(\) => require\('\.\.\/lib\/routes\/admin\/weekly-digest\.js'\)/);
  assert.match(read('firestore.rules'), /match \/weekly_digests\/\{id\}\s+\{ allow read, write: if false; \}/);
  const html = read('admin.html');
  assert.match(html, /function caseInHash\(\)[\s\S]*case=\(\[A-Za-z0-9-\]\{4,40\}\)/);
  assert.match(html, /function begin\(admin\) \{[\s\S]*?openWantedCase\(\);/, 'the record opens once the panel is up');
  assert.match(html, /id="wdFold"/);
  /* the drawer it opens is where the status is moved */
  assert.match(html, /id="caseStatus"/);
});
