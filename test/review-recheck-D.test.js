'use strict';

/* Verification of review D (payments and files), D1-D11 (D4's probe half is
   in review-recheck-D-probe.test.js, which needs its own module cache). Each test
   states the CORRECT behaviour. Adapted from review-D/repro/*.test.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_review-recheck-harness');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');
const { PLACE } = require('./_place');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
let W;
test.beforeEach(() => {
  W = H.fresh();
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AV', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PFA_SUBMISSIONS_INBOX: H.INBOX });
});
test.afterEach(() => { W.restore(); require('../lib/file-store')._reset(); });

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
async function start(form) {
  const r = await H.call(require('../lib/routes/payment/create'), { token: null, body: form, headers: FORM });
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(r.raw);
  assert.ok(enc, r.raw.slice(0, 400));
  return decodeMerchantData(decrypt(enc[1], KEY));
}
async function callback(out, extra) {
  const encResp = encrypt(encodeMerchantData(Object.assign({ order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '310009876543', bank_ref_no: 'BNK1', payment_mode: 'UPI' }, extra || {})), KEY);
  const r = await H.call(require('../lib/routes/payment/response'), { token: null, body: { encResp }, headers: FORM, url: '/api/payment/response' });
  return r.raw;
}
const subs = (kind) => Object.keys(W.db.dump()).filter((k) => new RegExp(`^submissions/${kind}-\\d{4}-\\d+$`).test(k));
const PERSON = { name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', district: 'Udupi', pincode: '576101' };
async function stagePhoto() {
  const r = await H.call(require('../lib/routes/caregiver/documents'), { token: null, body: { photo: 'data:image/jpeg;base64,' + H.jpeg(5000).toString('base64') } });
  assert.equal(r.statusCode, 200, r.raw);
  return r.json.token;
}

/* ---- D1 ---- */
test('D1 shop: a verified Success after a cancellation settles the order as paid', async () => {
  const backend = require('../lib/shop-backend');
  const C = require('../lib/ccavenue');
  const SKEY = 'TESTWORKINGKEY0123456789ABCDEF00';
  Object.assign(process.env, { CCAVENUE_WORKING_KEY: SKEY, CCAVENUE_ACCESS_CODE: 'AVTEST', PUBLIC_SITE_URL: 'https://peopleforanimalsindia.org' });
  const docs = new Map(); let clock = 0;
  backend.use({ docs,
    async read(c, id) { const d = docs.get(`${c}/${id}`); return d ? { data: JSON.parse(JSON.stringify(d.data)), updateTime: d.updateTime } : null; },
    async commit(writes) {
      for (const w of writes) { if (!w.set) continue; const d = docs.get(w.set.join('/')); if (w.ifUpdateTime && (!d || d.updateTime !== w.ifUpdateTime)) return { ok: false, conflict: true }; if (w.mustNotExist && d) return { ok: false, conflict: true }; }
      for (const w of writes) { const key = (w.set || w.increment).join('/'); const d = docs.get(key) || { data: {}, updateTime: '' }; if (w.set) Object.assign(d.data, JSON.parse(JSON.stringify(w.data))); else for (const [k, n] of Object.entries(w.by)) d.data[k] = (Number(d.data[k]) || 0) + n; d.updateTime = `t${++clock}`; docs.set(key, d); }
      return { ok: true };
    } });
  try {
    const SHOPPER = { name: 'Meera Shah', mobile: '9876543210', email: 'meera@example.com', address: 'Flat 4, Shanti Niwas, FC Road', state: 'Maharashtra', district: 'Pune', pincode: '411004' };
    const body = (b) => new URLSearchParams(b).toString();
    const hdr = { 'content-type': 'application/x-www-form-urlencoded', host: 'peopleforanimalsindia.org' };
    const r = await H.call(require('../lib/routes/shop/checkout'), { token: null, body: body({ items: JSON.stringify([{ id: '23', size: 'L', qty: 1 }]), ...SHOPPER }), headers: hdr });
    const sent = Object.fromEntries(new URLSearchParams(C.decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(r.raw)[1], SKEY)));
    const stockBefore = docs.get('stock/23__L').data.remaining;
    const answer = async (status) => {
      const v = { order_id: sent.order_id, order_status: status, amount: sent.amount, merchant_id: '123456', tracking_id: status === 'Success' ? '3100002' : '3100001', bank_ref_no: status === 'Success' ? 'BRN9' : '', payment_mode: 'UPI' };
      return (await H.call(require('../lib/routes/shop/response'), { token: null, body: body({ encResp: C.encrypt(new URLSearchParams(v).toString(), SKEY) }), headers: hdr })).raw;
    };
    await answer('Aborted');
    const page = await answer('Success');
    const order = docs.get(`orders/${sent.order_id}`).data;
    assert.equal(/<h1>([^<]+)/.exec(page)[1].includes('Thank you'), true, /<h1>([^<]+)/.exec(page)[1]);
    assert.ok(!/No money was taken/.test(page));
    assert.equal(order.status, 'paid');
    assert.equal(docs.get('stock/23__L').data.remaining, stockBefore);
    /* and a late Failure after the payment never undoes it */
    await answer('Failure');
    assert.equal(docs.get(`orders/${sent.order_id}`).data.status, 'paid');
  } finally { backend.use(null); }
});

