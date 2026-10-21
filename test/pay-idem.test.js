'use strict';

/* The idempotency key of a payment request (8 Oct 2026, reviews D7 and D8).

   D7: donate.html built its key from the amount and the gift recipient's
   name only, and the server handed back the stored transaction for a known
   key without looking at what it held. A donor who came back from CCAvenue
   and corrected their email, PAN or the gift address paid on the OLD
   transaction: the receipt, the 80G PAN and the certificate address used the
   old details. A currency switch under the same key was refused with a 409.
   Now the page's key covers every detail that matters, and the server
   compares the stored request with the new one and starts a fresh
   transaction when they differ.

   D8: the caregiver order and replacement routes ignored the transaction
   createTransaction returned, so a second attempt under the same clientRef
   sent CCAvenue a new order id that was never recorded, and the payment for
   it was refused on the way back. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const caregiverMail = require('../lib/caregiver-mail');
const CAREGIVER = require('../lib/caregiver');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const USD_KEY = 'ZYXWVUTSRQPONMLKJIHGFEDCBA654321';

let db;
let sent;
const realDeliver = caregiverMail.deliver;
const realConfigured = caregiverMail.isConfigured;

test.beforeEach(() => {
  db = memoryFirestore({ latency: 1 });
  firebase._setDbForTests(db);
  sent = [];
  caregiverMail.deliver = async (m) => { sent.push(m); return { providerId: `p${sent.length}` }; };
  caregiverMail.isConfigured = () => true;
  Object.assign(process.env, {
    CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: KEY,
    CCAVENUE_USD_ACCESS_CODE: 'AVUSD', CCAVENUE_USD_WORKING_KEY: USD_KEY,
    CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test'
  });
});

test.afterEach(() => {
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
  delete process.env.CCAVENUE_USD_ACCESS_CODE;
  delete process.env.CCAVENUE_USD_WORKING_KEY;
});

function call(handler, { body, url = '/api' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {},
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { /* a page */ } resolve(out); }
    };
    Promise.resolve(handler({ method: 'POST', url, query: {}, body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.4' } }, response)).catch(reject);
  });
}

async function handoff(handler, body, key = KEY) {
  const res = await call(handler, { body });
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(res.raw);
  assert.ok(enc, `${res.statusCode} ${res.raw.slice(0, 300)}`);
  return decodeMerchantData(decrypt(enc[1], key));
}

function callback(out, { url = '/api/payment/response', key = KEY, currency = 'INR' } = {}) {
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency, order_status: 'Success', tracking_id: '1', bank_ref_no: 'B', payment_mode: 'UPI' };
  return call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), key) }, url });
}

const create = () => require('../lib/routes/payment/create');
const GIFT = {
  type: 'donate', currency: 'inr', amount: '2500', terms: 'yes', name: 'Asha Kumar', mobile: '9876543210', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101',
  gift: 'yes', giftTo: 'Ravi Menon', giftPin: '560038', client_ref: 'gift-VISIT-abc'
};

test('D7: a donor who corrects their email, PAN and the gift address under the same key pays a fresh transaction carrying the corrections', async () => {
  const first = await handoff(create(), { ...GIFT, email: 'asha@exmaple.com', pan: 'ABCDE1234F', giftAddress: '12 Lake View Road, Indiranagar, Bengaluru' });
  const fixed = await handoff(create(), { ...GIFT, email: 'asha@example.com', pan: 'ABCDE9999Z', giftAddress: '99 New Road, Koramangala, Bengaluru' });
  assert.notEqual(fixed.order_id, first.order_id, 'the transaction with the old details is not reused');
  assert.equal(fixed.billing_email, 'asha@example.com');

  await callback(fixed);
  const t = db.dump()[`transactions/${fixed.order_id}`];
  const record = db.dump()[`submissions/${t.donationReference}`];
  assert.equal(record.fields.giftAddress, '99 New Road, Koramangala, Bengaluru, 560038', 'the certificate goes to the corrected address');
  assert.equal(record.fields.pan, 'ABCDE9999Z', 'the 80G PAN is the corrected one');
  assert.equal(sent.find((m) => m.template === 'payment_received').to, 'asha@example.com', 'and so is the receipt');
  assert.equal(db.dump()[`transactions/${first.order_id}`].status, 'initiated', 'the first transaction stays on record, untouched');
});

test('D7: the same request posted twice is still one transaction, and a paid one is not paid twice', async () => {
  const form = { ...GIFT, email: 'asha@example.com', giftAddress: '12 Lake View Road, Indiranagar, Bengaluru' };
  const a = await handoff(create(), form);
  const b = await handoff(create(), form);
  assert.equal(a.order_id, b.order_id, 'a double submit is one transaction');
  await callback(a);
  const again = await call(create(), { body: form });
  assert.equal(again.statusCode, 409);
  assert.match(again.raw, /already completed/);
});

