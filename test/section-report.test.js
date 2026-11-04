'use strict';

/* Volunteers, Interns, Shop orders, Job applicants and the Colony card
   register: a period to filter by, and the report for it emailed (owner,
   4 Nov 2026: "these also should have date and range filters and option to
   send the report to those email; anushkapfacampus@gmail.com"). The shop's
   report is money, so it goes only where money goes. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const SR = require('../lib/section-report');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const ROUTE = require('../lib/routes/admin/section-report');
const audit = require('../lib/admin-audit');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 4 Nov 2026, 15:30 in India */
const NOW = Date.parse('2026-11-04T10:00:00.000Z');
const PAY = ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'];
const FORM = 'gandhim@exmpls.sansad.in';
const ANUSHKA = 'anushkapfacampus@gmail.com';

let db; let sent; let realRecord; let modules;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PAYMENTS_INBOX', 'PFA_SUBMISSIONS_INBOX', 'PFA_SECTION_REPORT_TO'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  modules = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(method, { body, query } = {}) {
  const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async (rq, rs, module) => { modules.push(module); return { uid: 'u1', email: 'desk@pfa.test', role: 'super' }; }, now: () => NOW });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/section-report', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}

function volunteer(id, at, fields, status) {
  db.collection('submissions').doc(id).set({ kind: 'PFA-V', status: status || 'new', receivedAtMs: Date.parse(at), createdAt: at, fields: Object.assign({ name: 'Kiran Shah', mobile: '9876543210', email: 'kiran@example.com', city: 'Udupi', state: 'Karnataka', title: ['Rescue', 'Fostering'] }, fields || {}) });
}
function shop(id, at, total, name) {
  db.collection('transactions').doc(id).set({ type: 'shop', status: 'success', amount: total, createdAt: at, customer: { name, email: 'buyer@example.com', mobile: '9000000000', address: 'Car Street', district: 'Udupi', state: 'Karnataka', pin: '576101' }, metadata: { items: [{ id: '23', name: 'Tote bag', qty: 1, price: total, lineTotal: total }] } });
}

test('the period: two days either way round, one day, all time; never past now', () => {
  const p = SR.periodOf({ from: '2026-11-03', to: '2026-11-01' }, NOW);
  assert.equal(p.label, '1 Nov 2026 to 3 Nov 2026');
  assert.equal(p.from, Date.parse('2026-10-31T18:30:00.000Z'));
  assert.equal(p.to, Date.parse('2026-11-03T18:30:00.000Z'));
  assert.equal(SR.periodOf({ from: '2026-11-02', to: '2026-11-02' }, NOW).label, '2 Nov 2026');
  assert.match(SR.periodOf({}, NOW).label, /^All time, to 4 Nov 2026$/);
  assert.equal(SR.periodOf({ from: '2026-11-01', to: '2026-11-30' }, NOW).to, NOW);
  assert.throws(() => SR.periodOf({ from: '2026-12-01' }, NOW), /not begun/);
  assert.throws(() => SR.periodOf({ from: '1/11/2026' }, NOW), /YYYY-MM-DD/);
});

test('volunteers in the period only, newest first; spam and the site’s testing left out; India time decides the day', async () => {
  volunteer('PFA-V-2026-00040', '2026-11-02T05:00:00.000Z', { name: 'Asha Rao' });
  volunteer('PFA-V-2026-00041', '2026-11-03T05:00:00.000Z', { name: 'Ravi Kumar' });
  /* 1 Nov, 00:10 in India: in */
  volunteer('PFA-V-2026-00039', '2026-10-31T18:40:00.000Z', { name: 'Early Bird' });
  /* 31 Oct, 23:50 in India: out */
  volunteer('PFA-V-2026-00038', '2026-10-31T18:20:00.000Z', { name: 'Too Early' });
  volunteer('PFA-V-2026-00042', '2026-11-03T06:00:00.000Z', { name: 'Spammer' }, 'spam');
  const r = await call('GET', { query: { kind: 'volunteers', from: '2026-11-01', to: '2026-11-03' } });
  assert.equal(r.status, 200);
  assert.deepEqual(modules, ['volunteers']);
  assert.deepEqual(r.json.rows.map((x) => x.cells[1]), ['Ravi Kumar', 'Asha Rao', 'Early Bird']);
  assert.equal(r.json.count, 3);
  assert.deepEqual(r.json.columns.slice(0, 2), ['Reference', 'Name']);
  assert.equal(r.json.rows[0].cells[5], 'Rescue, Fostering');
  assert.equal(r.json.rows[2].cells[7], '1 Nov 2026');
  assert.deepEqual(r.json.recipients.map((x) => x.address), [FORM, ANUSHKA, ...PAY]);
});

