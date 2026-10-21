'use strict';

/* A payment is never lost to a Firestore outage or a callback that never
   came (8 Oct 2026, review D3).

   1. The payment callback writes what CCAvenue said (order id, status,
      amount, currency, tracking id, bank reference, failure message) to the
      error log before it touches Firestore. It used to log only the
      Firestore error: a real payment left no trace at all.
   2. /api/admin/payments-pending lists payments still initiated or pending
      half an hour on, asks CCAvenue's Order Status API about one, and applies
      a final answer through the callback's own settle path. fetch is stubbed:
      nothing here reaches CCAvenue. */

/* The panel's sign-in, stood in for: "test-admin" is a super administrator.
   Installed before anything loads firebase-admin/auth. */
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Timestamp } = require('firebase-admin/firestore');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const FILES = require('../lib/file-store');
const backend = require('../lib/shop-backend');
const caregiverMail = require('../lib/caregiver-mail');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const YEAR = new Date().getUTCFullYear();
const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };
const DONOR = { type: 'donate', currency: 'inr', amount: '1500', terms: 'yes', cause: 'Where it is needed most', ...PERSON };
const ADMIN = { authorization: 'Bearer test-admin' };
const CCA_ENV = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PUBLIC_SITE_URL'];

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
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test' });
});

test.afterEach(() => {
  FILES._reset();
  backend.use(null);
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
});

function call(handler, { method = 'POST', body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {},
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { /* a page */ } resolve(out); }
    };
    Promise.resolve(handler({ method, url: '/api', query: {}, body, headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '203.0.113.5' }, headers) }, response)).catch(reject);
  });
}

async function handoff(form) {
  const res = await call(require('../lib/routes/payment/create'), { body: form });
  return decodeMerchantData(decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(res.raw)[1], KEY));
}

function callback(out, over) {
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '310009876543', bank_ref_no: 'BNK77', payment_mode: 'UPI', ...(over || {}) };
  return call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), KEY) } });
}

/* CCAvenue's Order Status API, answering as it does: form-encoded, status=0,
   the JSON result encrypted with the working key. Records what it was asked. */
function statusApi(result) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, form: Object.fromEntries(new URLSearchParams(init.body)) });
    const payload = Object.assign({ status: 0, error_desc: '', error_code: '' }, result(asked[asked.length - 1]));
    return { ok: true, status: 200, text: async () => `status=0&enc_response=${encrypt(JSON.stringify(payload), KEY)}` };
  };
  return { asked, fetch };
}

function route(fetch) {
  return require('../lib/routes/admin/payments-pending')._private.createHandler({ fetch });
}

const records = (kind) => Object.entries(db.dump()).filter(([k, v]) => /^submissions\/[^/]+$/.test(k) && v.kind === kind).map(([k]) => k.split('/')[1]);
const age = async (orderId, minutes) => { await db.collection('transactions').doc(orderId).update({ createdAt: Timestamp.fromMillis(Date.now() - minutes * 60000) }); };

test('the callback writes what CCAvenue said to the error log before it touches Firestore', async () => {
  const out = await handoff(DONOR);
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  /* Firestore is down for the whole callback */
  const down = () => { throw Object.assign(new Error('14 UNAVAILABLE: deadline exceeded'), { code: 14 }); };
  firebase._setDbForTests({ collection: down, runTransaction: down, batch: down, doc: down });
  let page;
  try {
    page = await callback(out);
  } finally {
    console.error = original;
  }
  assert.match(page.raw, /could not verify this payment/i, 'the payer is told to check before trying again');
  const trace = logs.find((l) => l.includes(out.order_id) && l.includes('310009876543'));
  assert.ok(trace, `the order id and tracking id are in the log: ${JSON.stringify(logs)}`);
  for (const value of ['Success', '1500.00', 'INR', 'BNK77']) assert.ok(trace.includes(value), `${value} is in the log`);
  assert.ok(logs.indexOf(trace) < logs.findIndex((l) => /UNAVAILABLE/.test(l)), 'written before the Firestore error');
});

test('the panel lists payments still waiting after half an hour, and nothing else', async () => {
  const stale = await handoff(DONOR);
  const fresh = await handoff({ ...DONOR, amount: '700' });
  const paid = await handoff({ ...DONOR, amount: '900' });
  await age(stale.order_id, 45);
  await age(paid.order_id, 45);
  await callback(paid);
  const res = await call(route(async () => { throw new Error('not asked'); }), { method: 'GET', headers: ADMIN });
  assert.equal(res.statusCode, 200, res.raw);
  assert.deepEqual(res.json.pending.map((p) => p.orderId), [stale.order_id]);
  assert.equal(res.json.pending[0].status, 'initiated');
  assert.ok(res.json.pending[0].minutesWaiting >= 45);
  assert.deepEqual(res.json.statusCheck, { inr: true, usd: false });
  assert.ok(!res.json.pending.some((p) => p.orderId === fresh.order_id), 'a payment started minutes ago may still be on the bank\'s page');
});

