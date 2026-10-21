'use strict';

/* One payment, one record, one number (8 Oct 2026, reviews D2 and B3).

   CCAvenue delivers a callback more than once, a donor refreshes, and the
   Vercel and Firebase servers can both answer the same callback at the same
   moment against the one Firestore. Before this, the second callback read
   the payment before the first had written its number and minted another:
   two PFA-DON (or PFA-MEM, or PFA-CG) records for one payment, the member
   shown two different numbers, the ID photo copied into both.

   The in-memory Firestore runs with latency, so the callbacks fired together
   here really do overlap, and its transactions are version-checked as
   Firestore's are. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const caregiverMail = require('../lib/caregiver-mail');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const YEAR = new Date().getUTCFullYear();
const PHOTO = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'media/cinekind-2026/reels/glimpse.jpg')).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };
const DONOR = { type: 'donate', currency: 'inr', amount: '1500', terms: 'yes', cause: 'Where it is needed most', pan: 'ABCDE1234F', ...PERSON };
const MEMBER = { type: 'membership', tier: 'silver', terms: 'yes', ...PERSON };

let db;
let sent;
const realDeliver = caregiverMail.deliver;
const realConfigured = caregiverMail.isConfigured;

test.beforeEach(() => {
  db = memoryFirestore({ latency: 3 });
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
});

function call(handler, { body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { /* a page */ } resolve(out); }
    };
    const request = { method: 'POST', url: '/api', body, headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '203.0.113.9' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function handoff(form) {
  const res = await call(require('../lib/routes/payment/create'), { body: form });
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(res.raw);
  assert.ok(enc, res.raw.slice(0, 300));
  return decodeMerchantData(decrypt(enc[1], KEY));
}

function callback(out) {
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI' };
  return call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), KEY) } });
}

const records = (kind) => Object.entries(db.dump())
  .filter(([k, v]) => /^submissions\/[^/]+$/.test(k) && v.kind === kind)
  .map(([k]) => k.split('/')[1]);
const numbersOn = (page, kind) => [...new Set(page.match(new RegExp(`${kind}-\\d{4}-\\d{5}`, 'g')) || [])];
const counter = (kind) => (db.dump()['counters/submissions'] || {})[`${kind}-${YEAR}`];

test('a donation: two copies of the success callback at once file one record under one number', async () => {
  const out = await handoff(DONOR);
  const pages = await Promise.all([callback(out), callback(out)]);
  pages.forEach((p) => assert.match(p.raw, /Donation successful/));
  const recs = records('PFA-DON');
  assert.deepEqual(recs, [`PFA-DON-${YEAR}-00001`], 'one record for one payment');
  assert.equal(counter('PFA-DON'), 1, 'no number was minted and thrown away');
  assert.equal(db.dump()[`transactions/${out.order_id}`].donationReference, recs[0]);
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'one receipt');
  assert.equal(sent.filter((m) => m.template === 'submission_forward').length, 2, 'one copy to each payments inbox, once');
});

test('a membership: both pages show the same member number, and there is one member', async () => {
  const out = await handoff(MEMBER);
  const pages = await Promise.all([callback(out), callback(out)]);
  const recs = records('PFA-MEM');
  assert.deepEqual(recs, [`PFA-MEM-${YEAR}-00001`]);
  for (const page of pages) assert.deepEqual(numbersOn(page.raw, 'PFA-MEM'), recs, 'each page shows the one number');
  /* and a later visit (a refresh) shows it too */
  const later = await callback(out);
  assert.deepEqual(numbersOn(later.raw, 'PFA-MEM'), recs);
  assert.equal(counter('PFA-MEM'), 1);
  assert.equal(sent.filter((m) => m.template === 'membership_welcome').length, 1, 'one welcome letter');
});

test('a caregiver application: one record, one number, the photograph copied once', async () => {
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO }, headers: { 'content-type': 'application/json' } });
  assert.equal(docs.statusCode, 200, docs.raw.slice(0, 200));
  const token = docs.json.token;
  const out = await handoff({ type: 'caregiver-application', documents: token, animals: '12', ...PERSON });
  const pages = await Promise.all([callback(out), callback(out)]);
  const recs = records('PFA-CG');
  assert.deepEqual(recs, [`PFA-CG-${YEAR}-00001`]);
  for (const page of pages) assert.deepEqual(numbersOn(page.raw, 'PFA-CG'), recs);
  const dump = db.dump();
  const record = dump[`submissions/${recs[0]}`];
  assert.equal(record.attachments, 1);
  assert.equal(record.photoPending, false);
  assert.deepEqual(Object.keys(dump).filter((k) => /^submissions\/[^/]+\/attachments\//.test(k)), [`submissions/${recs[0]}/attachments/1`], 'one copy of the photograph, beside the one record');
  assert.equal(dump[`caregiverDocuments/${token}`].movedTo, recs[0]);
  assert.equal(dump[`transactions/${out.order_id}`].applicationReference, recs[0]);
  assert.equal(record.threadId, dump[`transactions/${out.order_id}`].threadId, 'the record and the payment name one conversation');
});

for (const [label, form, kind] of [['membership', MEMBER, 'PFA-MEM'], ['donation', DONOR, 'PFA-DON']]) {
  test(`a ${label}: a redelivery while the first callback is still writing does not mint a second number`, async () => {
    const out = await handoff(form);
    /* the first writer is slow at the record write (a cold instance) */
    const original = db.collection;
    let slowed = false;
    db.collection = (name) => {
      const c = original(name);
      if (name !== 'submissions') return c;
      const doc = c.doc;
      c.doc = (id) => { const d = doc(id); const create = d.create; d.create = async (v) => { if (!slowed) { slowed = true; await sleep(250); } return create(v); }; return d; };
      return c;
    };
    const first = callback(out);
    await sleep(80);
    const second = callback(out);
    await Promise.all([first, second]);
    db.collection = original;
    assert.equal(records(kind).length, 1, `${label}: one record for one payment`);
    assert.equal(counter(kind), 1);
  });
}
