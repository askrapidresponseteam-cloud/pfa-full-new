'use strict';

/* Monthly giving (owner, 15 Nov 2026: "Implement the recurring
   donation/payment journey with a separate admin toggle for visitor
   visibility. When recurring donations are disabled, show the regular
   one-time donation journey").

   A monthly donation is a CCAvenue standing instruction of the fixed kind:
   the first month is the order itself, and CCAvenue takes the same amount
   each month after. The panel's donate#monthly decides whether it is
   offered at all; /api/payment/create refuses a monthly request while it is
   off, and never sends the standing-instruction fields for a donation given
   once. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const caregiverMail = require('../lib/caregiver-mail');
const C = require('../lib/ccavenue');
const PAY = require('../lib/payment');
const create = require('../lib/routes/payment/create');

const ROOT = path.join(__dirname, '..');
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const DONOR = { type: 'donate', currency: 'inr', amount: '1000', terms: 'yes', cause: 'Rescue', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };
const ENV = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PUBLIC_SITE_URL', 'CCAVENUE_SI_MONTHS', 'CCAVENUE_SI_DATE_FORMAT'];
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
  delete process.env.CCAVENUE_SI_MONTHS;
  delete process.env.CCAVENUE_SI_DATE_FORMAT;
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
  create.deps = undefined;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {}, end(raw) { out.raw = String(raw || ''); resolve(out); } };
    Promise.resolve(handler({ method: 'POST', url: '/api', query: {}, body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) } }, response)).catch(reject);
  });
}
const monthly = (on) => { create.deps = { publicState: async () => ({ choices: { 'donate#monthly': on ? 'on' : 'off' } }) }; };
function sentToBank(res) {
  const m = /name="encRequest" value="([0-9a-f]+)"/.exec(res.raw);
  return m ? C.decodeMerchantData(C.decrypt(m[1], KEY)) : null;
}

test('the standing instruction: fixed, every month from the same day next month, PFA\'s order ID as its reference', () => {
  const si = PAY.standingInstruction({ amount: '1000.00', orderId: 'PFA-DON-AB12CD34', now: Date.UTC(2026, 10, 15) });
  assert.deepEqual(si, {
    si_type: 'Fixed', si_mer_ref_no: 'PFA-DON-AB12CD34', si_setup_amount: '1000.00', si_amount: '1000.00',
    si_frequency: 'Month', si_frequency_no: '1', si_billing_cycle: '60', si_start_date: '15-12-2026'
  });
  assert.equal(PAY.standingInstruction({ amount: '1', orderId: 'X', now: Date.UTC(2026, 0, 31) }).si_start_date, '28-02-2026', 'the 31st falls back to the last day of a short month');
  assert.equal(PAY.standingInstruction({ amount: '1', orderId: 'X', now: Date.UTC(2026, 11, 20) }).si_start_date, '20-01-2027', 'across the year');
  const env = { CCAVENUE_SI_MONTHS: '24', CCAVENUE_SI_DATE_FORMAT: 'YYYY-MM-DD' };
  const tuned = PAY.standingInstruction({ amount: '1', orderId: 'X', now: Date.UTC(2026, 10, 15), env });
  assert.equal(tuned.si_billing_cycle, '24');
  assert.equal(tuned.si_start_date, '2026-12-15', 'the date format CCAvenue confirms is set without a code change');
  assert.equal(PAY.standingInstruction({ amount: '1', orderId: 'X', now: Date.UTC(2026, 10, 15), env: { CCAVENUE_SI_DATE_FORMAT: '"><script>' } }).si_start_date, '15-12-2026', 'anything odd falls back');
});

test('a monthly donation is rupees only, never a gift, and once is the default', () => {
  assert.equal(PAY.parsePaymentRequest(DONOR).recurring, false);
  assert.equal(PAY.parsePaymentRequest({ ...DONOR, frequency: 'weekly' }).recurring, false, 'anything but monthly is once');
  const m = PAY.parsePaymentRequest({ ...DONOR, frequency: 'monthly' });
  assert.equal(m.recurring, true);
  assert.equal(m.metadata.frequency, 'monthly');
  assert.equal(m.merchantValues.merchant_param2, 'PFA Monthly Donation');
  assert.throws(() => PAY.parsePaymentRequest({ ...DONOR, frequency: 'monthly', currency: 'usd' }), /rupees/);
  assert.throws(() => PAY.parsePaymentRequest({ ...DONOR, amount: '2000', frequency: 'monthly', gift: 'yes', giftTo: 'Meera Rao', giftAddress: '1 Park Street, Kolkata', giftPin: '700016' }), /single payment|gift/);
});

test('while monthly is off, a monthly request is refused and nothing is charged; a donation given once goes as before', async () => {
  monthly(false);
  const refused = await call(create, { ...DONOR, frequency: 'monthly', client_ref: 'm-off' });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.raw, /Monthly donations are not open just now/);
  assert.equal(sentToBank(refused), null, 'nothing went to CCAvenue');
  assert.equal(Object.keys(db.dump()).filter((k) => k.startsWith('transactions/')).length, 0, 'and no transaction was opened');

  const once = sentToBank(await call(create, { ...DONOR, client_ref: 'once-1' }));
  assert.ok(once.order_id);
  assert.equal(once.si_type, undefined, 'no standing instruction on a donation given once');
  assert.equal(once.merchant_param2, 'PFA Donation');
});

test('while monthly is on, the bank is sent the standing instruction for the same amount, and the callback records it', async () => {
  monthly(true);
  const bank = sentToBank(await call(create, { ...DONOR, frequency: 'monthly', client_ref: 'm-on' }));
  assert.equal(bank.si_type, 'Fixed');
  assert.equal(bank.si_amount, bank.amount);
  assert.equal(bank.si_setup_amount, bank.amount, 'the first month is the payment made now');
  assert.equal(bank.si_mer_ref_no, bank.order_id);
  assert.equal(bank.si_frequency, 'Month');
  assert.match(bank.si_start_date, /^\d{2}-\d{2}-\d{4}$/);
  const stored = db.dump()[`transactions/${bank.order_id}`];
  assert.equal(stored.metadata.frequency, 'monthly');

  const back = { order_id: bank.order_id, merchant_id: '123456', amount: bank.amount, currency: 'INR', order_status: 'Success', tracking_id: '41', bank_ref_no: 'B9', payment_mode: 'Credit Card', si_created: 'Y', si_ref_no: 'SI000123', si_status: '0' };
  const page = await call(require('../lib/routes/payment/response'), { encResp: C.encrypt(C.encodeMerchantData(back), KEY) });
  const tx = db.dump()[`transactions/${bank.order_id}`];
  assert.equal(tx.status, 'success');
  assert.deepEqual(tx.ccaVenue.standingInstruction, { created: true, reference: 'SI000123', status: '0', error: '' });
  assert.match(page.raw, /Every month/, 'the page says it is the first month');
  const receipt = sent.find((m) => m.template === 'payment_received');
  assert.ok(receipt, 'the receipt went');
  assert.equal(receipt.payload.monthly, true);
  const letter = caregiverMail.TEMPLATES.payment_received(receipt.payload);
  assert.match(letter.text, /Every month: this is the first month/);
  assert.match(letter.text, /Reply to this email any time to stop it/);
  assert.doesNotMatch(caregiverMail.TEMPLATES.payment_received({ ...receipt.payload, monthly: false }).text, /Every month/, 'a donation given once says nothing of it');

  const R = require('../lib/routes/admin/records')._private || {};
  if (R.paymentRow) {
    const row = R.paymentRow(bank.order_id, tx);
    assert.equal(row.monthly, true);
    assert.equal(row.mandate, 'set up');
  }
});

test('donate.html shows Give monthly only while the panel has it on, and never for a gift', () => {
  const html = fs.readFileSync(path.join(ROOT, 'donate.html'), 'utf8');
  assert.doesNotMatch(html, /MONTHLY_MANDATE_LIVE/, 'no constant to flip by hand any more');
  assert.match(html, /function monthlyOn\(\)\{ return document\.documentElement\.getAttribute\('data-choice-monthly'\) === 'on'; \}/);
  assert.match(html, /<input type="hidden" name="frequency" id="gFreq" value="once">/);
  assert.match(html, /var monthly = freq === 'monthly' && !gift && monthlyOn\(\);/);
  assert.match(html, /attributeFilter: \['data-choice-monthly'\]/, 'it follows the panel without a reload');

  /* the page itself, both ways */
  for (const on of [false, true]) {
    const page = html.replace(/<script[^>]+src=[^>]*><\/script>/g, '').replace(/<html([^>]*)>/, on ? '<html$1 data-choice-monthly="on">' : '<html$1>');
    const dom = new JSDOM(page, { runScripts: 'dangerously', url: 'https://pfa.test/donate.html', pretendToBeVisual: true, beforeParse(w) { w.scrollTo = () => {}; } });
    const d = dom.window.document;
    const seg = d.querySelector('[data-freq="monthly"]').parentNode;
    assert.equal(seg.hidden, !on, on ? 'monthly offered' : 'one-time only');
    if (on) {
      d.querySelector('[data-freq="monthly"]').click();
      assert.match(d.getElementById('payBtn').textContent, /monthly/);
      d.documentElement.setAttribute('data-choice-monthly', 'off');
    }
    dom.window.close();
  }
});