test('each section is behind its own part of the panel', async () => {
  for (const [kind, module] of [['volunteers', 'volunteers'], ['jobs', 'employees'], ['interns', 'internship'], ['shop', 'shop'], ['caregivers', 'caregivers'], ['members', 'membership']]) {
    modules = [];
    const r = await call('GET', { query: { kind } });
    assert.equal(r.status, 200, kind);
    assert.deepEqual(modules, [module], kind);
  }
  const who = await call('GET', { query: { kind: 'shop', recipients: '1' } });
  assert.equal(who.json.money, true);
  assert.ok(!who.json.recipients.some((x) => x.address === ANUSHKA));
  const bad = await call('GET', { query: { kind: 'payments' } });
  assert.equal(bad.status, 400);
});

test('the CSV: every column, a count at the foot, a formula written as text', async () => {
  volunteer('PFA-V-2026-00040', '2026-11-02T05:00:00.000Z', { name: '=HYPERLINK("x")' });
  const r = await call('GET', { query: { kind: 'volunteers', from: '2026-11-01', to: '2026-11-04', format: 'csv' } });
  assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(r.headers['content-disposition'], /PFA-volunteers-2026-11-01-to-2026-11-04\.csv/);
  const csv = Buffer.from(r.raw).toString('utf8');
  assert.ok(csv.startsWith('\ufeff"PFA Volunteers, 1 Nov 2026 to 4 Nov 2026'));
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /\r\n1 line\r\n$/);
});

test('emailed to Anushka and the forms inbox, the CSV attached, logged', async () => {
  volunteer('PFA-V-2026-00040', '2026-11-02T05:00:00.000Z', { name: 'Asha Rao' });
  const r = await call('POST', { query: { kind: 'volunteers' }, body: { from: '2026-11-01', to: '2026-11-04', recipients: [ANUSHKA, FORM] } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.result.state, 'sent');
  assert.deepEqual(sent.map((m) => [].concat(m.to)[0]).sort(), [ANUSHKA, FORM].sort());
  for (const m of sent) {
    assert.equal(m.cc, undefined, 'no copies for a section that is not money');
    assert.match(m.subject, /^PFA Volunteers: 1 Nov 2026 to 4 Nov 2026 \(1 line\)$/);
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].filename, 'PFA-volunteers-2026-11-01-to-2026-11-04.csv');
    assert.match(Buffer.from(m.attachments[0].content, 'base64').toString('utf8'), /Asha Rao/);
  }
  const kept = (await db.collection(SR.SENDS).doc(r.json.result.sendId).get()).data();
  assert.equal(kept.count, 1);
  assert.equal(kept.emails.length, 2);
});

