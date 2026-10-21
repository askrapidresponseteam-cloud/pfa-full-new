'use strict';

/* Verification of review B (intake, numbering, tracking), B1-B12. Each test
   states the CORRECT behaviour. Adapted from review-B/test/review-b*.test.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');
const S = require('../lib/submissions');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const WORKING_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
let W;
test.beforeEach(() => {
  W = H.fresh();
  Object.assign(process.env, { PFA_SUBMISSIONS_INBOX: 'off', CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: WORKING_KEY, CCAVENUE_MODE: 'test' });
});
test.afterEach(() => { W.restore(); require('../lib/file-store')._reset(); });

const CR = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping.',
  animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001',
  when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'reporter@example.com'
};

function build(db, { deliverDelay = 0, mails, queue = null, now } = {}) {
  return require('../lib/routes/pfa-submissions')._private.createHandler({
    getDb: () => db,
    deliver: async (m) => { if (mails) mails.push(m); if (deliverDelay) await H.sleep(deliverDelay); return { providerId: 'p' }; },
    isConfigured: () => true,
    smtpConfigured: () => false,
    now: now || (() => Date.now()),
    queue
  });
}
const post = (h, body, headers) => H.call(h, { token: null, body, headers });
const get = (h, query, headers) => H.call(h, { token: null, method: 'GET', query, headers });
const subs = (db, kind) => Object.entries(db.dump()).filter(([k, v]) => /^submissions\/[^/]+$/.test(k) && (!kind || v.kind === kind)).map(([k]) => k.slice(12));

test('B1 the confirmation goes to the reporter, never to an address typed under "Who is doing it"', async () => {
  const mails = [];
  const h = build(W.db, { mails });
  const res = await post(h, { kind: 'PFA-CR', data: Object.assign({}, CR, { accused: 'ramesh.abuser@example.com' }), clientRequestId: 'k3' });
  assert.equal(res.statusCode, 200, res.raw);
  assert.ok(!mails.some((m) => m.to === 'ramesh.abuser@example.com'), JSON.stringify(mails.map((m) => m.to)));
  assert.ok(mails.some((m) => m.to === 'reporter@example.com'));
  assert.equal(res.json.confirmation.to, 'reporter@example.com');
});

test('B2a the same clientRequestId sent twice while the first is still emailing is ONE record', async () => {
  const h = build(W.db, { deliverDelay: 300 });
  const body = { kind: 'PFA-CR', data: CR, page: 'report.html', clientRequestId: 'same-key-123' };
  const first = post(h, body);
  await H.sleep(50);
  const second = post(h, body);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(a.json.reference, b.json.reference);
  assert.equal(b.json.duplicate, true);
  assert.equal(subs(W.db).length, 1);
});

test('B2b two identical requests fired in the same tick are ONE record (transaction race)', async () => {
  const h = build(W.db);
  const body = { kind: 'PFA-CR', data: CR, page: 'report.html', clientRequestId: 'same-tick' };
  const [a, b] = await Promise.all([post(h, body), post(h, body)]);
  assert.equal(a.json.reference, b.json.reference);
  assert.equal(subs(W.db).length, 1);
});

test('B2c a photo write failing (both tries) after the record is on file never answers "Nothing was saved"; the retry is the same number', async () => {
  const PHOTO = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64)]).toString('base64');
  const realCollection = W.db.collection.bind(W.db);
  let failures = 2;
  W.db.collection = (name) => {
    const c = realCollection(name);
    if (name !== 'submissions') return c;
    const od = c.doc;
    c.doc = (id) => {
      const d = od(id); const os = d.collection;
      d.collection = (sub) => { const s = os(sub); if (sub !== 'attachments') return s; const sd = s.doc; s.doc = (x) => { const r = sd(x); const oc = r.create; r.create = async (v) => { if (failures > 0) { failures -= 1; throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }); } return oc(v); }; return r; }; return s; };
      return d;
    };
    return c;
  };
  const h = build(W.db);
  const body = { kind: 'PFA-CR', data: CR, photos: [PHOTO], clientRequestId: 'k9' };
  const first = await post(h, body);
  assert.equal(first.statusCode, 200, first.raw);
  assert.ok(first.json.reference);
  assert.equal(first.json.photosNotKept, 1);
  const retry = await post(h, body);
  assert.equal(retry.json.reference, first.json.reference);
  assert.equal(subs(W.db).length, 1);
});

/* ---- paid flows ---- */
function cb(form) { return form; }
const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'tester.pfa@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024', pin: '110024' };
async function handoff(form) {
  const create = require('../lib/routes/payment/create');
  const res = await H.call(create, { token: null, body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(res.raw);
  assert.ok(enc, res.raw.slice(0, 400));
  return decodeMerchantData(decrypt(enc[1], WORKING_KEY));
}
function callback(out, status) {
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: status || 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI', status_message: '' };
  return H.call(require('../lib/routes/payment/response'), { token: null, body: { encResp: encrypt(encodeMerchantData(bank), WORKING_KEY) }, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}

for (const [type, form, kind] of [
  ['membership', { type: 'membership', tier: 'silver', terms: 'yes' }, 'PFA-MEM'],
  ['donate', { type: 'donate', currency: 'inr', amount: '1500', terms: 'yes', cause: 'Where it is needed most', pan: 'ABCDE1234F' }, 'PFA-DON']
]) {
  test(`B3 ${type}: a second callback while the first is still writing files no second record`, async () => {
    const out = await handoff(cb(Object.assign({}, form, PERSON)));
    const orig = W.db.collection.bind(W.db);
    let slowed = false;
    W.db.collection = (name) => {
      const c = orig(name);
      if (name !== 'submissions') return c;
      const od = c.doc;
      c.doc = (id) => { const d = od(id); const oc = d.create; d.create = async (v) => { if (!slowed) { slowed = true; await H.sleep(300); } return oc(v); }; return d; };
      return c;
    };
    const a = callback(out);
    await H.sleep(100);
    const b = callback(out);
    const [ra, rb] = await Promise.all([a, b]);
    const recs = subs(W.db, kind);
    assert.equal(recs.length, 1, JSON.stringify(recs));
    /* the member page shows the number; the donation page shows the order id only */
    if (kind === 'PFA-MEM') {
      const shown = [ra.raw, rb.raw].map((p) => (p.match(new RegExp(`${kind}-\\d{4}-\\d{5}`)) || [''])[0]);
      assert.deepEqual(shown, [recs[0], recs[0]]);
    }
    assert.equal(W.db.dump()[`transactions/${out.order_id}`][kind === 'PFA-MEM' ? 'membershipReference' : 'donationReference'], recs[0]);
  });
}

test('B4 caregiver application: the record write failing once loses no photo and skips no number', async () => {
  const docs = await H.call(require('../lib/routes/caregiver/documents'), { token: null, body: { photo: 'data:image/jpeg;base64,' + H.jpeg(3000).toString('base64') } });
  assert.equal(docs.statusCode, 200, docs.raw);
  const out = await handoff(Object.assign({ type: 'caregiver-application', documents: docs.json.token, animals: '12', notes: 'Feeding them for four years.' }, PERSON));
  const orig = W.db.collection.bind(W.db);
  let failOnce = true;
  W.db.collection = (name) => {
    const c = orig(name);
    if (name !== 'submissions') return c;
    const od = c.doc;
    c.doc = (id) => { const d = od(id); const oc = d.create; d.create = async (v) => { if (failOnce && /^PFA-CG-\d{4}-\d+$/.test(id)) { failOnce = false; throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }); } return oc(v); }; return d; };
    return c;
  };
  await callback(out);
  await callback(out);
  const dump = W.db.dump();
  const recs = subs(W.db, 'PFA-CG');
  assert.deepEqual(recs, ['PFA-CG-2026-00001']);
  assert.equal(dump['submissions/PFA-CG-2026-00001'].attachments, 1);
  assert.ok(dump['submissions/PFA-CG-2026-00001/attachments/1']);
  const orphans = Object.keys(dump).filter((k) => /^submissions\/[^/]+\/attachments\//.test(k)).filter((k) => !dump[k.split('/').slice(0, 2).join('/')]);
  assert.deepEqual(orphans, []);
});

test('B5 a paid shop order whose case write fails once is filed by the redelivery', async () => {
  const backend = require('../lib/shop-backend');
  const C = require('../lib/ccavenue');
  const KEY = 'TESTWORKINGKEY0123456789ABCDEF00';
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVTEST', CCAVENUE_WORKING_KEY: KEY });
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
    const form = (b) => new URLSearchParams(b).toString();
    const r = await H.call(require('../lib/routes/shop/checkout'), { token: null, body: form({ items: JSON.stringify([{ id: '21', colour: 'Red', size: 'XL', qty: 1 }]), ...SHOPPER }), headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'peopleforanimalsindia.org' } });
    const sent = Object.fromEntries(new URLSearchParams(C.decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(r.raw)[1], KEY)));
    const orig = W.db.collection.bind(W.db); let failOnce = true;
    W.db.collection = (name) => { const c = orig(name); if (name !== 'submissions') return c; const od = c.doc; c.doc = (id) => { const d = od(id); const oc = d.create; d.create = async (v) => { if (failOnce) { failOnce = false; throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }); } return oc(v); }; return d; }; return c; };
    const v = { order_id: sent.order_id, order_status: 'Success', amount: sent.amount, merchant_id: sent.merchant_id, tracking_id: '310000000001', bank_ref_no: 'BRN1', payment_mode: 'UPI' };
    for (let i = 0; i < 2; i += 1) {
      await H.call(require('../lib/routes/shop/response'), { token: null, body: form({ encResp: C.encrypt(new URLSearchParams(v).toString(), KEY) }), headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'peopleforanimalsindia.org' } });
    }
    assert.ok(W.db.dump()[`submissions/${sent.order_id}`], 'the case is filed');
    const look = await get(require('../lib/routes/pfa-submissions'), { reference: sent.order_id, contact: 'meera@example.com' });
    assert.equal(look.statusCode, 200, look.raw);
  } finally { backend.use(null); }
});

