'use strict';

/* The PAN or Aadhaar card behind an 80G receipt (owner, 7 Nov 2026: "when
   someone is contributing 5k or more . make providing aadhar or pan upload
   mandatory for 80G receipt. give proper reason to people as well").

   Held here: on 5,000 rupees or more, in rupees, a donation or a membership
   cannot be paid for without the number and a photo of the card; below
   that the PAN stays optional; the reason is said on the page and in the
   API's own refusal; the photo is kept away from the payment, moved beside
   the record when it clears, and opened only in the panel; an Aadhaar
   number is never shown in full outside the panel. */

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
  const docRef = (c, id) => ({
    id,
    parent: { doc: (other) => docRef(c, other) },
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(`${c}/${id}`); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(`${c}/${id}`)) throw new Error('already exists'); store.set(`${c}/${id}`, Object.assign({}, data)); },
    async set(data, opts) { const prev = (opts && opts.merge && store.get(`${c}/${id}`)) || {}; store.set(`${c}/${id}`, Object.assign({}, prev, data)); }
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

test('5,000 rupees or more cannot be paid without the PAN or Aadhaar card; below that the PAN stays optional', () => {
  /* below: as it was */
  const small = parsePaymentRequest(donation({ amount: '4999' }));
  assert.equal(small.customer.pan, ''); assert.equal(small.metadata.taxId, undefined);
  assert.equal(parsePaymentRequest(donation({ amount: '1500', pan: 'abcpr1234f' })).customer.pan, 'ABCPR1234F');
  /* at 5,000: refused with the reason, whichever part is missing */
  for (const missing of [{}, { idType: 'pan' }, { idType: 'pan', pan: 'ABCPR1234F' }, { idType: 'aadhaar', aadhaar: '234567890125', taxIdDoc: TOKEN }]) {
    assert.throws(() => parsePaymentRequest(donation({ amount: '5000', ...missing })), (e) => /PAN|Aadhaar/.test(e.message), JSON.stringify(missing));
  }
  assert.throws(() => parsePaymentRequest(donation({ amount: '5000' })), /Income Tax Department/, 'the reason, in the refusal itself');
  /* with a PAN */
  const pan = parsePaymentRequest(donation({ amount: '5000', idType: 'pan', pan: 'abcpr1234f', taxIdDoc: TOKEN }));
  assert.equal(pan.customer.pan, 'ABCPR1234F');
  assert.deepEqual(pan.metadata.taxId, { type: 'pan', token: TOKEN });
  /* with an Aadhaar */
  const aad = parsePaymentRequest(donation({ amount: '25000', idType: 'aadhaar', aadhaar: '2345 6789 0124', taxIdDoc: TOKEN }));
  assert.equal(aad.customer.aadhaar, AADHAAR); assert.equal(aad.customer.pan, '');
  assert.deepEqual(aad.metadata.taxId, { type: 'aadhaar', token: TOKEN });
  /* neither ever goes to CCAvenue */
  for (const p of [pan, aad]) assert.doesNotMatch(JSON.stringify(p.merchantValues), /ABCPR1234F|234567890124|cccc/);
});

test('Platinum and Lifetime memberships need the card; Student, Silver and Golden do not', () => {
  for (const tier of ['student', 'silver', 'golden']) assert.equal(parsePaymentRequest(membership(tier)).metadata.taxId, undefined, tier);
  for (const tier of ['platinum', 'lifetime']) assert.throws(() => parsePaymentRequest(membership(tier)), /80G/, tier);
  const life = parsePaymentRequest(membership('lifetime', { idType: 'aadhaar', aadhaar: AADHAAR, taxIdDoc: TOKEN }));
  assert.equal(life.customer.aadhaar, AADHAAR);
  assert.deepEqual(life.metadata.taxId, { type: 'aadhaar', token: TOKEN });
  assert.equal(parsePaymentRequest(membership('platinum', { idType: 'pan', pan: 'ABCPR1234F', taxIdDoc: TOKEN })).customer.pan, 'ABCPR1234F');
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

test('both forms ask for it at 5,000 rupees, say why, and send the photo before paying', () => {
  for (const [page, id] of [['donate.html', 'gTax'], ['get-involved.html', 'memTax']]) {
    const html = read(page);
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, page);
    const block = html.slice(at, html.indexOf('name="taxIdDoc"', at));
    assert.match(block, /data-tax-id/);
    assert.match(block, /On &#8377;5,000 or more, your 80G tax certificate can only be issued against your PAN or Aadhaar/, `${page}: the reason, in two lines`);
    assert.match(block, /<details class="taxid__more"><summary>Why we ask, and who sees it<\/summary>/, `${page}: the rest under +`);
    assert.match(block, /yearly statement of donations/);
    assert.match(block, /never sent to the payment gateway/);
    assert.match(block, /name="idType" value="pan"/); assert.match(block, /name="idType" value="aadhaar"/);
    assert.match(block, /name="pan"/); assert.match(block, /name="aadhaar"/);
    assert.match(block, /type="file" accept="image\/\*"/);
    assert.match(html, /<script src="assets\/tax-id\.js"><\/script>/);
  }
  const js = read('assets/tax-id.js');
  assert.match(js, /var THRESHOLD = 5000;/);
  assert.equal(TAXID.THRESHOLD_INR, 5000, 'the page and the API agree');
  assert.match(js, /fetch\('\/api\/payment\/tax-id'/);
  assert.match(read('donate.html'), /window\.PFATaxId\.upload\(taxBox\)\.then\(function\(\)\{ pay\(\); giveForm\.submit\(\); \}\)/);
  assert.match(read('get-involved.html'), /window\.PFATaxId\.upload\(taxBox\)\.then\(function\(\)\{ form\.submit\(\); \}\)/);
  assert.match(read('privacy.html'), /your PAN or Aadhaar number and a photo of that card/);
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

test('a number that is not the card in the photo is refused before the payment starts', async () => {
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
  const create = read('lib/routes/payment/create.js');
  assert.match(create, /await taxIdDoc\.confirm\(getDb\(\), t, parsed\.customer\[t\.type\]\)/);
  assert.ok(create.indexOf('taxIdDoc.confirm') < create.indexOf('createTransaction({'), 'before the transaction is made');
});

test('the form reads the card as soon as it is attached and says what it found; the panel lists every check', () => {
  const js = read('assets/tax-id.js');
  assert.match(js, /Reading the QR code on your card/);
  assert.match(js, /Read from the QR code on your card: Aadhaar ending /);
  assert.match(js, /This is not the number on the card in the photo/);
  assert.match(js, /The 5th letter of a personal PAN is the first letter of the holder.{1,6}s surname/);
  assert.match(js, /too small to read the card/);
  for (const page of ['donate.html', 'get-involved.html']) assert.match(read(page), /data-tax-id data-instead="#gPan" data-name-from="#gName"|data-tax-id data-name-from="#memName"/);
  const panel = read('assets/admin-taxid.js');
  for (const words of ['A valid PAN', "UIDAI\\\\'s check digit right", 'The QR code on the card is for an Aadhaar', 'not this number', 'could not be read from the photo']) assert.ok(panel.includes(words.replace(/\\\\/g, '\\')), words);
  const response = read('lib/routes/payment/response.js');
  assert.match(response, /change\['taxId\.cardMatch'\] = same \? 'matches' : 'differs'/);
  assert.match(response, /RULES\.panNameOk\(number, \(customer \|\| \{\}\)\.name\)/);
});