test('no other address, whatever is asked', async () => {
  const r = await call('POST', { query: { kind: 'jobs' }, body: { recipients: ['someone@example.com'] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_ALLOWED');
  const none = await call('POST', { query: { kind: 'jobs' }, body: { recipients: [] } });
  assert.equal(none.json.code, 'NO_RECIPIENT');
  assert.equal(sent.length, 0);
  await assert.rejects(mail.deliver({ to: 'someone@example.com', template: 'section_report', payload: { kind: 'jobs', label: 'x', rows: [] } }), /only to the addresses the panel offers/);
});

test('shop orders are money: never to Anushka; the forms inbox copies the payments inboxes; the total in rupees', async () => {
  shop('PFA-SHP-AAAAAAA1', '2026-11-02T05:00:00.000Z', 899, 'Kiran');
  shop('PFA-SHP-AAAAAAA2', '2026-10-20T05:00:00.000Z', 2500, 'Last Month');
  const g = await call('GET', { query: { kind: 'shop', from: '2026-11-01', to: '2026-11-04' } });
  assert.deepEqual(g.json.recipients.map((x) => x.address), [FORM, ...PAY]);
  assert.equal(g.json.count, 1);
  assert.equal(g.json.total, 899);
  const no = await call('POST', { query: { kind: 'shop' }, body: { from: '2026-11-01', to: '2026-11-04', recipients: [ANUSHKA] } });
  assert.equal(no.status, 400);
  assert.match(no.json.message, /record of money/);
  await assert.rejects(mail.deliver({ to: ANUSHKA, template: 'section_report', payload: { kind: 'shop', label: 'Shop orders', rows: [] } }), (e) => e.code === 'MONEY_NOT_FOR_THIS_INBOX');
  const r = await call('POST', { query: { kind: 'shop' }, body: { from: '2026-11-01', to: '2026-11-04', recipients: [FORM, PAY[0]] } });
  assert.equal(r.status, 200, r.raw);
  /* the forms inbox carries both payments inboxes in copy, so no second email to the one ticked */
  assert.equal(sent.length, 1);
  assert.equal([].concat(sent[0].to)[0], FORM);
  assert.deepEqual([].concat(sent[0].cc).join(',').split(/\s*,\s*/).sort(), PAY.slice().sort());
  assert.match(sent[0].html, /INR 899\.00/);
});

test('a CSV is only read for the section it was made for', async () => {
  volunteer('PFA-V-2026-00040', '2026-11-02T05:00:00.000Z', {});
  const r = await call('POST', { query: { kind: 'volunteers' }, body: { recipients: [FORM] } });
  const id = r.json.result.sendId;
  assert.ok(await SR.readSentCsv(db, id, 'volunteers'));
  assert.equal(await SR.readSentCsv(db, id, 'shop'), null);
  assert.equal(await SR.readSentCsv(db, '../x', 'volunteers'), null);
});

test('the panel: a period bar and an email box on all five sections, from a script of its own', () => {
  const js = read('assets/admin-reports.js');
  for (const pane of ['volunteers', 'employees', 'interns', 'shop', 'cgsheet', 'memsheet']) assert.match(js, new RegExp(`${pane}:\\s*'`), pane);
  assert.match(read('admin.html'), /<script src="assets\/admin-reports\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-reports\.js'/);
  assert.match(read('api/index.js'), /'admin\/section-report'/);
});

/* owner, 4 Nov 2026, on the Members register: "where is the option to send
   this to email.." */
test('the Members register too: in the period, to Anushka and the forms inbox, and no amount in it', async () => {
  db.collection('submissions').doc('PFA-MEM-2026-00001').set({ kind: 'PFA-MEM', status: 'new', receivedAtMs: Date.parse('2026-11-02T05:00:00.000Z'), createdAt: '2026-11-02T05:00:00.000Z', fields: { name: 'Deepa Ujjawal', mobile: '9412420113', email: 'deepa@example.com', address: 'Qtr D21, IVRI Campus', city: 'Bareilly', state: 'Uttar Pradesh', pin: '243122', tier: 'silver', tierLabel: 'Silver membership', amount: '1000' } });
  db.collection('submissions').doc('PFA-MEM-2026-00000').set({ kind: 'PFA-MEM', status: 'new', receivedAtMs: Date.parse('2026-10-20T05:00:00.000Z'), createdAt: '2026-10-20T05:00:00.000Z', fields: { name: 'Last Month', mobile: '9412420000', email: 'last@example.com', amount: '1000' } });
  const g = await call('GET', { query: { kind: 'members', from: '2026-11-01', to: '2026-11-04' } });
  assert.equal(g.status, 200, g.raw);
  assert.deepEqual(modules, ['membership']);
  assert.deepEqual(g.json.rows.map((r) => r.cells[2]), ['Deepa Ujjawal']);
  assert.ok(g.json.recipients.some((x) => x.address === ANUSHKA));
  assert.doesNotMatch(JSON.stringify(g.json.columns), /amount|INR|fee/i);
  assert.doesNotMatch(JSON.stringify(g.json.rows), /1,?000\.00|INR/);
  const r = await call('POST', { query: { kind: 'members' }, body: { from: '2026-11-01', to: '2026-11-04', recipients: [ANUSHKA] } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^PFA Members register: 1 Nov 2026 to 4 Nov 2026 \(1 line\)$/);
  assert.doesNotMatch(Buffer.from(sent[0].attachments[0].content, 'base64').toString('utf8'), /INR|1,000\.00/);
});