/* ---- D2 ---- */
test('D2a two copies of one donation success at once: one record, one receipt, one copy to each payments inbox', async () => {
  const out = await start(Object.assign({ type: 'donate', currency: 'inr', amount: '1500', terms: 'yes' }, PERSON));
  await Promise.all([callback(out), callback(out)]);
  assert.equal(subs('PFA-DON').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'asha@example.com').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'pfadcmho@gmail.com').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'ozairhusain@gmail.com').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === H.INBOX).length, 0, 'a record of money never reaches gandhim');
  assert.equal(W.db.dump()[`transactions/${out.order_id}`].donationReference, subs('PFA-DON')[0].slice(12));
});

test('D2b three copies of one membership success at once: one record', async () => {
  const out = await start(Object.assign({ type: 'membership', tier: 'silver', terms: 'yes' }, PERSON));
  await Promise.all([callback(out), callback(out), callback(out)]);
  assert.equal(subs('PFA-MEM').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'asha@example.com').length, 1);
});

test('D2c caregiver application: two callbacks at once file one record with the photo once', async () => {
  const token = await stagePhoto();
  const out = await start(Object.assign({ type: 'caregiver-application', documents: token }, PERSON));
  await Promise.all([callback(out), callback(out)]);
  const d = W.db.dump();
  const recs = subs('PFA-CG');
  assert.equal(recs.length, 1);
  assert.equal(d[recs[0]].attachments, 1);
  assert.equal(d[recs[0]].photoPending, false);
});

/* ---- D3 ---- */
test('D3 a Firestore outage during the callback still leaves the order id, tracking id and status in the log', async () => {
  const out = await start(Object.assign({ type: 'donate', currency: 'inr', amount: '5000', terms: 'yes' }, PERSON));
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.map(String).join(' '));
  const rt = W.db.runTransaction; W.db.runTransaction = async () => { throw new Error('14 UNAVAILABLE: deadline exceeded'); };
  try { await callback(out); } finally { W.db.runTransaction = rt; console.error = orig; }
  assert.ok(logs.some((l) => l.includes(out.order_id) && l.includes('310009876543') && /Success/.test(l)), JSON.stringify(logs));
  assert.ok(fs.existsSync(path.join(H.root, 'lib/routes/admin/payments-pending.js')));
});

/* ---- D4 (attach half) ---- */
test('D4 a photo that cannot be read just now is not linked as empty and the staging copy is kept for the retry', async () => {
  const FILES = require('../lib/file-store');
  let readable = true;
  const box = H.memoryBucket('pfa-new-website.firebasestorage.app', { failRead: () => !readable });
  FILES._setBucket(() => box.where);
  const token = await stagePhoto();
  assert.ok(box.files.get(`caregiver-staging/${token}/1`));
  FILES._setBucket(() => null);                      // this instance has no write target
  FILES._setStorage((name) => (name === box.where.name ? box.where.bucket : H.memoryBucket(name).where.bucket));
  readable = false;                                  // and the bucket fails to answer just now
  const documents = require('../lib/routes/caregiver/documents');
  const ref = W.db.collection('submissions').doc('PFA-CG-2026-00001');
  await assert.rejects(documents.attachTo(W.db, token, ref, new Date().toISOString()));
  assert.equal(W.db.dump()[`caregiverDocuments/${token}`].consumed, false);
  assert.ok(!W.db.dump()['submissions/PFA-CG-2026-00001/attachments/1']);
  readable = true;                                   // storage healthy again
  const n = await documents.attachTo(W.db, token, ref, new Date().toISOString());
  assert.equal(n, 1);
  const att = W.db.dump()['submissions/PFA-CG-2026-00001/attachments/1'];
  const bytes = await FILES.read(att);
  assert.ok(bytes && bytes.length === 5000);
});

