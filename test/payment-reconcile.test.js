'use strict';

/* Payments settle on their own (lib/payment-reconcile.js).

   Owner, 21 Oct 2026, of the panel's Pending payments listing payments
   still "Started" and "Unverified": "payment success to be recorded
   properly like done for https://pfa-oldsite.web.app/". A payer who closes
   the tab on the bank's page after paying sends no callback; the site now
   asks CCAvenue itself, every ten minutes on Firebase (by the email
   worker), and records what went through exactly as the callback would
   have. CCAvenue's Order Status API is stubbed: nothing here reaches it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Timestamp } = require('firebase-admin/firestore');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const caregiverMail = require('../lib/caregiver-mail');
const { encrypt, decrypt, decodeMerchantData } = require('../lib/ccavenue');
const R = require('../lib/payment-reconcile');

const ROOT = path.join(__dirname, '..');
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };
const DONOR = { type: 'donate', currency: 'inr', amount: '1500', terms: 'yes', cause: 'Where it is needed most', ...PERSON };
const ENV = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PUBLIC_SITE_URL'];
const saved = {};
let db;
let sent;
const realDeliver = caregiverMail.deliver;
const realConfigured = caregiverMail.isConfigured;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  db = memoryFirestore({ latency: 1 });
  firebase._setDbForTests(db);
  sent = [];
  caregiverMail.deliver = async (m) => { sent.push(m); return { providerId: `p${sent.length}` }; };
  caregiverMail.isConfigured = () => true;
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test' });
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {}, end(raw) { out.raw = String(raw || ''); resolve(out); } };
    Promise.resolve(handler({ method: 'POST', url: '/api', query: {}, body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) } }, response)).catch(reject);
  });
}
async function started(form) {
  const res = await call(require('../lib/routes/payment/create'), form);
  return decodeMerchantData(decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(res.raw)[1], KEY));
}
const age = (orderId, minutes) => db.collection('transactions').doc(orderId).update({ createdAt: Timestamp.fromMillis(Date.now() - minutes * 60000) });
const tx = (orderId) => db.dump()[`transactions/${orderId}`];
const records = (kind) => Object.entries(db.dump()).filter(([k, v]) => /^submissions\/[^/]+$/.test(k) && v.kind === kind);

/* CCAvenue's Order Status API: answer(orderNo) gives the result for that order */
function statusApi(answer) {
  const asked = [];
  const fetch = async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(init.body));
    const order = JSON.parse(decrypt(form.enc_request, KEY)).order_no;
    asked.push(order);
    const payload = Object.assign({ status: 0, error_desc: '', error_code: '' }, answer(order));
    return { ok: true, status: 200, text: async () => `status=0&enc_response=${encrypt(JSON.stringify(payload), KEY)}` };
  };
  return { asked, fetch };
}
const paid = (o) => ({ order_no: o.order_id, order_status: 'Successful', order_amt: o.amount, order_currncy: 'INR', reference_no: '310009876543', order_bank_ref_no: 'BNK77', order_option_type: 'OPTUPI' });

test('a payment whose callback never came is recorded on the next run, receipt and all, and only once', async () => {
  const out = await started(DONOR);
  await age(out.order_id, 20);
  const api = statusApi(() => paid(out));
  const first = await R.run({ fetch: api.fetch });
  assert.equal(first.configured, true);
  assert.deepEqual(api.asked, [out.order_id]);
  assert.equal(first.settled, 1);
  assert.equal(tx(out.order_id).status, 'success', 'recorded as paid');
  assert.equal(tx(out.order_id).ccaVenue.trackingId, '310009876543');
  assert.equal(records('PFA-DON').length, 1, 'the donation is on record in the panel');
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'the donor is sent the receipt');
  const second = await R.run({ fetch: api.fetch, now: () => Date.now() + 60 * 60000 });
  assert.equal(second.looked, 0, 'a settled payment is not asked about again');
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'and the receipt is never sent twice');
});

