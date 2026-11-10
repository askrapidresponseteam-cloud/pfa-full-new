'use strict';

/* The PAN or Aadhaar card behind an 80G receipt (owner, 7 Nov 2026: "when
   someone is contributing 5k or more . make providing aadhar or pan upload
   mandatory for 80G receipt. give proper reason to people as well"), and
   since 10 Nov 2026 given after paying, never before ("make donating any
   amount easier. dont ask for uploading whatever before the payment. after
   payment send a link over email which asks to upload those in the page if
   one needs tax exempt receipt").

   Held here: nothing about a card is asked for or required before paying,
   at any amount; the receipt email, the welcome letter and the thank-you
   page link to tax-receipt.html; that page says why, takes the number and a
   photo, and files them on the paid record and the payment; the photo is
   kept away from the payment gateway and opened only in the panel; an
   Aadhaar number is never shown in full outside the panel. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RULES = require('../assets/field-rules.js');
const TAXID = require('../lib/tax-id.js');
const { parsePaymentRequest } = require('../lib/payment.js');
const route = require('../lib/routes/payment/tax-id.js');

const AADHAAR = '234567890124';
const TOKEN = 'c'.repeat(48);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 3)]);
const url = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;
const customer = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com' };
const donation = (more) => Object.assign({ type: 'donate', ...customer, address: '16 MG Road', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes' }, more);
const membership = (tier, more) => Object.assign({ type: 'membership', tier, ...customer, house: '12', street: 'Car Street', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes' }, more);

function fakeDb() {
  const store = new Map();
  const put = (obj, dotted, value) => {
    const keys = dotted.split('.');
    let at = obj;
    for (const k of keys.slice(0, -1)) { at[k] = Object.assign({}, at[k]); at = at[k]; }
    at[keys[keys.length - 1]] = value;
  };
  const docRef = (c, id) => ({
    id,
    parent: { doc: (other) => docRef(c, other) },
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(`${c}/${id}`); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(`${c}/${id}`)) throw new Error('already exists'); store.set(`${c}/${id}`, Object.assign({}, data)); },
    async set(data, opts) { const prev = (opts && opts.merge && store.get(`${c}/${id}`)) || {}; store.set(`${c}/${id}`, Object.assign({}, prev, data)); },
    async update(change) {
      const prev = store.get(`${c}/${id}`);
      if (!prev) throw new Error('no document to update');
      const next = JSON.parse(JSON.stringify(prev));
      for (const [k, v] of Object.entries(change)) put(next, k, v);
      store.set(`${c}/${id}`, next);
    }
  });
  return { store, collection: (c) => ({ doc: (id) => docRef(c, id) }) };
}
function request(body) {
  const r = new EventEmitter(); r.method = 'POST'; r.headers = {}; r.query = {};
  process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(req, res); return res;
}

test('an Aadhaar number is twelve digits with UIDAI\'s check digit; one slip is caught', () => {
  assert.equal(RULES.checkField('aadhaar', AADHAAR), null);
  assert.equal(RULES.checkField('aadhaar', '2345 6789 0124'), null, 'typed in fours');
  assert.match(RULES.checkField('aadhaar', '234567890125'), /not right/, 'one digit wrong');
  assert.match(RULES.checkField('aadhaar', '234567809124'), /not right/, 'two digits swapped');
  assert.match(RULES.checkField('aadhaar', '1234'), /12 digits/);
  assert.equal(RULES.normaliseField('aadhaar', '2345 6789 0124'), AADHAAR);
  assert.equal(RULES.filterField('aadhaar', '234567890124'), '2345 6789 0124');
});

test('nothing about a PAN or Aadhaar is asked for before paying, at any amount', () => {
  for (const amount of ['111', '4999', '5000', '25000', '500000']) {
    const p = parsePaymentRequest(donation({ amount }));
    assert.equal(p.customer.pan, '', amount);
    assert.equal(p.customer.aadhaar, undefined, amount);
    assert.equal(p.metadata.taxId, undefined, amount);
  }
  /* a card sent anyway by an old tab is not required, and not kept */
  const old = parsePaymentRequest(donation({ amount: '5000', idType: 'aadhaar', aadhaar: AADHAAR, taxIdDoc: TOKEN }));
  assert.equal(old.customer.aadhaar, undefined); assert.equal(old.metadata.taxId, undefined);
  /* a PAN a client still sends is checked and kept, as before */
  assert.equal(parsePaymentRequest(donation({ amount: '1500', pan: 'abcpr1234f' })).customer.pan, 'ABCPR1234F');
  assert.throws(() => parsePaymentRequest(donation({ amount: '1500', pan: 'ABC' })), /PAN/);
  assert.doesNotMatch(JSON.stringify(parsePaymentRequest(donation({ amount: '1500', pan: 'abcpr1234f' })).merchantValues), /ABCPR1234F/, 'never to CCAvenue');
});