/* ---- D5 ---- */
test('D5 caregiver application: the record write failing once never orphans the photo or spends a number', async () => {
  const token = await stagePhoto();
  const out = await start(Object.assign({ type: 'caregiver-application', documents: token }, PERSON));
  const col = W.db.collection.bind(W.db); let failed = false;
  W.db.collection = (n) => { const c = col(n); if (n !== 'submissions') return c; const d = c.doc; c.doc = (id) => { const ref = d(id); const cr = ref.create; ref.create = async (x) => { if (!failed && /^PFA-CG-\d{4}-\d+$/.test(id)) { failed = true; throw new Error('4 DEADLINE_EXCEEDED'); } return cr(x); }; return ref; }; return c; };
  const orig = console.error; console.error = () => {};
  try { await callback(out); await callback(out); } finally { console.error = orig; W.db.collection = col; }
  const d = W.db.dump();
  assert.deepEqual(subs('PFA-CG'), ['submissions/PFA-CG-2026-00001']);
  assert.equal(d['submissions/PFA-CG-2026-00001'].attachments, 1);
});

/* ---- D6 ---- */
test('D6 a published field note photo is served through the real lib/firebase.js', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
  await W.db.collection('submissions').doc('PFA-W-2026-00007').set({ kind: 'PFA-W', wall: { published: true }, attachments: 1 });
  await W.db.collection('submissions').doc('PFA-W-2026-00007').collection('attachments').doc('1').set({ bytes: png, contentType: 'image/png', size: png.length });
  const r = await H.call(require('../lib/routes/field-note-photo'), { token: null, method: 'GET', query: { ref: 'PFA-W-2026-00007', n: '1' } });
  assert.equal(r.statusCode, 200);
  const notes = await H.call(require('../lib/routes/field-notes'), { token: null, method: 'GET' });
  assert.equal(notes.statusCode, 200);
});