test('a payment still on the bank\'s page is left alone, and asked again only after half an hour', async () => {
  const fresh = await started(DONOR);
  await age(fresh.order_id, 5);
  const busy = await started({ ...DONOR, amount: '500' });
  await age(busy.order_id, 20);
  const api = statusApi(() => ({ order_status: 'Initiated', order_amt: '500' }));
  const run1 = await R.run({ fetch: api.fetch });
  assert.deepEqual(api.asked, [busy.order_id], 'five minutes old is not asked about yet');
  assert.equal(run1.waiting, 1);
  assert.equal(tx(busy.order_id).status, 'initiated', 'an answer that is not final changes nothing');
  await R.run({ fetch: api.fetch, now: () => Date.now() + 10 * 60000 });
  assert.equal(api.asked.filter((o) => o === busy.order_id).length, 1, 'not asked again ten minutes on');
  await R.run({ fetch: api.fetch, now: () => Date.now() + 31 * 60000 });
  assert.equal(api.asked.filter((o) => o === busy.order_id).length, 2, 'asked again after thirty');
});

test('a checkout CCAvenue has no record of is marked abandoned after two hours, leaves the waiting list, and can still be paid late', async () => {
  const young = await started(DONOR);
  await age(young.order_id, 60);
  const old = await started({ ...DONOR, amount: '700' });
  await age(old.order_id, 180);
  const api = statusApi(() => ({ status: 1, error_desc: 'No Records Found', error_code: '51419' }));
  const ran = await R.run({ fetch: api.fetch });
  assert.equal(ran.abandoned, 1);
  assert.equal(tx(old.order_id).abandoned, true);
  assert.equal(tx(old.order_id).status, 'initiated', 'its status is left as it was');
  assert.ok(!tx(young.order_id).abandoned, 'an hour is too soon to call it abandoned');
  const PP = require('../lib/routes/admin/payments-pending')._private;
  const waiting = await PP.listPending(db, Date.now(), 14);
  assert.ok(!waiting.some((r) => r.orderId === old.order_id), 'an abandoned checkout is not listed as waiting');
  assert.ok(waiting.some((r) => r.orderId === young.order_id));
  /* a callback that arrives anyway still settles it */
  const C = require('../lib/ccavenue');
  const bank = { order_id: old.order_id, merchant_id: '123456', amount: old.amount, currency: 'INR', order_status: 'Success', tracking_id: '31', bank_ref_no: 'B1', payment_mode: 'UPI' };
  await call(require('../lib/routes/payment/response'), { encResp: C.encrypt(C.encodeMerchantData(bank), KEY) });
  assert.equal(tx(old.order_id).status, 'success');
});

test('a payment this site refused (Unverified) is settled when CCAvenue says it went through', async () => {
  const out = await started(DONOR);
  await age(out.order_id, 40);
  await db.collection('transactions').doc(out.order_id).update({ status: 'verification_failed' });
  const api = statusApi(() => paid(out));
  const ran = await R.run({ fetch: api.fetch });
  assert.equal(ran.settled, 1);
  assert.equal(tx(out.order_id).status, 'success');
  assert.equal(records('PFA-DON').length, 1);
});

test('without the CCAvenue keys on the server it does nothing and says so; a run asks at most its limit', async () => {
  delete process.env.CCAVENUE_ACCESS_CODE;
  const out = await started(DONOR).catch(() => null);
  const api = statusApi(() => ({}));
  const off = await R.run({ fetch: api.fetch });
  assert.equal(off.configured, false);
  assert.equal(api.asked.length, 0);
  process.env.CCAVENUE_ACCESS_CODE = 'AVXX';
  for (let i = 0; i < 4; i += 1) { const o = await started({ ...DONOR, amount: String(100 + i) }); await age(o.order_id, 30); }
  const capped = await R.run({ fetch: statusApi(() => ({ order_status: 'Awaited' })).fetch, limit: 3 });
  assert.equal(capped.asked, 3);
  assert.ok(out === null || out.order_id);
});

test('it runs where it should: from the email worker, which Firebase calls every ten minutes and Vercel once a day', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'lib/routes/caregiver/email-worker.js'), 'utf8');
  assert.match(worker, /require\('\.\.\/\.\.\/payment-reconcile'\)\.run\(\)/);
  assert.ok(worker.indexOf("payment-reconcile") < worker.indexOf('if (!mail.isConfigured())'), 'before the mail check: a payment is recorded whether or not mail is set up');
  const fn = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  assert.match(fn, /exports\.caregiverEmailWorker = onSchedule\(\s*\{ region: REGION, schedule: 'every 10 minutes'/);
  assert.match(fn, /require\('\.\/lib\/routes\/caregiver\/email-worker\.js'\)/);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/caregiver/email-worker'));
});