test('every membership, Platinum and Lifetime too, is paid for without the card', () => {
  for (const tier of ['student', 'silver', 'golden', 'platinum', 'lifetime']) {
    const p = parsePaymentRequest(membership(tier));
    assert.equal(p.metadata.taxId, undefined, tier);
    assert.equal(p.customer.aadhaar, undefined, tier);
    assert.equal(p.customer.pan, undefined, tier);
  }
});

test('the photo is checked by its bytes, kept under a token, and moved beside the record when the payment clears', async () => {
  const db = fakeDb();
  const handler = route._private.createHandler({ getDb: () => db });
  assert.equal((await run(handler, request({ type: 'passport', photo: url('image/jpeg', JPEG) }))).body.field, 'idType');
  const junk = await run(handler, request({ type: 'pan', photo: url('image/jpeg', Buffer.from('<html>')) }));
  assert.equal(junk.body.ok, false); assert.equal(junk.body.field, 'taxIdDoc');
  const ok = await run(handler, request({ type: 'aadhaar', photo: url('image/jpeg', JPEG) }));
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
  assert.ok(TAXID.isToken(ok.body.token));
  assert.ok(db.store.get(`taxIdDocuments/${ok.body.token}/attachments/tax-id`), 'kept until the payment clears');

  const record = db.collection('submissions').doc('PFA-DON-2026-00009');
  const at = new Date().toISOString();
  assert.deepEqual(await route.attachTo(db, ok.body.token, record, at), { type: 'aadhaar', label: 'Aadhaar card', read: null });
  const beside = db.store.get('submissions/PFA-DON-2026-00009/attachments/tax-id');
  assert.equal(beside.label, 'Aadhaar card'); assert.equal(beside.contentType, 'image/jpeg');
  assert.equal(db.store.get(`taxIdDocuments/${ok.body.token}`).consumed, true);
  /* again, as a twin callback would: nothing twice */
  assert.deepEqual(await route.attachTo(db, ok.body.token, record, at), { type: 'aadhaar', label: 'Aadhaar card', read: null });
  assert.equal(await route.attachTo(db, 'd'.repeat(48), record, at), null, 'an unknown token attaches nothing');
});