/* ---- D7 ---- */
test('D7 corrected donor and gift details under the same page key are the ones used', async () => {
  const base = { type: 'donate', currency: 'inr', amount: '2500', terms: 'yes', name: 'Asha Kumar', mobile: '9876543210', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', gift: 'yes', giftTo: 'Ravi Menon', giftPin: '560038', client_ref: 'gift-VISIT-abc' };
  const a = await start(Object.assign({}, base, { email: 'asha@exmaple.com', pan: 'ABCDE1234F', giftAddress: '12 Lake View Road, Indiranagar, Bengaluru' }));
  const b = await start(Object.assign({}, base, { email: 'asha@example.com', pan: 'ABCDE9999Z', giftAddress: '99 New Road, Koramangala, Bengaluru' }));
  /* the same request twice (before paying) is still one transaction */
  const c = await start(Object.assign({}, base, { email: 'asha@example.com', pan: 'ABCDE9999Z', giftAddress: '99 New Road, Koramangala, Bengaluru' }));
  assert.equal(c.order_id, b.order_id);
  assert.notEqual(a.order_id, b.order_id);
  await callback(b);
  const t = W.db.dump()[`transactions/${b.order_id}`];
  const rec = W.db.dump()[`submissions/${t.donationReference}`];
  assert.match(rec.fields.giftAddress, /99 New Road/);
  assert.equal(rec.fields.pan, 'ABCDE9999Z');
  assert.ok(W.smtp.sent.some((m) => m.to === 'asha@example.com'));
});

/* ---- D8 ---- */
test('D8 a second replacement attempt under the same clientRef hands CCAvenue an order id that is on record', async () => {
  await W.db.collection('caretakerCards').doc('PFA-CCT-ABCD2345').set({ cardId: 'PFA-CCT-ABCD2345', name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Udupi', pin: '576101', status: 'active', addressId: 'PFA-ADR-1', applicantId: 'PFA-APP-TEST0001' });
  const body = { stage: 'pay', cardId: 'PFA-CCT-ABCD2345', mobile: '9876543210', clientRef: 'LC-visit-1-SHIP' };
  const hand = async () => { const r = await H.call(require('../lib/routes/caregiver/replace'), { token: null, body }); return decodeMerchantData(decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(r.raw)[1], KEY)); };
  const a = await hand();
  const b = await hand();
  assert.equal(a.order_id, b.order_id);
  assert.ok(W.db.dump()[`transactions/${b.order_id}`]);
  const page = await callback(b);
  assert.ok(!/Payment response unavailable/.test(page));
});

/* ---- D9 ---- */
test('D9 drop() empties the file in the bucket the document names', async () => {
  const FILES = require('../lib/file-store');
  const A = H.memoryBucket('pfa-new-website.firebasestorage.app');
  const B = H.memoryBucket('pfa-new-website.appspot.com');
  FILES._setStorage((name) => (name === A.where.name ? A.where.bucket : B.where.bucket));
  FILES._setBucket(() => A.where);
  const stored = await FILES.put('caregiver-staging/t/1', H.jpeg(3000), 'image/jpeg');
  FILES._setBucket(() => B.where);
  await FILES.drop(stored, 'now');
  assert.equal(A.files.get('caregiver-staging/t/1').length, 0);
  assert.ok(!B.files.has('caregiver-staging/t/1'));
});

/* ---- D10 ---- */
test('D10 report with 2 photos whose 2nd write keeps failing: the answer gives the number, the retry gives the same one', async () => {
  const FILES = require('../lib/file-store');
  FILES._setBucket(() => null);
  let fails = 2;
  const db = W.db;
  const wrapped = Object.assign({}, db, { collection: (n) => { const c = db.collection(n); if (n !== 'submissions') return c; return Object.assign(Object.create(c), { doc: (id) => { const r = c.doc(id); return Object.assign(Object.create(r), { collection: (s) => { const sc = r.collection(s); return Object.assign(Object.create(sc), { doc: (k) => { const d = sc.doc(k); return Object.assign(Object.create(d), { create: async (x) => { if (k === '2' && fails-- > 0) throw new Error('4 DEADLINE_EXCEEDED'); return d.create(x); } }); } }); } }); } }); } });
  const handler = require('../lib/routes/pfa-submissions')._private.createHandler({ getDb: () => wrapped, deliver: async () => ({}), isConfigured: () => false, now: () => Date.now() });
  const REPORT = { what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly and needs a vet soon.', animal: 'Dog', urgency: 'Happening now', ...PLACE, when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'tester.pfa@example.com' };
  const photo = 'data:image/jpeg;base64,' + H.jpeg(4000).toString('base64');
  const send = () => H.call(handler, { token: null, body: { kind: 'PFA-CR', data: REPORT, page: 'report.html', clientRequestId: 'req-1', photos: [photo, photo] } });
  const first = await send();
  const second = await send();
  assert.equal(first.statusCode, 200, first.raw);
  assert.equal(second.json.reference, first.json.reference);
  const d = db.dump();
  const rec = d[`submissions/${first.json.reference}`];
  assert.equal(rec.attachments, Object.keys(d).filter((k) => k.startsWith(`submissions/${first.json.reference}/attachments/`)).length);
  assert.equal(subs('PFA-CR').length, 1);
});

/* ---- D11 ---- */
test('D11 Storage rules deny every browser, are named in firebase.json and deployed by the ship script', () => {
  const rules = fs.readFileSync(path.join(H.root, 'storage.rules'), 'utf8');
  assert.match(rules, /allow read, write: if false;/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(H.root, 'firebase.json'), 'utf8')).storage.rules, 'storage.rules');
  assert.match(fs.readFileSync(path.join(H.root, 'scripts/ship.sh'), 'utf8'), /deploy --only storage/);
});
