'use strict';

/* A payments report for the period chosen on Payments & donations, emailed
   from there (owner, 3 Nov 2026: "have 1 option to send report from here to
   selected people with segregation. it should go as report, for the
   selected duration"). Only to where money already goes. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const FIN = require('../lib/finance-report');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const ROUTE = require('../lib/routes/admin/finance-report');
const audit = require('../lib/admin-audit');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 1 Dec 2026, 08:30 in India: the daily run that reports November */
const DEC1 = Date.parse('2026-12-01T03:00:00.000Z');

let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PAYMENTS_INBOX', 'PFA_SUBMISSIONS_INBOX'];
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
  audit.record = async () => {};
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function pay(id, fields) {
  db.collection('transactions').doc(id).set(Object.assign({ orderId: id, status: 'success', currency: 'INR', ccaVenue: { trackingId: `T${id.slice(-3)}`, bankReference: `B${id.slice(-3)}`, paymentMode: 'UPI' } }, fields));
}

function seed() {
  pay('PFA-DON-AAAAAAA1', { type: 'donate', amount: 1500, paidAt: '2026-11-03T05:00:00.000Z', customer: { name: 'Asha Rao' }, metadata: { cause: 'Rescue and treatment' }, donationReference: 'PFA-DON-2026-00031' });
  pay('PFA-DON-AAAAAAA2', { type: 'donate', amount: 500, paidAt: '2026-11-04T05:00:00.000Z', customer: { name: 'Ravi Kumar' }, metadata: { cause: 'Where it is needed most', gift: { to: 'Meera' } } });
  pay('PFA-DON-AAAAAAA3', { type: 'donate', amount: 40, currency: 'USD', paidAt: '2026-11-05T05:00:00.000Z', customer: { name: 'John Smith' }, metadata: {} });
  pay('PFA-MEM-AAAAAAA4', { type: 'membership', amount: 10000, paidAt: '2026-11-06T05:00:00.000Z', customer: { name: 'Sita Devi' }, metadata: { tierLabel: 'Patron' }, membershipReference: 'PFA-MEM-2026-00007' });
  /* a shop order shipped in December: its updatedAt moved, its paidAt did not */
  pay('PFA-SHP-AAAAAAA5', { type: 'shop', amount: 899, paidAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-12-02T10:00:00.000Z', customer: { name: 'Kiran' }, metadata: { note: 'Tote bag x 1' } });
  pay('PFA-CAR-AAAAAAA6', { type: 'caregiver', amount: 150, paidAt: '2026-11-21T10:00:00.000Z', customer: { name: 'Lata' }, metadata: { cardId: 'PFA-CCT-ABCDEFGH' } });
  pay('PFA-SND-AAAAAAA7', { type: 'send', amount: 300, paidAt: '2026-11-22T10:00:00.000Z', customer: { name: 'Old order' }, metadata: { note: 'Food for a shelter' } });
  /* paid at 23:30 on 30 Nov in India: November, though it is 1 Dec in UTC? no: 18:00 UTC on the 30th */
  pay('PFA-DON-AAAAAAA8', { type: 'donate', amount: 100, paidAt: '2026-11-30T18:00:00.000Z', customer: { name: 'Late Night' }, metadata: {} });
  /* 1 Dec, 00:10 in India: December, not November */
  pay('PFA-DON-AAAAAAA9', { type: 'donate', amount: 999, paidAt: '2026-11-30T18:40:00.000Z', customer: { name: 'Next Month' }, metadata: {} });
  /* not successful: never counted */
  pay('PFA-DON-AAAAAAB1', { type: 'donate', amount: 700, status: 'failed', paidAt: '2026-11-08T05:00:00.000Z', customer: { name: 'Failed' }, metadata: {} });
  pay('PFA-DON-AAAAAAB2', { type: 'donate', amount: 700, status: 'initiated', updatedAt: '2026-11-08T05:00:00.000Z', customer: { name: 'Started' }, metadata: {} });
  /* an older record without paidAt: CCAvenue's first successful answer dates it */
  pay('PFA-CGA-AAAAAAB3', { type: 'caregiver-application', amount: 100, updatedAt: '2026-12-01T01:00:00.000Z', customer: { name: 'Answered In Nov' }, metadata: {} });
  db.collection('paymentEvents').doc('e1').set({ orderId: 'PFA-CGA-AAAAAAB3', status: 'success', receivedAt: '2026-11-25T08:00:00.000Z' });
}


const DEC4 = DEC1 + 3 * 86400000;
function call(method, { body, query } = {}, nowMs = DEC4) {
  const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'accounts@pfa.test', role: 'super' }), now: () => nowMs });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/finance-report', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}
const PAY = ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'];
const FORM = 'gandhim@exmpls.sansad.in';

test('the period: a month, two dates either way round, all time; a period still running ends now and says so', () => {
  const nov = FIN.periodOf({ month: '2026-11' }, DEC4);
  assert.equal(nov.label, 'November 2026');
  assert.equal(nov.from, Date.parse('2026-10-31T18:30:00.000Z'));
  assert.equal(nov.file, '2026-11-01-to-2026-11-30');
  const back = FIN.periodOf({ from: '2026-11-05', to: '2026-11-01' }, DEC4);
  assert.equal(back.label, '1 Nov 2026 to 5 Nov 2026');
  assert.equal(back.to, Date.parse('2026-11-05T18:30:00.000Z'));
  assert.equal(FIN.periodOf({ from: '2026-11-30', to: '2026-11-30' }, DEC4).label, '30 Nov 2026');
  /* 3 Nov 2026, 11:00 in India */
  const now = Date.parse('2026-11-03T05:30:00.000Z');
  const running = FIN.periodOf({ month: '2026-11' }, now);
  assert.equal(running.label, 'November 2026, to 3 Nov 2026');
  assert.equal(running.to, now);
  assert.equal(FIN.periodOf({}, now).label, 'All time, to 3 Nov 2026');
  assert.throws(() => FIN.periodOf({ month: '2026-12' }, now), /not begun/);
  assert.throws(() => FIN.periodOf({ from: '3 Nov' }, now), /YYYY-MM-DD/);
});