test('check: CCAvenue says Successful, and the payment is settled and filed through the callback\'s own path, once', async () => {
  const out = await handoff(DONOR);
  const api = statusApi(() => ({ order_status: 'Successful', order_amt: 1500.0, order_currncy: 'INR', reference_no: '310001112223', order_bank_ref_no: 'BNK55', order_no: out.order_id, order_option_type: 'OPTUPI' }));
  const res = await call(route(api.fetch), { body: { action: 'check', orderId: out.order_id }, headers: ADMIN });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.applied, true);
  assert.equal(res.json.status, 'success');
  assert.equal(res.json.reference, `PFA-DON-${YEAR}-00001`);

  /* what was asked, and how */
  assert.equal(api.asked.length, 1);
  assert.equal(api.asked[0].url, 'https://apitest.ccavenue.com/apis/servlet/DoWebTrans');
  assert.equal(api.asked[0].form.command, 'orderStatusTracker');
  assert.equal(api.asked[0].form.request_type, 'JSON');
  assert.equal(api.asked[0].form.access_code, 'AVXX');
  assert.deepEqual(JSON.parse(decrypt(api.asked[0].form.enc_request, KEY)), { order_no: out.order_id });

  const t = db.dump()[`transactions/${out.order_id}`];
  assert.equal(t.status, 'success');
  assert.equal(t.ccaVenue.trackingId, '310001112223');
  assert.deepEqual(records('PFA-DON'), [`PFA-DON-${YEAR}-00001`]);
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'the receipt goes, once');

  /* the callback arriving late after all changes nothing */
  const late = await callback(out, { tracking_id: '310001112223', bank_ref_no: 'BNK55' });
  assert.match(late.raw, /Donation successful/);
  assert.deepEqual(records('PFA-DON'), [`PFA-DON-${YEAR}-00001`]);
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1);
  assert.ok(Object.keys(db.dump()).some((k) => k.startsWith('adminAudit/')), 'the check is in the admin log');
});

test('check: an Awaited payment that CCAvenue later reports Shipped is resolved', async () => {
  const out = await handoff(DONOR);
  await callback(out, { order_status: 'Awaited', bank_ref_no: '' });
  assert.equal(db.dump()[`transactions/${out.order_id}`].status, 'pending');
  const api = statusApi(() => ({ order_status: 'Shipped', order_amt: '1500.00', order_currncy: 'INR', reference_no: '310009876543', order_no: out.order_id }));
  const res = await call(route(api.fetch), { body: { action: 'check', orderId: out.order_id }, headers: ADMIN });
  assert.equal(res.json.status, 'success');
  assert.equal(records('PFA-DON').length, 1);
});

test('check: an answer that is not final, or does not match, never files a record', async () => {
  const waiting = await handoff(DONOR);
  const r1 = await call(route(statusApi(() => ({ order_status: 'Awaited', order_amt: 1500, order_no: waiting.order_id })).fetch), { body: { action: 'check', orderId: waiting.order_id }, headers: ADMIN });
  assert.equal(r1.json.applied, false);
  assert.match(r1.json.message, /Nothing was changed/);
  assert.equal(db.dump()[`transactions/${waiting.order_id}`].status, 'initiated');

  const wrong = await handoff({ ...DONOR, amount: '2000' });
  const r2 = await call(route(statusApi(() => ({ order_status: 'Successful', order_amt: 20, order_currncy: 'INR', order_no: wrong.order_id })).fetch), { body: { action: 'check', orderId: wrong.order_id }, headers: ADMIN });
  assert.equal(r2.json.status, 'verification_failed', 'the amount check of the callback applies');

  const aborted = await handoff({ ...DONOR, amount: '300' });
  const r3 = await call(route(statusApi(() => ({ order_status: 'Aborted', order_amt: 300, order_no: aborted.order_id })).fetch), { body: { action: 'check', orderId: aborted.order_id }, headers: ADMIN });
  assert.equal(r3.json.status, 'aborted');
  assert.deepEqual(records('PFA-DON'), []);
  assert.equal(sent.length, 0);
});

test('check: without the CCAvenue keys on this server it answers "not configured" and changes nothing', async () => {
  const out = await handoff(DONOR);
  const saved = Object.fromEntries(CCA_ENV.map((k) => [k, process.env[k]]));
  delete process.env.CCAVENUE_ACCESS_CODE;
  delete process.env.CCAVENUE_WORKING_KEY;
  let asked = 0;
  try {
    const res = await call(route(async () => { asked += 1; throw new Error('must not be asked'); }), { body: { action: 'check', orderId: out.order_id }, headers: ADMIN });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json.code, 'NOT_CONFIGURED');
    assert.match(res.json.message, /Nothing was changed/);
    const list = await call(route(), { method: 'GET', headers: ADMIN });
    assert.deepEqual(list.json.statusCheck, { inr: false, usd: false });
  } finally {
    Object.assign(process.env, saved);
  }
  assert.equal(asked, 0);
  assert.equal(db.dump()[`transactions/${out.order_id}`].status, 'initiated');
});