test('B6 a mobile typed under "Who is doing it" cannot follow the report', async () => {
  const h = build(W.db);
  const res = await post(h, { kind: 'PFA-CR', data: Object.assign({}, CR, { accused: 'Ramesh, dairy owner, 98111 22333' }), clientRequestId: 'k4' });
  const look = await get(h, { reference: res.json.reference, contact: '9811122333' });
  assert.notEqual(look.statusCode, 200);
  const own = await get(h, { reference: res.json.reference, contact: '9876543210' });
  assert.equal(own.statusCode, 200);
});

test('B7a Vercel: rotating the first X-Forwarded-For entry does not walk past the lookup brake (x-real-ip)', async () => {
  process.env.VERCEL = '1';
  const h = build(W.db);
  let limited = 0;
  for (let i = 0; i < 60; i += 1) {
    const r = await get(h, { reference: 'PFA-CR-2026-' + String(i).padStart(5, '0'), contact: 'x@y.zz' }, { 'x-forwarded-for': `10.0.${i}.1`, 'x-real-ip': '34.1.1.1' });
    if (r.statusCode === 429) limited += 1;
  }
  assert.ok(limited >= 15, `limited ${limited}`);
});

test('B7b Firebase: rotating the first X-Forwarded-For entry does not walk past the write brake', async () => {
  process.env.K_SERVICE = 'api';
  const h = build(W.db);
  let limited = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'w' + i }, { 'x-forwarded-for': `10.9.${i}.1, 34.1.1.1` });
    if (r.statusCode === 429) limited += 1;
  }
  assert.ok(limited >= 9, `limited ${limited}`);
});