test('offered: the payments inboxes, and the forms inbox with them copied; nobody else', () => {
  assert.deepEqual(FIN.periodRecipients(), [
    { address: FORM, role: 'Forms inbox', cc: PAY },
    { address: PAY[0], role: 'Payments inbox', cc: [] },
    { address: PAY[1], role: 'Payments inbox', cc: [] }
  ]);
});

test('to one payments inbox: the period by purpose, subtotals, the total, and the CSV', async () => {
  seed();
  const list = await call('GET', { query: { recipients: '1' } });
  assert.equal(list.json.recipients.length, 3);
  const r = await call('POST', { body: { action: 'period', month: '2026-11', recipients: [PAY[0]] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.result.state, 'sent');
  assert.equal(r.json.result.count, 9);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, PAY[0]);
  assert.equal(m.cc, undefined, 'a payments inbox on its own: no copies');
  assert.equal(m.subject, 'PFA payments report: November 2026 (9 payments, INR 13,549.00 and USD 40.00)');
  assert.match(m.text, /Donations: 4 payments, INR 2,100\.00 and USD 40\.00/);
  assert.match(m.text, /Patrons and membership: 1 payment, INR 10,000\.00/);
  assert.match(m.html, /Payments report/);
  assert.match(m.html, /Sent from the PFA website’s admin panel\./);
  assert.equal(m.attachments[0].filename, 'PFA-payments-2026-11-01-to-2026-11-30.csv');
  const csv = m.attachments[0].content.toString('utf8');
  assert.match(csv, /^\ufeff"PFA payments report, November 2026 \(India time\); successful payments only"/);
  assert.match(csv, /Donations: subtotal,4 payments,,,,INR,2100\.00/);
  assert.match(csv, /Grand total,9 payments,,,,INR,13549\.00/);
  const rec = db.dump()[`finance_report_sends/${r.json.result.sendId}`];
  assert.equal(rec.by, 'admin:accounts@pfa.test');
  assert.deepEqual(rec.recipients, [PAY[0]]);
  assert.equal(rec.emails[0].state, 'sent');
});

test('to the forms inbox: one email, the payments inboxes copied, not sent to them twice', async () => {
  seed();
  const r = await call('POST', { body: { action: 'period', from: '2026-11-30', dateTo: '2026-11-30', recipients: [FORM, PAY[0]] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, FORM);
  assert.equal(sent[0].cc, PAY.join(', '));
  /* 23:30 on 30 Nov in India is in; 00:10 on 1 Dec is not */
  assert.equal(r.json.result.count, 1);
  assert.match(sent[0].subject, /^PFA payments report: 30 Nov 2026 \(1 payments?, INR 100\.00\)$/);
});

test('one purpose: only its payments, and the subject says which', async () => {
  seed();
  const r = await call('POST', { body: { action: 'period', month: '2026-11', purpose: 'donate', purposeLabel: 'Donation', recipients: [PAY[1]] } });
  assert.equal(r.json.result.count, 4);
  assert.match(sent[0].subject, /^PFA payments report: Donation, November 2026 \(4 payments, INR 2,100\.00 and USD 40\.00\)$/);
  assert.doesNotMatch(sent[0].text, /Patrons and membership/);
  assert.match(sent[0].html, /took for Donation, November 2026/);
});

test('never to anyone else: refused at the route, and at the last door', async () => {
  seed();
  const stranger = await call('POST', { body: { action: 'period', month: '2026-11', recipients: [PAY[0], 'someone@example.com'] } });
  assert.equal(stranger.status, 400);
  assert.match(stranger.json.message, /only to the payments inboxes or the forms inbox, not someone@example\.com/);
  assert.equal((await call('POST', { body: { action: 'period', month: '2026-11', recipients: [] } })).json.code, 'NO_RECIPIENT');
  assert.equal((await call('POST', { body: { action: 'period', month: '2026-13', recipients: [PAY[0]] } })).status, 400);
  assert.equal(sent.length, 0);
  await assert.rejects(mail.deliver({ to: 'someone@example.com', template: 'finance_period', payload: { label: 'x', heads: [] } }), /only to the payments inboxes or the forms inbox/);
  assert.equal(sent.length, 0);
});

test('the panel: Email this report beside Download the list; the box in its own file, in the bundle', () => {
  const html = read('admin.html');
  assert.match(html, /id="payCsv">Download the list<\/button>\n {8}<button class="ghost" type="button" id="payMail">Email this report<\/button>/);
  assert.match(html, /<script src="assets\/admin-payreport\.js"><\/script>/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-payreport\.js'/);
  const js = read('assets/admin-payreport.js');
  assert.match(js, /action: 'period', month: p\.month \|\| '', from: p\.from \|\| '', dateTo: p\.dateTo \|\| '', purpose: p\.purpose/);
  assert.match(js, /the payments inboxes are copied/);
});
