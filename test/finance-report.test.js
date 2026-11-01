'use strict';

/* The monthly payments report (owner, 1 Nov 2026: "On the 1st of every
   month, automatically email a consolidated financial report for the
   previous calendar month to gandhim, CC'ing the accounts team ... Only
   successful payment records ... prevent duplicate sends, and maintain
   delivery logs ... a downloadable CSV report"). */

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

test('the calendar is India\'s: the month before, the 1st, a catch-up week', () => {
  assert.equal(FIN.previousMonth(DEC1), '2026-11');
  assert.equal(FIN.previousMonth(Date.parse('2026-01-01T00:00:00.000Z')), '2025-12');
  /* 31 Dec, 20:00 UTC is 1 Jan in India */
  assert.equal(FIN.previousMonth(Date.parse('2026-12-31T20:00:00.000Z')), '2026-12');
  assert.equal(FIN.due(DEC1), true);
  assert.equal(FIN.due(Date.parse('2026-12-07T10:00:00.000Z')), true, 'up to the 7th if the 1st was missed');
  assert.equal(FIN.due(Date.parse('2026-12-08T10:00:00.000Z')), false);
  const b = FIN.bounds('2026-11');
  assert.equal(new Date(b.from).toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(new Date(b.to).toISOString(), '2026-11-30T18:30:00.000Z');
  assert.equal(b.label, 'November 2026');
});

test('only successful payments of the month, each under its head, rupees and dollars apart', async () => {
  seed();
  const r = await FIN.build(db, '2026-11');
  const by = Object.fromEntries(r.heads.map((h) => [h.key, h]));
  assert.deepEqual(r.heads.map((h) => h.label), ['Donations', 'Patrons and membership', 'Shop orders', 'Colony caregiver cards', 'Other payments']);
  assert.deepEqual(by.donations.rows.map((x) => x.name), ['Asha Rao', 'Ravi Kumar', 'John Smith', 'Late Night']);
  assert.deepEqual(by.donations.subtotal, { INR: 2100, USD: 40 });
  assert.deepEqual(by.membership.rows.map((x) => [x.name, x.purpose, x.reference]), [['Sita Devi', 'Patron', 'PFA-MEM-2026-00007']]);
  assert.deepEqual(by.shop.rows.map((x) => x.date), ['2026-11-20'], 'dated by when it was paid, not shipped');
  assert.deepEqual(by.caregiver.rows.map((x) => x.name), ['Lata', 'Answered In Nov'], 'dated by CCAvenue\'s answer when there is no paidAt');
  assert.deepEqual(by.other.rows.map((x) => x.purpose), ['Food for a shelter']);
  assert.equal(r.count, 9);
  assert.deepEqual(r.total, { INR: 13549, USD: 40 });
  assert.ok(!r.heads.some((h) => h.rows.some((x) => /Failed|Started|Next Month/.test(x.name))), 'failed, unfinished and next month\'s are out');
  const gift = by.donations.rows.find((x) => x.name === 'Ravi Kumar');
  assert.equal(gift.purpose, 'Gift for Meera; Where it is needed most');
  const asha = by.donations.rows[0];
  assert.deepEqual([asha.date, asha.time, asha.status, asha.orderId, asha.reference, asha.bankReference, asha.trackingId], ['2026-11-03', '10:30', 'Success', 'PFA-DON-AAAAAAA1', 'PFA-DON-2026-00031', 'BAA1', 'TAA1']);
});

test('the CSV: a line per payment, a subtotal per head, the grand total; safe in Excel', async () => {
  seed();
  pay('PFA-DON-AAAAAAC1', { type: 'donate', amount: 10, paidAt: '2026-11-09T05:00:00.000Z', customer: { name: '=HYPERLINK("x")' }, metadata: {} });
  const r = await FIN.build(db, '2026-11');
  const csv = r.csv;
  assert.ok(csv.startsWith('\ufeff'), 'opens in Excel as UTF-8');
  const lines = csv.trim().split('\r\n');
  assert.match(lines[0], /PFA payments report, November 2026 \(India time\); successful payments only/);
  assert.equal(lines[2], 'Category,Payer,Paid on (IST),Time (IST),Purpose,Currency,Amount,Status,PFA transaction ID,PFA reference,Bank reference,CCAvenue tracking ID,Paid by');
  assert.ok(lines.includes('Donations: subtotal,5 payments,,,,INR,2110.00'));
  assert.ok(lines.includes('Donations: subtotal,5 payments,,,,USD,40.00'));
  assert.ok(lines.includes('Grand total,10 payments,,,,INR,13559.00'));
  assert.ok(lines.includes('Grand total,10 payments,,,,USD,40.00'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'), 'a formula is written as text');
  assert.ok(!/[\u2013\u2014]/.test(csv), 'no dashes');
});

test('on the 1st: made once, emailed to gandhim, copied to the payments inboxes, with the CSV', async () => {
  seed();
  const first = await FIN.run({ db, nowMs: DEC1, siteUrl: 'https://peopleforanimalsindia.org' });
  assert.equal(first.state, 'sent');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'gandhim@exmpls.sansad.in');
  assert.equal(m.cc, 'pfadcmho@gmail.com, ozairhusain@gmail.com');
  assert.equal(m.subject, 'PFA payments report: November 2026 (9 payments, INR 13,549.00 and USD 40.00)');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'PFA-payments-2026-11.csv');
  assert.match(m.attachments[0].content.toString('utf8'), /Grand total,9 payments,,,,INR,13549\.00/);
  for (const bit of ['Donations', 'Patrons and membership', 'Shop orders', 'Colony caregiver cards', 'Other payments', 'Grand total', 'Asha Rao', 'PFA-DON-AAAAAAA1 / PFA-DON-2026-00031', '3 Nov 2026, 10:30', 'INR 1,500.00', 'Success']) {
    assert.ok(m.html.includes(bit), bit);
  }
  assert.ok(!/[\u2013\u2014]/.test(m.html + m.text), 'no dashes');
  /* again the same day, and from the other server: nothing more */
  assert.equal((await FIN.run({ db, nowMs: DEC1 + 600000 })).state, 'already');
  assert.equal((await FIN.run({ db, nowMs: DEC1 + 86400000 })).state, 'already');
  assert.equal(sent.length, 1, 'one email for the month');
  /* the log: the month's record and the queue row it names */
  const s = await FIN.status(db, '2026-11');
  assert.equal(s.state, 'sent');
  assert.equal(s.count, 9);
  assert.equal(s.email.status, 'sent');
  assert.deepEqual(s.sends.map((x) => x.state), ['queued', 'sent']);
  assert.equal(s.to, 'gandhim@exmpls.sansad.in');
});

test('two servers on the 1st together: one email', async () => {
  seed();
  const both = await Promise.all([FIN.run({ db, nowMs: DEC1 }), FIN.run({ db, nowMs: DEC1 })]);
  assert.deepEqual(both.map((x) => x.state).sort(), ['already', 'sent']);
  assert.equal(sent.length, 1);
});

test('mail down on the 1st: queued with its CSV, sent by the worker later, still once', async () => {
  seed();
  mail._setSmtpTransport(() => ({ sendMail: async () => { const e = new Error('connect ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } }));
  const r = await FIN.run({ db, nowMs: DEC1 });
  assert.equal(r.state, 'queued');
  const s = await FIN.status(db, '2026-11');
  assert.equal(s.state, 'queued');
  assert.ok(['retry', 'queued'].includes(s.email.status), s.email.status);
  assert.ok(s.sends.some((x) => x.state === 'retrying' && /ETIMEDOUT/.test(x.error)), 'the failure is logged');
  /* the worker's later attempt carries everything */
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  const row = db.dump()[`caregiverEmails/${s.emailId}`];
  await mail.deliver({ to: row.to, template: row.template, payload: row.payload });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cc, 'pfadcmho@gmail.com, ozairhusain@gmail.com');
  assert.equal(sent[0].attachments[0].filename, 'PFA-payments-2026-11.csv');
});

test('nothing before or after its week; an empty month still reports, at zero', async () => {
  assert.equal((await FIN.run({ db, nowMs: Date.parse('2026-12-10T03:00:00.000Z') })).state, 'not-due');
  const r = await FIN.run({ db, nowMs: DEC1 });
  assert.equal(r.state, 'sent');
  assert.match(sent[0].subject, /0 payments, INR 0\.00/);
});

test('a copy is never sent to anyone but the payments inboxes, whatever the queue says', async () => {
  seed();
  await FIN.run({ db, nowMs: DEC1 });
  const row = Object.values(db.dump()).find((d) => d.template === 'finance_monthly');
  sent = [];
  await mail.deliver({ to: row.to, template: 'finance_monthly', payload: Object.assign({}, row.payload, { cc: ['someone@else.example'] }) });
  assert.equal(sent[0].cc, 'pfadcmho@gmail.com, ozairhusain@gmail.com');
  /* and no other email carries a copy */
  sent = [];
  await mail.deliver({ to: 'asha@example.com', template: 'payment_received', payload: { orderId: 'PFA-DON-AAAAAAA1', amount: 1, name: 'Asha', cc: ['x@y.example'] } });
  assert.equal(sent[0].cc, undefined);
});

function call(method, { body, query } = {}) {
  const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'accounts@pfa.test', role: 'super' }), now: () => DEC1 + 3 * 86400000 });
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/finance-report', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}

test('the panel: twelve months with their state, the CSV, and send again (logged)', async () => {
  seed();
  await FIN.run({ db, nowMs: DEC1 });
  const list = await call('GET');
  assert.equal(list.status, 200);
  assert.equal(list.json.reports.length, 12);
  assert.equal(list.json.reports[0].month, '2026-11');
  assert.equal(list.json.reports[0].report.state, 'sent');
  assert.equal(list.json.reports[0].report.email.status, 'sent');
  assert.equal(list.json.recipients.to, 'gandhim@exmpls.sansad.in');
  const csv = await call('GET', { query: { month: '2026-11', format: 'csv' } });
  assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(csv.headers['content-disposition'], /PFA-payments-2026-11\.csv/);
  assert.match(String(csv.raw), /Grand total,9 payments/);
  /* a month not reported yet is made on the spot for the download */
  pay('PFA-DON-AAAAAAD1', { type: 'donate', amount: 250, paidAt: '2026-10-25T05:00:00.000Z', customer: { name: 'October' }, metadata: {} });
  assert.match(String((await call('GET', { query: { month: '2026-10', format: 'csv' } })).raw), /October/);
  /* send again: a second email, both in the log */
  const again = await call('POST', { body: { action: 'send', month: '2026-11' } });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(sent.length, 2);
  assert.deepEqual(again.json.report.sends.map((x) => x.state), ['queued', 'sent', 'queued', 'sent']);
  assert.equal((await call('POST', { body: { action: 'send', month: '2026-12' } })).status, 422, 'a month that has not ended');
});

test('wired: the worker runs it, the route is registered, the browser is kept out, the panel shows it', () => {
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/\.\.\/finance-report'\)[\s\S]*FIN\.run\(/);
  assert.match(read('api/index.js'), /'admin\/finance-report': \(\) => require\('\.\.\/lib\/routes\/admin\/finance-report\.js'\)/);
  assert.match(read('firestore.rules'), /match \/finance_reports\/\{id\}\s+\{ allow read, write: if false; \}/);
  assert.match(read('lib/firebase.js'), /updated\.paidAt = new Date\(\)\.toISOString\(\)/, 'every payment from now on carries when it was paid');
  const html = read('admin.html');
  assert.ok(html.includes('<details class="fold fr" id="frFold"><summary>Monthly payments reports</summary>'));
  assert.ok(html.includes("api('/api/admin/finance-report', { method: 'POST', body: { action: 'send', month: month } })"));
  assert.ok(!/[\u2013\u2014]/.test(read('lib/finance-report.js') + read('lib/routes/admin/finance-report.js')), 'no dashes');
});

/* ---- October 2026: the old site's payments, each payment once (owner,
   1 Nov 2026: "combine the old site's payment records from 1-21 October
   with the new site's records from its launch on 21-31 October. Reconcile
   the migration overlap using payment gateway transaction IDs and reference
   numbers so every payment is included exactly once. Do not deduplicate by
   name or amount alone. Verify the combined totals against gateway
   records, resolve any discrepancies, then send the complete report.") */

const REC = require('../lib/finance-reconcile');
const NOV1 = Date.parse('2026-11-01T03:00:00.000Z');

const OLD_CSV = [
  'date,category,name,email,mobile,amount,currency,method,orderId,matchedBy,address,city,state,pincode',
  '2026-10-21,Donation,Saptak Mukherjee,s@example.com,6289604388,12000,INR,Unified Payments,PFADONMVHV6AZI71BD15,liveCallback,"4th Floor, Liluah",Howrah,West Bengal,711203',
  '2026-10-21,Donation,vipin mathur,v@example.com,9810678912,30,INR,Unified Payments,PFADONMVHHIQRTBBD29B,liveCallback,AH 907,Ghaziabad,Uttar Pradesh,201014',
  '2026-10-20,Membership,PANKAJ KUMAR SAINI,p@example.com,7357033962,500,INR,Unified Payments,PFADONMVG89E18E46112,liveCallback,NAGAR,BHARATPUR,RAJASTHAN,321205',
  '2026-10-16,Sponsorship,Old Sponsor,o@example.com,9000000001,2500,INR,Credit Card,PFADONMVBAA6TI127C6D,liveCallback,x,y,z,110001',
  '2026-10-12,Donation,Same Name,a@example.com,9000000002,500,INR,UPI,PFADONOLDAAAAA000001,liveCallback,x,y,z,110001',
  '2026-10-10,Donation,Refunded Later,r@example.com,9000000003,800,INR,UPI,PFADONOLDAAAAA000002,liveCallback,x,y,z,110001',
  '2026-10-09,Donation,Wrong Amount,w@example.com,9000000004,1000,INR,UPI,PFADONOLDAAAAA000003,liveCallback,x,y,z,110001',
  '2026-09-30,Donation,September,s2@example.com,9000000005,100,INR,UPI,PFADONOLDAAAAA000004,liveCallback,x,y,z,110001'
].join('\n');

function seedOctober() {
  /* the new site, from its launch on 21 October */
  pay('PFA-DON-NEWAAAA1', { type: 'donate', amount: 250, paidAt: '2026-10-21T05:00:00.000Z', customer: { name: 'New Site Donor' }, metadata: {}, ccaVenue: { trackingId: '313000000001', bankReference: '667100000001', paymentMode: 'UPI' } });
  pay('PFA-MEM-NEWAAAA2', { type: 'membership', amount: 1000, paidAt: '2026-10-25T05:00:00.000Z', customer: { name: 'New Member' }, metadata: { tierLabel: 'Member' }, ccaVenue: { trackingId: '313000000002', bankReference: '667100000002', paymentMode: 'UPI' } });
  /* the same person and amount as an old-site payment, on another day: a different payment */
  pay('PFA-DON-NEWAAAA3', { type: 'donate', amount: 500, paidAt: '2026-10-26T05:00:00.000Z', customer: { name: 'Same Name' }, metadata: {}, ccaVenue: { trackingId: '313000000003', bankReference: '667100000003', paymentMode: 'UPI' } });
  /* a payment both sites recorded during the switch-over: the old site's
     PFADONMVHHIQRTBBD29B is this one at CCAvenue (same tracking number) */
  pay('PFA-DON-NEWAAAA4', { type: 'donate', amount: 30, paidAt: '2026-10-21T06:00:00.000Z', customer: { name: 'Vipin Mathur' }, metadata: {}, ccaVenue: { trackingId: '313000000099', bankReference: '667100000099', paymentMode: 'UPI' } });
}

/* CCAvenue, as its Order Status API would answer */
const GATEWAY = {
  PFADONMVHV6AZI71BD15: { orderStatus: 'Shipped', amount: '12000.00', trackingId: '313000000010', bankReference: '667100000010' },
  PFADONMVHHIQRTBBD29B: { orderStatus: 'Shipped', amount: '30.00', trackingId: '313000000099', bankReference: '667100000099' },
  PFADONMVG89E18E46112: { orderStatus: 'Successful', amount: '500.00', trackingId: '313000000011', bankReference: '667100000011' },
  PFADONMVBAA6TI127C6D: { orderStatus: 'Shipped', amount: '2500.00', trackingId: '313000000012', bankReference: '667100000012' },
  PFADONOLDAAAAA000001: { orderStatus: 'Shipped', amount: '500.00', trackingId: '313000000013', bankReference: '667100000013' },
  PFADONOLDAAAAA000002: { orderStatus: 'Refunded', amount: '800.00', trackingId: '313000000014', bankReference: '667100000014' },
  PFADONOLDAAAAA000003: { orderStatus: 'Shipped', amount: '100.00', trackingId: '313000000015', bankReference: '667100000015' },
  'PFA-DON-NEWAAAA1': { orderStatus: 'Shipped', amount: '250.00', trackingId: '313000000001', bankReference: '667100000001' },
  'PFA-MEM-NEWAAAA2': { orderStatus: 'Shipped', amount: '1000.00', trackingId: '313000000002', bankReference: '667100000002' },
  'PFA-DON-NEWAAAA3': { orderStatus: 'Shipped', amount: '500.00', trackingId: '313000000003', bankReference: '667100000003' },
  'PFA-DON-NEWAAAA4': { orderStatus: 'Shipped', amount: '30.00', trackingId: '313000000099', bankReference: '667100000099' }
};
const ask = async (orderId) => { if (!GATEWAY[orderId]) throw new Error(`CCAvenue could not report on ${orderId}: no record found.`); return GATEWAY[orderId]; };

function routeWith(extra) {
  const handler = ROUTE.createHandler(Object.assign({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'accounts@pfa.test', role: 'super' }), now: () => NOV1 + 3600000, ask }, extra || {}));
  return (method, { body, query } = {}) => new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = { set statusCode(v) { out.status = v; }, get statusCode() { return out.status; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      end(raw) { out.raw = raw; try { out.json = JSON.parse(String(raw || '{}')); } catch (_) { out.json = null; } resolve(out); } };
    Promise.resolve(handler({ method, url: '/api/admin/finance-report', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}

test('the old site\'s export: its days in October only, nothing personal beyond the name', () => {
  const r = REC.parseOld(OLD_CSV, '2026-10');
  assert.deepEqual(r.rows.map((x) => x.orderId), ['PFADONMVHV6AZI71BD15', 'PFADONMVHHIQRTBBD29B', 'PFADONMVG89E18E46112', 'PFADONMVBAA6TI127C6D', 'PFADONOLDAAAAA000001', 'PFADONOLDAAAAA000002', 'PFADONOLDAAAAA000003']);
  assert.deepEqual(r.skipped.map((x) => x.reason), ['Outside 2026-10-01 to 2026-10-21']);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['amount', 'bankReference', 'currency', 'date', 'head', 'mode', 'name', 'oldMatchedBy', 'orderId', 'paidAtMs', 'purpose', 'reference', 'source', 'status', 'time', 'trackingId']);
  assert.ok(!JSON.stringify(r.rows).includes('@example.com') && !JSON.stringify(r.rows).includes('6289604388'), 'no email or mobile kept');
  assert.deepEqual(r.rows.map((x) => x.head), ['donations', 'donations', 'membership', 'donations', 'donations', 'donations', 'donations']);
  assert.throws(() => REC.parseOld('a,b\n1,2', '2026-10'), /no "date" column/);
});

test('October is held for the old site\'s payments; the schedule does not send it alone', async () => {
  seedOctober();
  const r = await FIN.run({ db, nowMs: NOV1 });
  assert.equal(r.state, 'waiting-old-site');
  assert.equal(sent.length, 0);
  assert.equal((await FIN.run({ db, nowMs: NOV1 + 600000 })).state, 'waiting-old-site');
  const call2 = routeWith();
  const refused = await call2('POST', { body: { action: 'send', month: '2026-10' } });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, 'NEEDS_OLD_SITE');
});

test('each payment once, by gateway identifier; checked with CCAvenue; discrepancies resolved; then sent', async () => {
  seedOctober();
  await FIN.run({ db, nowMs: NOV1 });
  const call2 = routeWith();
  const imported = await call2('POST', { body: { action: 'import', month: '2026-10', csv: OLD_CSV } });
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.equal(imported.json.imported.count, 7);
  /* before CCAvenue is asked: nothing matched yet (the order ids differ), every row "not asked" */
  assert.equal(imported.json.preview.gateway.total, 11);
  assert.equal(imported.json.preview.gateway.left, 11);
  /* asked a few at a time until done */
  let rounds = 0;
  let last;
  do { last = await call2('POST', { body: { action: 'verify', month: '2026-10', limit: 4 } }); rounds += 1; } while (last.json.progress.left && rounds < 10);
  assert.equal(rounds, 3, '11 payments, four at a time');
  const p = last.json.preview;
  const s = p.reconciliation.summary;
  assert.deepEqual(s, { newSite: 4, oldSite: 7, matched: 1, counted: 9, confirmed: 9, unconfirmed: 0, corrected: 1, excluded: 1 });
  /* the switch-over payment: kept once, the new site's record, matched by CCAvenue's tracking number */
  assert.deepEqual(p.reconciliation.matched.map((m) => [m.kept, m.dropped, m.by]), [['PFA-DON-NEWAAAA4', 'PFADONMVHHIQRTBBD29B', 'CCAvenue tracking number']]);
  /* same name and amount on both sites, different payments: both counted, listed */
  assert.deepEqual(p.reconciliation.lookalikes, []);
  assert.equal(p.heads[0].count, 7, 'seven donations: four old and three new, the switch-over payment once, the refund out');
  assert.match(p.reconciliation.excluded[0].reason, /CCAvenue: Refunded/);
  assert.deepEqual(p.reconciliation.corrected.map((x) => [x.orderId, x.recorded, x.gateway]), [['PFADONOLDAAAAA000003', 1000, 100]]);
  /* totals: by the gateway's word */
  assert.equal(p.totalText, 'INR 17,380.00');
  /* send it */
  const out = await call2('POST', { body: { action: 'send', month: '2026-10' } });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'gandhim@exmpls.sansad.in');
  assert.equal(m.cc, 'pfadcmho@gmail.com, ozairhusain@gmail.com');
  assert.match(m.subject, /October 2026 \(9 payments, INR 17,380\.00\)/);
  assert.ok(m.html.includes('How this month was reconciled'));
  assert.ok(m.html.includes('PFADONMVHHIQRTBBD29B (old site) is PFA-DON-NEWAAAA4: same CCAvenue tracking number'));
  const csv = m.attachments[0].content.toString('utf8');
  assert.match(csv, /"Recorded on both sites, counted once \(matched by gateway identifier\)",1/);
  assert.match(csv, /Left out: CCAvenue says not successful,1/);
  assert.match(csv, /Grand total,9 payments,,,,INR,17380\.00/);
  assert.equal((csv.match(/PFADONMVHHIQRTBBD29B/g) || []).length, 1, 'the matched old record appears only in the reconciliation');
  assert.ok(/Old site,confirmed/.test(csv) && /New site,confirmed/.test(csv));
  /* and the schedule does not send October again */
  assert.equal((await FIN.run({ db, nowMs: NOV1 + 7200000 })).state, 'already');
  assert.equal(sent.length, 1);
});

test('never merged on name or amount alone: two real payments that look alike are both counted', () => {
  const a = { source: 'old', head: 'donations', date: '2026-10-21', time: '', paidAtMs: 1, name: 'Asha', purpose: 'x', amount: 500, currency: 'INR', orderId: 'PFADONOLDZZZZZZ00001', trackingId: '', bankReference: '' };
  const b = { source: 'new', head: 'donations', date: '2026-10-21', time: '10:00', paidAtMs: 2, name: 'Asha', purpose: 'x', amount: 500, currency: 'INR', orderId: 'PFA-DON-ZZZZZZZ1', trackingId: '313000000555', bankReference: '667100000555' };
  const r = REC.reconcile([b], [a], {});
  assert.equal(r.rows.length, 2);
  assert.equal(r.summary.matched, 0);
  assert.equal(r.lookalikes.length, 1, 'listed for a look, not merged');
  /* the same gateway reference makes them one, whatever the name */
  const r2 = REC.reconcile([b], [Object.assign({}, a, { name: 'A. Rao', bankReference: '667100000555' })], {});
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.matched[0].by, 'bank reference');
  /* a placeholder reference never matches anything */
  const r3 = REC.reconcile([Object.assign({}, b, { bankReference: 'NA', trackingId: '' })], [Object.assign({}, a, { bankReference: 'NA' })], {});
  assert.equal(r3.rows.length, 2);
});

test('CCAvenue not reachable: counted as recorded, said plainly, never dropped', async () => {
  seedOctober();
  const call2 = routeWith({ ask: async () => { throw new Error('CCAvenue\'s status service did not answer in time.'); } });
  await call2('POST', { body: { action: 'import', month: '2026-10', csv: OLD_CSV } });
  const v = await call2('POST', { body: { action: 'verify', month: '2026-10', limit: 12 } });
  assert.equal(v.json.progress.left, 11, 'unreachable is asked again next time');
  const p = (await call2('GET', { query: { month: '2026-10', view: 'reconcile' } })).json.preview;
  assert.equal(p.reconciliation.summary.unconfirmed, 11);
  assert.equal(p.reconciliation.summary.counted, 11, 'nothing dropped for want of an answer');
});

test('Payments opens on the paid ones; the rest only when chosen', () => {
  const html = read('admin.html');
  assert.match(html, /<select id="payStatus" aria-label="Outcome">\s*<option value="paid" selected>Paid<\/option><option value="">Every outcome<\/option>/);
});