test('the record keeps the number for the panel; receipts, letters and the inbox copy show an Aadhaar by its last four digits', () => {
  assert.equal(TAXID.masked('aadhaar', AADHAAR), 'XXXX XXXX 0124');
  assert.equal(TAXID.masked('pan', 'ABCPR1234F'), 'ABCPR1234F');
  const response = read('lib/routes/payment/response.js');
  assert.match(response, /aadhaar: TAXID\.masked\('aadhaar', customer\.aadhaar\)/, 'the donation fields, which the inbox copy shows');
  assert.match(response, /\[card\.type\]: card\.shown/, 'the membership fields, likewise');
  assert.match(response, /if \(carded\) await markFiled\(orderId, \{ donationReference: reference \}\)/, 'a photo not attached yet is tried again on the next callback');
  assert.match(response, /if \(carded\) await markFiled\(orderId, \{ membershipReference: reference \}\)/);
  const receipt = read('lib/donation-receipt.js');
  assert.match(receipt, /Aadhaar XXXX XXXX \$\{d\.aadhaar\}/);
  assert.match(receipt, /aadhaar: clean\(customer\.aadhaar, 14\)\.replace\(\/\\D\/g, ''\)\.slice\(-4\)/);
  /* the panel: the number in full beside the photo */
  assert.match(read('lib/routes/admin/case.js'), /taxId: data\.taxId && data\.taxId\.type \?/);
  assert.match(read('lib/routes/admin/attachment.js'), /\|\| raw === 'tax-id'/);
  const admin = read('admin.html');
  assert.match(admin, /if \(c\.taxId\) out\.push\('<div data-tax-id="/);
  assert.match(admin, /<script src="assets\/admin-taxid\.js"><\/script>/);
  assert.match(read('assets/admin-taxid.js'), /n=tax-id/);
  /* unpaid photos are emptied by the daily cron */
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/payment\/tax-id'\)\.sweep\(getDb\(\)\)/);
  assert.match(read('api/index.js'), /'payment\/tax-id': \(\) => require\('\.\.\/lib\/routes\/payment\/tax-id\.js'\)/);
});

test('neither form asks for the card before paying; the page from the receipt email does, and says why', () => {
  for (const page of ['donate.html', 'get-involved.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /data-tax-id/, `${page}: no card block`);
    assert.doesNotMatch(html, /assets\/tax-id\.js/, `${page}: no card script`);
    assert.doesNotMatch(html, /PFATaxId/, page);
    assert.doesNotMatch(html, /id="gPan"/, `${page}: no PAN box either`);
  }
  assert.match(read('donate.html'), /with a link to add your PAN or Aadhaar if you need the 80G tax receipt/);
  const html = read('tax-receipt.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const at = html.indexOf('id="trTax"');
  const block = html.slice(at, html.indexOf('name="taxIdDoc"', at));
  assert.match(block, /data-tax-id data-name-from="#trName"/);
  assert.match(block, /<details class="taxid__more"><summary>Why we ask, and who sees it<\/summary>/);
  assert.match(block, /yearly statement of donations/);
  assert.match(block, /never sent to the payment gateway/);
  assert.match(block, /name="idType" value="pan"/); assert.match(block, /name="idType" value="aadhaar"/);
  assert.match(block, /type="file" accept="image\/\*"/);
  assert.match(html, /<script src="assets\/tax-id\.js"><\/script>/);
  /* the key rides in the fragment and is posted, never put in a URL */
  assert.match(html, /location\.hash/);
  assert.match(html, /fetch\('\/api\/payment\/tax-receipt'/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname\)/);
  assert.match(html, /window\.PFATaxId\.upload\(box\)/);
  const js = read('assets/tax-id.js');
  assert.match(js, /fetch\('\/api\/payment\/tax-id'/);
  assert.match(read('privacy.html'), /your PAN or Aadhaar number and a photo of that card/);
  assert.match(read('scripts/build-search-index.js'), /'tax-receipt\.html'/, 'not in site search');
});

/* ---- after paying: the link, the page, the record (10 Nov 2026) ---- */

const RECEIPT = require('../lib/donation-receipt.js');
const KEY = 'abcdefghijklmnopqrstuvwx';
const tr = require('../lib/routes/payment/tax-receipt.js');

function paid(over) {
  return Object.assign({
    type: 'donate', status: 'success', currency: 'INR', amount: 6000, receiptKey: KEY,
    donationReference: 'PFA-DON-2026-00031', threadId: 'abc123def456', receiptIssuedAt: '2026-11-10T06:00:00Z',
    customer: { name: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', address: '16 MG Road', city: 'Udupi', state: 'Karnataka', pin: '576101', pan: '' },
    metadata: { cause: 'Hospitals' }
  }, over);
}

async function world(order, t) {
  const db = fakeDb();
  await db.collection('transactions').doc(order).set(t);
  const ref = t.type === 'membership' ? t.membershipReference : t.donationReference;
  if (ref) await db.collection('submissions').doc(ref).set({ reference: ref, status: 'new', fields: { name: t.customer.name }, history: [{ status: 'new', at: '2026-11-10T06:00:00Z', note: 'Paid.' }] });
  const told = [];
  const handler = tr.createHandler({
    getDb: () => db, siteUrl: 'https://peopleforanimalsindia.org',
    getTransaction: async (id) => { const d = db.store.get(`transactions/${id}`); return d ? { id, ...d } : null; },
    tell: async (x) => { told.push(x); }
  });
  const photo = route._private.createHandler({ getDb: () => db });
  return { db, told, handler, photo };
}

test('the receipt email, the welcome letter and the thank-you page link to the page, in rupees, until a card is on record', () => {
  const R = require('../lib/routes/payment/response.js')._private;
  const site = 'https://peopleforanimalsindia.org';
  assert.equal(R.taxUrlFor(site, paid(), 'PFA-DON-ABCD1234'), `${site}/tax-receipt.html#o=PFA-DON-ABCD1234&k=${KEY}`);
  assert.equal(R.taxUrlFor(site, paid({ type: 'membership' }), 'PFA-MEM-ABCD1234'), `${site}/tax-receipt.html#o=PFA-MEM-ABCD1234&k=${KEY}`);
  assert.equal(R.taxUrlFor(site, paid({ currency: 'USD' }), 'PFA-DON-ABCD1234'), '', 'no 80G on dollars');
  assert.equal(R.taxUrlFor(site, paid({ customer: { pan: 'ABCPR1234F' } }), 'PFA-DON-ABCD1234'), '', 'a PAN already given');
  assert.equal(R.taxUrlFor(site, paid({ type: 'caregiver-application' }), 'PFA-CGA-ABCD1234'), '');
  assert.equal(R.taxUrlFor(site, paid({ receiptKey: '' }), 'PFA-DON-ABCD1234'), '');
  const m = require('../lib/caregiver-mail.js');
  const url = `${site}/tax-receipt.html#o=PFA-DON-ABCD1234&k=${KEY}`;
  for (const t of ['payment_received', 'membership_welcome']) {
    const r = m.render(t, { siteUrl: site, name: 'Asha Rao', amount: 6000, currency: 'INR', orderId: 'PFA-DON-ABCD1234', memberId: 'PFA-MEM-2026-00007', tierLabel: 'Platinum membership', kit: [], paidAt: '2026-11-10T06:00:00Z', taxUrl: url });
    assert.ok(r.html.includes(`href="${url.replace('&', '&amp;')}"`), t);
    assert.match(r.html, /Need the 80G tax receipt\?/, t);
    assert.ok(r.text.includes(url), t);
    const none = m.render(t, { siteUrl: site, name: 'Asha Rao', amount: 6000, currency: 'INR', orderId: 'PFA-DON-ABCD1234', memberId: 'PFA-MEM-2026-00007', kit: [], paidAt: '2026-11-10T06:00:00Z', taxUrl: 'https://evil.example/x' });
    assert.doesNotMatch(none.html, /Need the 80G tax receipt/, `${t}: only a link to the page itself`);
  }
  const response = read('lib/routes/payment/response.js');
  assert.match(response, /if \(transaction\.type === 'donate' \|\| transaction\.type === 'membership'\) \{\s*try \{\s*receiptKey = \(await RECEIPT\.keyFor/, 'a member is given a key too');
  assert.match(response, /Add PAN or Aadhaar for 80G/, 'the thank-you page');
  assert.match(read('api/index.js'), /'payment\/tax-receipt': \(\) => require\('\.\.\/lib\/routes\/payment\/tax-receipt\.js'\)/);
});

test('the page opens only with the key of a paid rupee payment, and says what it was', async () => {
  const { handler } = await world('PFA-DON-ABCD1234', paid());
  const open = (o, k) => run(handler, request({ action: 'open', o, k }));
  const ok = await open('PFA-DON-ABCD1234', KEY);
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
  assert.equal(ok.body.first, 'Asha'); assert.equal(ok.body.amount, '\u20b96,000.00'); assert.equal(ok.body.given, null);
  assert.equal(ok.body.kind, 'donation');
  assert.match(ok.body.receiptUrl, /\/api\/payment\/receipt\?order=PFA-DON-ABCD1234&k=/);
  for (const [o, k] of [['PFA-DON-ABCD1234', 'x'.repeat(24)], ['PFA-DON-ZZZZ9999', KEY], ['PFA-CGA-ABCD1234', KEY], ['', '']]) {
    const res = await open(o, k);
    assert.equal(res.statusCode, 404, `${o} ${k}`); assert.equal(res.body.ok, false);
  }
  for (const over of [{ status: 'pending' }, { currency: 'USD' }]) {
    const w = await world('PFA-DON-ABCD1234', paid(over));
    assert.equal((await run(w.handler, request({ action: 'open', o: 'PFA-DON-ABCD1234', k: KEY }))).statusCode, 404, JSON.stringify(over));
  }
  assert.equal((await run(handler, Object.assign(request({}), { method: 'GET' }))).statusCode, 405, 'the key never in a URL');
});

test('a PAN given after paying is filed on the record and the payment, printed on the receipt, and given once', async () => {
  const { db, told, handler, photo } = await world('PFA-DON-ABCD1234', paid());
  const up = await run(photo, request({ type: 'pan', photo: url('image/jpeg', JPEG) }));
  assert.equal(up.body.ok, true);
  const bad = await run(handler, request({ o: 'PFA-DON-ABCD1234', k: KEY, idType: 'pan', pan: 'ABC', taxIdDoc: up.body.token }));
  assert.equal(bad.statusCode, 422); assert.equal(bad.body.field, 'pan');
  assert.doesNotMatch(bad.body.error, /Income Tax Department/, 'no lecture on the page that already said why');
  const noPhoto = await run(handler, request({ o: 'PFA-DON-ABCD1234', k: KEY, idType: 'pan', pan: 'ABCPR1234F' }));
  assert.equal(noPhoto.statusCode, 422); assert.equal(noPhoto.body.field, 'taxIdDoc');
  const ok = await run(handler, request({ o: 'PFA-DON-ABCD1234', k: KEY, idType: 'pan', pan: 'abcpr1234f', taxIdDoc: up.body.token }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.given, { type: 'pan', label: 'PAN card', shown: 'ABCPR1234F' });
  const record = db.store.get('submissions/PFA-DON-2026-00031');
  assert.equal(record.fields.pan, 'ABCPR1234F');
  assert.equal(record.taxId.number, 'ABCPR1234F'); assert.equal(record.taxId.photo, 'attached'); assert.equal(record.taxId.givenAfterPayment, true);
  assert.equal(record.taxId.cardMatch, 'by-eye');
  assert.match(record.history[record.history.length - 1].note, /PAN given for the 80G receipt, after paying/);
  assert.equal(record.history.length, 2, 'the earlier history kept');
  assert.ok(db.store.get('submissions/PFA-DON-2026-00031/attachments/tax-id'), 'the photo beside the record');
  const t = db.store.get('transactions/PFA-DON-ABCD1234');
  assert.equal(t.customer.pan, 'ABCPR1234F'); assert.equal(t.customer.name, 'Asha Rao', 'the rest of the customer kept');
  assert.equal(t.taxIdGiven.type, 'pan');
  assert.equal(RECEIPT.dataFrom({ orderId: 'PFA-DON-ABCD1234', ...t }).pan, 'ABCPR1234F', 'the PDF receipt prints it');
  assert.equal(told.length, 1); assert.equal(told[0].reference, 'PFA-DON-2026-00031'); assert.equal(told[0].card.shown, 'ABCPR1234F');
  /* once: a forwarded link cannot change it */
  const again = await run(handler, request({ o: 'PFA-DON-ABCD1234', k: KEY, idType: 'pan', pan: 'ABCPR9999F', taxIdDoc: up.body.token }));
  assert.equal(again.statusCode, 409); assert.match(again.body.error, /already has your PAN.*write to PFA quoting PFA-DON-ABCD1234/);
  assert.equal(db.store.get('transactions/PFA-DON-ABCD1234').customer.pan, 'ABCPR1234F');
  assert.equal(told.length, 1);
  assert.deepEqual((await run(handler, request({ action: 'open', o: 'PFA-DON-ABCD1234', k: KEY }))).body.given, { type: 'pan', label: 'PAN card', shown: 'ABCPR1234F' });
});

test('a member\'s Aadhaar is kept in full for the panel and shown by its last four digits everywhere else', async () => {
  const { db, told, handler, photo } = await world('PFA-MEM-ABCD1234', paid({ type: 'membership', amount: 5000, donationReference: '', membershipReference: 'PFA-MEM-2026-00007', metadata: { tierLabel: 'Platinum membership' } }));
  const up = await run(photo, request({ type: 'aadhaar', photo: url('image/jpeg', JPEG) }));
  const ok = await run(handler, request({ o: 'PFA-MEM-ABCD1234', k: KEY, idType: 'aadhaar', aadhaar: '2345 6789 0124', taxIdDoc: up.body.token }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.given.shown, 'XXXX XXXX 0124'); assert.equal(ok.body.receiptUrl, '', 'a membership has no PDF receipt');
  assert.equal(ok.body.kind, 'membership'); assert.equal(ok.body.tier, 'Platinum membership');
  const record = db.store.get('submissions/PFA-MEM-2026-00007');
  assert.equal(record.fields.aadhaar, 'XXXX XXXX 0124', 'what the inbox copy may show');
  assert.equal(record.taxId.number, AADHAAR, 'the panel, in full');
  assert.equal(record.taxId.cardMatch, 'unread');
  assert.equal(db.store.get('transactions/PFA-MEM-ABCD1234').customer.aadhaar, AADHAAR);
  assert.equal(told[0].card.shown, 'XXXX XXXX 0124');
});

test('the donor is told, and the payments inboxes, never gandhim, are told without the full Aadhaar', () => {
  const m = require('../lib/caregiver-mail.js');
  const p = { kind: 'membership', name: 'Asha Rao', amount: 5000, orderId: 'PFA-MEM-ABCD1234', reference: 'PFA-MEM-2026-00007', idLabel: 'Aadhaar', shown: 'XXXX XXXX 0124', photo: 'attached', cardMatch: 'unread', checks: [], email: 'asha@example.com', mobile: '9876543210' };
  const staff = m.render('tax_id_staff', p);
  assert.doesNotMatch(staff.html + staff.text, new RegExp(AADHAAR));
  assert.match(staff.text, /XXXX XXXX 0124/);
  assert.equal(m.moneyToWrongInbox('gandhim@exmpls.sansad.in', 'tax_id_staff', p), true);
  assert.equal(m.moneyToWrongInbox('pfadcmho@gmail.com', 'tax_id_staff', p), false);
  assert.equal(m.moneyToWrongInbox('ozairhusain@gmail.com', 'tax_id_staff', p), false);
  const mine = m.render('tax_id_received', { ...p, receiptUrl: '' });
  assert.match(mine.subject, /Your Aadhaar is with PFA/);
  assert.doesNotMatch(mine.html + mine.text, new RegExp(AADHAAR));
  const route = read('lib/routes/payment/tax-receipt.js');
  assert.match(route, /for \(const to of FORWARD\.paymentInboxes\(\)\)/, 'only the payments inboxes');
});

/* ---- enterprise-grade checks (owner, 7 Nov 2026: "hope you can validate
   whether the input pan and aadhar number is valid or not. enterprise grade
   validation", with the open-source PAN and Aadhaar validators on GitHub as
   the bar: shape, the PAN's holder letter, Verhoeff. Held here beyond that:
   every single-digit slip and swap caught, Virtual IDs and masked numbers
   told apart, the PAN's name letter compared with the donor, and the
   Aadhaar card's own QR code read from the photo and matched to the number
   typed, before anyone pays.) ---- */

const zlib = require('zlib');

test('Verhoeff catches every one-digit slip and every swap of two neighbours', () => {
  let tried = 0;
  for (const good of ['234567890124', '987654321098'.slice(0, 11), '450123987651'.slice(0, 11)].map((b) => {
    if (b.length === 12) return b;
    for (let d = 0; d < 10; d += 1) if (RULES.isAadhaar(b + d)) return b + d;
    return null;
  }).filter(Boolean)) {
    assert.ok(RULES.isAadhaar(good), good);
    for (let i = 1; i < 12; i += 1) {
      for (let d = 0; d < 10; d += 1) {
        if (String(d) === good[i]) continue;
        const slip = good.slice(0, i) + d + good.slice(i + 1);
        assert.equal(RULES.isAadhaar(slip), false, `${slip}, one digit off ${good}`); tried += 1;
      }
      if (i < 11 && good[i] !== good[i + 1]) {
        const swap = good.slice(0, i) + good[i + 1] + good[i] + good.slice(i + 2);
        assert.equal(RULES.isAadhaar(swap), false, `${swap}, two digits of ${good} swapped`); tried += 1;
      }
    }
  }
  assert.ok(tried > 250);
});

test('Aadhaar: a Virtual ID, a masked number, a 0 or 1 start and a run of one digit are each told in their own words', () => {
  assert.match(RULES.checkField('aadhaar', '2345 6789 0124 5678'), /Virtual ID/);
  assert.match(RULES.checkField('aadhaar', 'XXXX XXXX 0124'), /masked Aadhaar shows only the last four/);
  assert.match(RULES.checkField('aadhaar', '134567890124'), /never starts with 0 or 1/);
  assert.match(RULES.checkField('aadhaar', '222222222222'), /not right/);
  assert.throws(() => TAXID.read({ idType: 'aadhaar', aadhaar: 'XXXX XXXX 0124', taxIdDoc: TOKEN }), /masked/);
});

test('PAN: the holder letter, the serial and the example are checked; the name letter is compared with the donor', () => {
  assert.equal(RULES.checkField('pan', 'ABCPR1234F'), null);
  for (const [k, holder] of [['C', 'a company'], ['T', 'a trust'], ['H', 'a Hindu undivided family'], ['F', 'a firm or LLP'], ['G', 'a government body']]) {
    assert.equal(RULES.checkField('pan', `ABC${k}R1234F`), null, k);
    assert.equal(RULES.panHolder(`ABC${k}R1234F`), holder);
  }
  assert.match(RULES.checkField('pan', 'ABCXR1234F'), /4th letter/);
  assert.match(RULES.checkField('pan', 'ABCDE1234F'), /example PAN/);
  assert.match(RULES.checkField('pan', 'ABCPR0000F'), /never 0000/);
  assert.match(RULES.checkField('pan', 'ABCP1234FR'), /five letters, four digits and a letter/);
  /* the 5th letter: the first letter of a personal holder's surname */
  assert.equal(RULES.panNameOk('ABCPR1234F', 'Asha Rao'), true);
  assert.equal(RULES.panNameOk('ABCPA1234F', 'Asha Rao'), true, 'or of the name, when there is no surname');
  assert.equal(RULES.panNameOk('ABCPK1234F', 'Asha Rao'), false);
  assert.equal(RULES.panNameOk('ABCCK1234F', 'Asha Rao'), true, 'a company\'s PAN is not compared with a person\'s name');
  assert.equal(RULES.namesAgree('ASHA K RAO', 'Asha Rao'), true);
  assert.equal(RULES.namesAgree('K. D.', 'Karthik Dhanya'), true, 'initials');
  assert.equal(RULES.namesAgree('Meera Das', 'Asha Rao'), false);
});

/* A photo of an Aadhaar card with a QR code on it, made the way UIDAI makes
   them: the Secure QR (gzip, fields split by byte 255, the reference ID
   starting with the last four digits) and the older printed XML one. */
function cardPhoto(text) {
  const QR = require('qrcode');
  const jpeg = require('jpeg-js');
  const q = QR.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size, scale = 5, w = 1500, h = 950, ox = w - 120 - n * scale, oy = 110;
  const data = Buffer.alloc(w * h * 4, 238);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const mx = Math.floor((x - ox) / scale), my = Math.floor((y - oy) / scale);
    const on = mx >= 0 && my >= 0 && mx < n && my < n && q.modules.get(my, mx);
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = on ? 25 : 240; data[i + 3] = 255;
  }
  return jpeg.encode({ width: w, height: h, data }, 85).data;
}
function secureQr(last4, name) {
  const fields = ['V2', '3', `${last4}20190805123456789`, name, '01-01-1990', 'F', 'D/O Ravi', 'Udupi', '', '12', 'Kodavoor', '576101', 'Udupi', 'Karnataka'];
  const raw = Buffer.concat(fields.flatMap((f) => [Buffer.from(f, 'latin1'), Buffer.from([255])]).concat([Buffer.alloc(300, 7), Buffer.alloc(256, 9)]));
  return BigInt('0x' + zlib.gzipSync(raw).toString('hex')).toString(10);
}

test('the QR code on an Aadhaar card is read from its photo, Secure QR and the older printed one alike', () => {
  const AQ = require('../lib/aadhaar-qr.js');
  const READ = require('../lib/card-read.js');
  assert.deepEqual(AQ.parse(secureQr('0124', 'Asha Rao')), { kind: 'aadhaar-secure-qr', version: 'V2', last4: '0124', uid: '', name: 'Asha Rao', dob: '01-01-1990' });
  const xml = '<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="234567890124" name="Asha Rao" gender="F" yob="1990"/>';
  assert.deepEqual(AQ.parse(xml), { kind: 'aadhaar-printed-qr', version: 'xml', last4: '0124', uid: '234567890124', name: 'Asha Rao', dob: '1990' });
  assert.equal(AQ.parse('https://example.com'), null, 'any other QR is not an Aadhaar');
  const fromPhoto = READ.readAadhaar(cardPhoto(secureQr('0124', 'Asha Rao')), 'image/jpeg');
  assert.equal(fromPhoto && fromPhoto.last4, '0124');
  assert.equal(READ.readAadhaar(cardPhoto(xml), 'image/jpeg').uid, '234567890124');
  assert.equal(READ.readAadhaar(Buffer.from('not a photo'), 'image/jpeg'), null, 'never throws');
});

test('a number that is not the card in the photo is refused', async () => {
  const db = fakeDb();
  const handler = route._private.createHandler({ getDb: () => db });
  const photo = `data:image/jpeg;base64,${cardPhoto(secureQr('0124', 'Asha Rao')).toString('base64')}`;
  const up = await run(handler, request({ type: 'aadhaar', photo }));
  assert.equal(up.body.ok, true, JSON.stringify(up.body));
  assert.deepEqual(up.body.read, { kind: 'aadhaar-secure-qr', last4: '0124', name: 'Asha Rao' }, 'the form is told at once');
  const t = { type: 'aadhaar', token: up.body.token };
  assert.equal((await route.confirm(db, t, AADHAAR)).last4, '0124');
  const other = (() => { for (let d = 0; d < 10; d += 1) if (RULES.isAadhaar(`23456789123${d}`)) return `23456789123${d}`; return ''; })();
  await assert.rejects(route.confirm(db, t, other), /does not match the card in the photo: the QR code on that card is for an Aadhaar ending 0124/);
  await assert.rejects(route.confirm(db, { type: 'pan', token: up.body.token }, 'ABCPR1234F'), /photo attached is of a Aadhaar card|Attach the photo of the same card/);
  await assert.rejects(route.confirm(db, { type: 'aadhaar', token: 'f'.repeat(48) }, AADHAAR), /Attach it again/);
  /* checked when the card is given, after paying, never before (10 Nov 2026) */
  assert.doesNotMatch(read('lib/routes/payment/create.js'), /taxIdDoc/);
  assert.match(read('lib/routes/payment/tax-receipt.js'), /await taxIdDoc\.confirm\(db, \{ type: card\.type, token: card\.token \}, card\.number\)/);
});

test('the form reads the card as soon as it is attached and says what it found; the panel lists every check', () => {
  const js = read('assets/tax-id.js');
  assert.match(js, /Reading the QR code on your card/);
  assert.match(js, /Read from the QR code on your card: Aadhaar ending /);
  assert.match(js, /This is not the number on the card in the photo/);
  assert.match(js, /The 5th letter of a personal PAN is the first letter of the holder.{1,6}s surname/);
  assert.match(js, /too small to read the card/);
  assert.match(read('tax-receipt.html'), /data-tax-id data-name-from="#trName"/);
  const panel = read('assets/admin-taxid.js');
  for (const words of ['A valid PAN', "UIDAI\\\\'s check digit right", 'The QR code on the card is for an Aadhaar', 'not this number', 'could not be read from the photo']) assert.ok(panel.includes(words.replace(/\\\\/g, '\\')), words);
  const response = read('lib/routes/payment/response.js');
  assert.match(response, /change\['taxId\.cardMatch'\] = same \? 'matches' : 'differs'/);
  assert.match(response, /RULES\.panNameOk\(number, \(customer \|\| \{\}\)\.name\)/);
});