test('the route is for signed-in staff with the payments module only', async () => {
  const res = await call(route(), { method: 'GET', headers: {} });
  assert.equal(res.statusCode, 401);
  const bad = await call(route(), { body: { action: 'check', orderId: 'PFA-DON-../../x' }, headers: ADMIN });
  assert.equal(bad.statusCode, 400);
});

test('check: a shop order CCAvenue says was paid is settled through the shop\'s path', async () => {
  const store = new Map();
  let clock = 0;
  backend.use({
    async read(c, id) { const d = store.get(`${c}/${id}`); return d ? { data: JSON.parse(JSON.stringify(d.data)), updateTime: d.updateTime } : null; },
    async commit(writes) {
      for (const w of writes) if (w.set && w.ifUpdateTime && (!store.get(w.set.join('/')) || store.get(w.set.join('/')).updateTime !== w.ifUpdateTime)) return { ok: false, conflict: true };
      for (const w of writes) {
        const key = (w.set || w.increment).join('/');
        const d = store.get(key) || { data: {}, updateTime: '' };
        if (w.set) Object.assign(d.data, JSON.parse(JSON.stringify(w.data))); else for (const [k, n] of Object.entries(w.by)) d.data[k] = (Number(d.data[k]) || 0) + n;
        d.updateTime = `t${++clock}`;
        store.set(key, d);
      }
      return { ok: true };
    }
  });
  const r = { statusCode: 200, body: '', setHeader() {}, end(b) { this.body = String(b || ''); } };
  await require('../lib/routes/shop/checkout')({ method: 'POST', url: '/api/shop', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'pfa.test' }, body: new URLSearchParams({ items: JSON.stringify([{ id: '23', size: 'L', qty: 1 }]), name: 'Meera Shah', mobile: '9876543210', email: 'meera@example.com', address: 'Flat 4, Shanti Niwas, FC Road', state: 'Maharashtra', district: 'Pune', pincode: '411004' }).toString() }, r);
  const orderId = /PFA-SHP-[A-Z0-9]{8}/.exec(r.body)[0];
  assert.equal(db.dump()[`transactions/${orderId}`].type, 'shop');
  const api = statusApi(() => ({ order_status: 'Successful', order_amt: 2650, order_currncy: 'INR', reference_no: '3100077', order_no: orderId }));
  const res = await call(route(api.fetch), { body: { action: 'check', orderId }, headers: ADMIN });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.status, 'paid');
  assert.equal(store.get(`orders/${orderId}`).data.status, 'paid');
  assert.ok(db.dump()[`submissions/${orderId}`], 'the case is filed');
  assert.equal(db.dump()[`transactions/${orderId}`].status, 'success');
});

test('refile: a paid application whose photograph could not be attached is finished by the repair action', async () => {
  const files = new Map();
  const where = { name: 'b', bucket: { file: (p) => ({ async save(b) { files.set(p, Buffer.from(b)); }, async download() { if (!files.has(p)) throw new Error('404'); return [files.get(p)]; } }) } };
  FILES._setBucket(() => where);
  const photo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'media/cinekind-2026/reels/glimpse.jpg')).toString('base64');
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo }, headers: { 'content-type': 'application/json' } });
  const out = await handoff({ type: 'caregiver-application', documents: docs.json.token, animals: '4', ...PERSON });
  FILES._setBucket(() => null);
  /* and Storage cannot answer the read just now */
  FILES._setStorage(() => ({ file: () => ({ async save() { throw new Error('503'); }, async download() { throw Object.assign(new Error('503 backend error'), { code: 503 }); } }) }));
  const original = console.error;
  console.error = () => {};
  try { await callback(out); } finally { console.error = original; }
  const ref = `PFA-CG-${YEAR}-00001`;
  assert.equal(db.dump()[`submissions/${ref}`].photoPending, true);
  const listed = await call(route(), { method: 'GET', headers: ADMIN });
  assert.deepEqual(listed.json.photoPending.map((p) => [p.reference, p.orderId]), [[ref, out.order_id]], 'the panel can see it');

  FILES._setStorage(null);
  FILES._setBucket(() => where);
  const res = await call(route(), { body: { action: 'refile', orderId: out.order_id }, headers: ADMIN });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.reference, ref, 'the same number');
  const record = db.dump()[`submissions/${ref}`];
  assert.equal(record.photoPending, false);
  assert.equal(record.attachments, 1);
  assert.equal(records('PFA-CG').length, 1);
});