test('D7: switching currency under the same key is a new transaction, not a 409', async () => {
  const base = { type: 'donate', amount: '50', terms: 'yes', name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', client_ref: 'donate-VISIT-xyz' };
  const rupees = await handoff(create(), { ...base, currency: 'inr' });
  const res = await call(create(), { body: { ...base, currency: 'usd' } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  const dollars = decodeMerchantData(decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(res.raw)[1], USD_KEY));
  assert.notEqual(dollars.order_id, rupees.order_id);
  assert.equal(dollars.currency, 'USD');
  assert.equal(db.dump()[`transactions/${dollars.order_id}`].currency, 'USD');
});

test('D7: donate.html makes a new key when any detail that matters changes, and the same key when nothing does', () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'donate.html'), 'utf8');
  const quiet = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://pfa.test/donate.html', virtualConsole: quiet,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.scrollTo = () => {};
    }
  });
  const d = dom.window.document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  const key = () => {
    d.getElementById('giveForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    return d.getElementById('gRef').value;
  };
  set('gName', 'Asha Kumar'); set('gMobile', '9876543210'); set('gEmail', 'asha@exmaple.com'); set('gAddress', '16 MG Road, Udupi'); set('gPan', 'ABCDE1234F');
  set('gCity', 'Udupi'); set('gPin', '576101');
  const st = d.getElementById('gState');
  for (const name of ['Karnataka', 'Kerala']) if (![...st.options].some((o) => o.value === name)) st.add(new dom.window.Option(name, name));
  st.value = 'Karnataka';
  d.getElementById('gAgree').checked = true;
  const first = key();
  assert.match(first, /^donate-/);
  assert.equal(key(), first, 'pressing Pay again unchanged is the same request');
  for (const [id, value] of [['gEmail', 'asha@example.com'], ['gPan', 'ABCDE9999Z'], ['gAddress', '22 Car Street, Udupi'], ['gName', 'Asha K Rao'], ['gMobile', '9123456780'], ['gCity', 'Kundapura'], ['gPin', '576201'], ['gState', 'Kerala']]) {
    const before = key();
    set(id, value);
    assert.notEqual(key(), before, `changing ${id} is a new key`);
  }
});

/* ---- D8: the caregiver card's printed copy and its replacement ---------- */

async function card() {
  await db.collection('caretakerCards').doc('PFA-CCT-ABCD2345').set({
    cardId: 'PFA-CCT-ABCD2345', name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Udupi', pin: '576101',
    status: 'active', addressId: 'PFA-ADR-1', tokenHash: CAREGIVER.hashToken('card-token-1')
  });
}

const orders = () => Object.keys(db.dump()).filter((k) => k.startsWith('caretakerOrders/'));

test('D8: a replacement tried twice under one clientRef sends CCAvenue the order on record, and its payment is accepted', async () => {
  await card();
  const body = { stage: 'pay', cardId: 'PFA-CCT-ABCD2345', mobile: '9876543210', clientRef: 'LC-visit-1-SHIP' };
  const replace = require('../lib/routes/caregiver/replace');
  const a = await handoff(replace, body);
  const b = await handoff(replace, body);
  assert.equal(b.order_id, a.order_id, 'the second attempt pays the first attempt\'s order');
  assert.ok(db.dump()[`transactions/${b.order_id}`], 'and that order is on record');
  assert.deepEqual(orders(), [`caretakerOrders/${a.order_id}`], 'no parcel order under an id nobody pays');
  const page = await callback(b);
  assert.match(page.raw, /successful/, page.raw.slice(0, 300));
  assert.doesNotMatch(page.raw, /Payment response unavailable/);
  assert.equal(db.dump()[`transactions/${b.order_id}`].status, 'success');
});

test('D8: the printed card ordered twice under one clientRef is one order, paid once', async () => {
  await card();
  const body = { cardId: 'PFA-CCT-ABCD2345', cardToken: 'card-token-1', clientRef: 'CC-visit-1-PRINT' };
  const order = require('../lib/routes/caregiver/order');
  const a = await handoff(order, body);
  const b = await handoff(order, body);
  assert.equal(b.order_id, a.order_id);
  assert.deepEqual(orders(), [`caretakerOrders/${a.order_id}`], 'one parcel order on record, under the id CCAvenue is paid for');
  const page = await callback(b);
  assert.match(page.raw, /successful/);
  assert.equal(db.dump()[`transactions/${a.order_id}`].status, 'success');
});