test('B7c the brake is shared: a fresh instance (empty memory) still sees the count in Firestore', async () => {
  process.env.VERCEL = '1';
  const h = build(W.db);
  for (let i = 0; i < 30; i += 1) await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'z' + i }, { 'x-real-ip': '34.9.9.9' });
  S.resetForTests();   // another warm instance
  const r = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'z-last' }, { 'x-real-ip': '34.9.9.9' });
  assert.equal(r.statusCode, 429);
});

test('B7d confirmations to one address are capped whoever asks', async () => {
  process.env.VERCEL = '1';
  const mails = [];
  const h = build(W.db, { mails });
  for (let i = 0; i < 20; i += 1) {
    await post(h, { kind: 'PFA-CR', data: Object.assign({}, CR, { email: 'victim@example.com' }), clientRequestId: 'v' + i }, { 'x-real-ip': `10.9.${i}.1` });
  }
  assert.ok(mails.filter((m) => m.to === 'victim@example.com').length <= 5);
});

test('B8 a refused photo spends no number', async () => {
  const h = build(W.db);
  const bad = await post(h, { kind: 'PFA-CR', data: CR, photos: ['data:image/png;base64,AAAA'], clientRequestId: 'k1' });
  assert.equal(bad.statusCode, 422);
  const good = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'k2' });
  assert.equal(good.json.reference, 'PFA-CR-2026-00001');
});

test('B9 a wrong contact and an unknown number get the same answer', async () => {
  const h = build(W.db);
  const res = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'k5' });
  const hit = await get(h, { reference: res.json.reference, contact: 'x@y.zz' });
  const miss = await get(h, { reference: 'PFA-CR-2026-00099', contact: 'x@y.zz' });
  assert.equal(hit.statusCode, miss.statusCode);
  assert.equal(hit.raw, miss.raw);
  const hitNo = await get(h, { reference: res.json.reference });
  const missNo = await get(h, { reference: 'PFA-CR-2026-00099' });
  assert.equal(hitNo.raw, missNo.raw);
});

test('B10 the reference year is the year in India', async () => {
  const at = Date.parse('2026-12-31T20:00:00Z');   // 01:30 IST, 1 Jan 2027
  const h = build(W.db, { now: () => at });
  const res = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'k10' });
  assert.equal(res.json.reference, 'PFA-CR-2027-00001');
});

test('B11 "+91-098765-43210" matches the mobile it was given with, on another pepper too', async () => {
  const h = build(W.db);
  process.env.PFA_AUTH_PEPPER = 'vercel-pepper';
  const res = await post(h, { kind: 'PFA-CR', data: CR, clientRequestId: 'k7' });
  process.env.PFA_AUTH_PEPPER = 'firebase-pepper';
  for (const c of ['9876543210', '+91 98765 43210', '098765 43210', '+91-098765-43210', '0091 9876543210', ' Reporter@Example.COM ']) {
    const r = await get(h, { reference: res.json.reference, contact: c });
    assert.equal(r.statusCode, 200, `${c} -> ${r.raw}`);
  }
});

test('B12 the test double isolates transactions: two allocations at once get two numbers', async () => {
  const [a, b] = await Promise.all([S.allocateReference(W.db, 'PFA-Q'), S.allocateReference(W.db, 'PFA-Q')]);
  assert.notEqual(a, b);
});
