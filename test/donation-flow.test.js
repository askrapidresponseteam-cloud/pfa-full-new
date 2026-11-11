'use strict';

/* A donation, walked from the form to the bank and back, through the real
 * handlers. What the page says at the end, what the record says, and what the
 * donor is sent - for a payment that succeeded, one that failed, one the person
 * cancelled, and one where the amount coming back is not the amount that went
 * out. Also that CCAvenue delivering the same success twice, which it does,
 * produces one receipt and not two.
 *
 * Until this existed no test drove /api/payment/create or /api/payment/response
 * as handlers, and nothing noticed that a donor who was asked for "a valid email
 * for the receipt" was never sent one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const firebase = require('../lib/firebase');
const caregiverMail = require('../lib/caregiver-mail');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');
const create = require('../lib/routes/payment/create');
const respond = require('../lib/routes/payment/response');

const WORKING_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const MERCHANT = '123456';

/* Just enough Firestore: documents with get/create/set/update, and a
   transaction whose get/set/update act on the same store. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) {
      if (store.has(key(c, id))) { const e = new Error('Document already exists'); e.code = 6; throw e; }
      store.set(key(c, id), Object.assign({}, data));
    },
    async set(data, opts) {
      const prev = (opts && opts.merge && store.get(key(c, id))) || {};
      store.set(key(c, id), Object.assign({}, prev, data));
    },
    async update(data) {
      if (!store.has(key(c, id))) throw new Error('No document to update');
      store.set(key(c, id), Object.assign({}, store.get(key(c, id)), data));
    }
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => { ref.set(data, opts); },
        create: (ref, data) => { ref.create(data); },
        update: (ref, data) => { ref.update(data); }
      };
      return fn(tx);
    }
  };
}

function request(body, { method = 'POST', url = '/api/payment/create', headers = {} } = {}) {
  return { method, url, headers: Object.assign({ host: 'pfa.test' }, headers), body };
}

function recorder() {
  const headers = {};
  return {
    headers,
    response: {
      statusCode: 200,
      setHeader(n, v) { headers[n] = v; },
      end(raw) { this.html = String(raw || ''); }
    }
  };
}

const DONOR = {
  type: 'donate', currency: 'inr', amount: '1500', terms: 'yes',
  name: 'Asha Kumar', mobile: '9876543210', email: 'Asha@Example.com',
  address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', cause: 'Where it is needed most', pan: 'ABCPK1234F'
};

let db;
let sent;
const realDeliver = caregiverMail.deliver;
const realConfigured = caregiverMail.isConfigured;

test.beforeEach(() => {
  db = fakeDb();
  firebase._setDbForTests(db);
  sent = [];
  caregiverMail.deliver = async (msg) => { sent.push(msg); return { providerId: 'resend_' + sent.length }; };
  caregiverMail.isConfigured = () => true;
  Object.assign(process.env, {
    CCAVENUE_MERCHANT_ID: MERCHANT, CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: WORKING_KEY,
    CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test'
  });
});

test.afterEach(() => {
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
  ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PUBLIC_SITE_URL']
    .forEach((k) => delete process.env[k]);
});

/* Form → /api/payment/create → the hand-off page. Returns what CCAvenue would
   receive, decrypted, which is exactly the request the merchant signed. */
async function start(form = DONOR) {
  const rec = recorder();
  await create(request(form), rec.response);
  assert.equal(rec.response.statusCode, 200, rec.response.html.slice(0, 300));
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(rec.response.html);
  assert.ok(enc, 'the hand-off page carries the encrypted request');
  assert.match(rec.response.html, /action="https:\/\/(test|secure)\.ccavenue\.com/);
  return decodeMerchantData(decrypt(enc[1], WORKING_KEY));
}

/* What CCAvenue posts back after the bank. */
async function callback(values) {
  const rec = recorder();
  const encResp = encrypt(encodeMerchantData(values), WORKING_KEY);
  await respond(request({ encResp }, { url: '/api/payment/response' }), rec.response);
  return rec.response.html;
}

function bankSays(sentOut, overrides = {}) {
  return Object.assign({
    order_id: sentOut.order_id, merchant_id: MERCHANT, amount: sentOut.amount, currency: 'INR',
    order_status: 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI', status_message: ''
  }, overrides);
}

function transaction(orderId) { return db.store.get(`transactions/${orderId}`); }

test('a donation goes to CCAvenue with the server’s amount, comes back verified, and the donor is sent one receipt', async () => {
  const sentOut = await start();
  assert.match(sentOut.order_id, /^PFA-DON-[A-Z0-9]{8}$/);
  assert.equal(sentOut.amount, '1500.00');
  assert.equal(sentOut.merchant_id, MERCHANT);
  assert.equal(sentOut.redirect_url, 'https://pfa.test/api/payment/response');
  assert.equal(sentOut.cancel_url, sentOut.redirect_url);
  assert.equal(sentOut.billing_email, 'asha@example.com');

  const before = transaction(sentOut.order_id);
  assert.ok(before, 'the transaction is on record before the bank is involved');
  assert.notEqual(before.status, 'success');

  const page = await callback(bankSays(sentOut));
  assert.match(page, /Donation successful/);
  assert.match(page, new RegExp(sentOut.order_id));
  /* the address in bold, so a mistyped one is seen, and where to look for it */
  assert.match(page, /A receipt has been emailed to <strong>asha@example\.com<\/strong>/);
  assert.match(page, /Spam or Junk/);

  const after = transaction(sentOut.order_id);
  assert.equal(after.status, 'success');
  assert.equal(after.ccaVenue.trackingId, '31233');
  assert.equal(after.ccaVenue.bankReference, 'BNK900');
  assert.ok(after.receiptSentAt, 'the receipt is recorded on the transaction');

  /* the donor's receipt, and the copy of the gift to PFA's inbox (v1.399) */
  const receipts = sent.filter((m) => m.template === 'payment_received');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].to, 'asha@example.com');
  assert.equal(receipts[0].payload.orderId, sentOut.order_id);
  assert.equal(receipts[0].payload.amount, 1500);
  assert.equal(receipts[0].payload.bankReference, 'BNK900');
  const copies = sent.filter((m) => m.template === 'submission_forward');
  /* a record of money goes to the payments pair, never gandhim (owner,
     21 Oct 2026) */
  assert.deepEqual(copies.map((m) => m.to).sort(), ['ozairhusain@gmail.com', 'pfadcmho@gmail.com'], 'one copy to each payments inbox');
  assert.ok(!sent.some((m) => m.to === 'gandhim@exmpls.sansad.in'), 'and nothing to gandhim');
  assert.equal(copies[0].payload.email, 'asha@example.com', 'Reply-To the donor');
  assert.equal(copies[0].payload.kind, 'PFA-DON');
});

test('CCAvenue delivering the same success twice changes nothing and sends nothing more', async () => {
  const sentOut = await start();
  await callback(bankSays(sentOut));
  const again = await callback(bankSays(sentOut));
  assert.match(again, /Donation successful/, 'the second visit still shows the donor their result');
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'one receipt');
  assert.equal(sent.filter((m) => m.template === 'submission_forward').length, 2, 'one copy to each payments inbox, once');
  assert.equal(transaction(sentOut.order_id).status, 'success');
});

test('a failed payment is a failed payment: recorded, shown, and no receipt', async () => {
  const sentOut = await start();
  const page = await callback(bankSays(sentOut, { order_status: 'Failure', status_message: 'Insufficient funds', bank_ref_no: '' }));
  assert.match(page, /Payment was not completed/);
  assert.match(page, /Insufficient funds/);
  assert.equal(transaction(sentOut.order_id).status, 'failed');
  assert.equal(sent.length, 0);
});

test('a payment the person cancelled reads as cancelled, not as an error of theirs', async () => {
  const sentOut = await start();
  const page = await callback(bankSays(sentOut, { order_status: 'Aborted', bank_ref_no: '' }));
  assert.match(page, /Payment was cancelled/);
  assert.equal(transaction(sentOut.order_id).status, 'aborted');
  assert.equal(sent.length, 0);
});

test('a success for a different amount is never treated as success', async () => {
  const sentOut = await start();
  const page = await callback(bankSays(sentOut, { amount: '15.00' }));
  assert.doesNotMatch(page, /Donation successful/);
  assert.equal(transaction(sentOut.order_id).status, 'verification_failed');
  assert.equal(sent.length, 0);
});

test('a success that fails after a real failure is still a success, because the bank is the source of truth', async () => {
  const sentOut = await start();
  await callback(bankSays(sentOut, { order_status: 'Failure' }));
  assert.equal(transaction(sentOut.order_id).status, 'failed');
  const page = await callback(bankSays(sentOut));
  assert.match(page, /Donation successful/);
  assert.equal(transaction(sentOut.order_id).status, 'success');
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1);
});

test('the receipt is a courtesy: a mail provider that hangs does not hold up or fail the page', async () => {
  caregiverMail.deliver = () => new Promise(() => {});
  const sentOut = await start();
  const started = Date.now();
  const page = await callback(bankSays(sentOut));
  assert.ok(Date.now() - started < 4000, 'the page is not held hostage by the mail provider');
  assert.match(page, /Donation successful/);
  assert.doesNotMatch(page, /A receipt has been emailed/);
  assert.equal(transaction(sentOut.order_id).status, 'success');
  assert.equal(transaction(sentOut.order_id).receiptSentAt, undefined);
});


test('the same form posted twice under one key is one transaction; a paid key cannot be reused', async () => {
  const headers = { 'idempotency-key': 'donor-once' };
  const first = recorder();
  await create(request(DONOR, { headers }), first.response);
  const second = recorder();
  await create(request(DONOR, { headers }), second.response);
  const a = /name="encRequest" value="([0-9a-f]+)"/.exec(first.response.html)[1];
  const b = /name="encRequest" value="([0-9a-f]+)"/.exec(second.response.html)[1];
  const idA = decodeMerchantData(decrypt(a, WORKING_KEY)).order_id;
  const idB = decodeMerchantData(decrypt(b, WORKING_KEY)).order_id;
  assert.equal(idA, idB, 'a double submit is one PFA transaction');

  await callback(bankSays(decodeMerchantData(decrypt(a, WORKING_KEY))));
  const third = recorder();
  await create(request(DONOR, { headers }), third.response);
  assert.equal(third.response.statusCode, 409);
  assert.match(third.response.html, /already completed/);
});

/* ---- a donation given as a gift (owner, 8 Oct 2026: "make a gift cert
   should be there, like peopleforanimalsindia.org/make-a-gift.html, payment
   to follow the same donate flow"). The same CCAvenue path; the person it is
   for is posted a Certificate of Appreciation, and the copy to PFA's inbox
   says so before anything else. */

const GIFT = Object.assign({}, DONOR, {
  amount: '2500', gift: 'yes', giftTo: 'ravi menon', giftAddress: '12 Lake View Road, Indiranagar, Bengaluru',
  giftPin: '560038', giftOccasion: 'Birthday', giftEmail: 'Ravi@Example.com'
});

async function refused(form) {
  const rec = recorder();
  await create(request(form), rec.response);
  return rec.response;
}

test('a gift goes through the same CCAvenue flow, and the certificate to post is the first thing PFA reads', async () => {
  const sentOut = await start(GIFT);
  assert.match(sentOut.order_id, /^PFA-DON-[A-Z0-9]{8}$/, 'a donation, on the donation rails');
  assert.equal(sentOut.amount, '2500.00');
  assert.equal(sentOut.merchant_param2, 'PFA Gift');
  assert.equal(sentOut.billing_name, 'Asha Kumar', 'the donor pays and is receipted');
  assert.doesNotMatch(JSON.stringify(sentOut), /Ravi|Lake View|560038/i, 'CCAvenue is never given the recipient\'s name or address');

  const page = await callback(bankSays(sentOut));
  assert.match(page, /Donation successful/);
  assert.match(page, /A gift for/);
  assert.ok(page.includes("<span>A gift for</span><strong>Ravi Menon</strong>"), "the name alone, no occasion");
  assert.match(page, /Certificate of Appreciation signed by Smt\. Maneka Sanjay Gandhi, posted to 12 Lake View Road, Indiranagar, Bengaluru, 560038/);

  const ref = transaction(sentOut.order_id).donationReference;
  const record = db.store.get(`submissions/${ref}`);
  assert.equal(record.kind, 'PFA-DON');
  assert.equal(record.fields.title, 'Gift of INR 2500 for Ravi Menon, from Asha Kumar');
  assert.equal(record.fields.giftTo, 'Ravi Menon');
  assert.equal(record.fields.giftAddress, '12 Lake View Road, Indiranagar, Bengaluru, 560038');
  assert.equal(record.fields.giftOccasion, undefined, 'an occasion an old form still sends is not kept');
  assert.equal(record.gift.occasion, undefined);
  assert.equal(record.fields.giftEmail, 'ravi@example.com');
  assert.match(record.fields.certificate, /Post a Certificate of Appreciation/);
  assert.equal(record.gift.certificate, 'to post');
  const keys = Object.keys(record.fields);
  assert.ok(keys.indexOf('certificate') === keys.indexOf('amount') + 1, 'what to post comes straight after the amount');

  const copy = sent.find((m) => m.template === 'submission_forward' && m.to === 'pfadcmho@gmail.com');
  assert.ok(copy, 'the gift is a record of money: it goes to the payments inboxes');
  assert.ok(sent.some((m) => m.template === 'submission_forward' && m.to === 'ozairhusain@gmail.com'));
  assert.ok(!sent.some((m) => m.to === 'gandhim@exmpls.sansad.in'), 'never gandhim');
  assert.equal(copy.payload.email, 'asha@example.com', 'Reply-To is the donor, never the person the gift is for');
  const rows = Object.fromEntries(copy.payload.rows.map((r) => [r.label, r.value]));
  assert.match(rows['To do'], /Post a Certificate of Appreciation, signed by Smt\. Maneka Sanjay Gandhi/);
  assert.equal(rows['Certificate for'], 'Ravi Menon');
  assert.equal(rows['Post the certificate to'], '12 Lake View Road, Indiranagar, Bengaluru, 560038');
  assert.equal(rows['Occasion'], undefined, 'and is not in PFA\'s copy');
  assert.equal(rows['Digital copy to (if asked)'], 'ravi@example.com');

  const receipt = sent.find((m) => m.template === 'payment_received');
  assert.equal(receipt.to, 'asha@example.com', 'the 80G receipt stays with the donor');
  assert.equal(receipt.payload.giftTo, 'Ravi Menon');
  assert.equal(receipt.payload.giftAddress, '12 Lake View Road, Indiranagar, Bengaluru, 560038');
  const letter = caregiverMail.TEMPLATES.payment_received(receipt.payload);
  assert.match(letter.html, /Certificate of Appreciation signed by Smt\. Maneka Sanjay Gandhi/);
  assert.match(letter.html, /the 80G receipt stays in your name/);
  assert.match(letter.text, /Certificate posted to: 12 Lake View Road, Indiranagar, Bengaluru, 560038/);
  assert.doesNotMatch(letter.text + letter.html, /[\u2013\u2014]/, 'no long dashes in the letter');
});

test('a gift under ₹1,000 has no certificate and is refused before the bank, with the reason', async () => {
  const res = await refused(Object.assign({}, GIFT, { amount: '999' }));
  assert.equal(res.statusCode, 400);
  assert.match(res.html, /A gift of ₹1,000 or more comes with a certificate/);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith('transactions/')).length, 0, 'nothing on record');
});

test('a gift posted to the door: the parts make one line, house first', async () => {
  const { parseGift } = require('../lib/payment');
  const g = parseGift({ gift: 'yes', giftTo: 'Ravi Kumar', giftHouse: 'flat 3, lake view', giftStreet: 'indiranagar, bengaluru', giftLandmark: 'opposite the park', giftPin: '560038' }, 'inr', 1000);
  assert.equal(g.address, 'Flat 3, Lake View, Indiranagar, Bengaluru, Opposite the Park');
  assert.throws(() => parseGift({ gift: 'yes', giftTo: 'Ravi Kumar', giftStreet: 'Indiranagar, Bengaluru', giftPin: '560038' }, 'inr', 1000), /house or flat number/);
});

test('a gift needs who it is for and where to post it, and is given in rupees', async () => {
  for (const [field, value, said] of [
    ['giftTo', '', /name of the person the gift is for/],
    ['giftAddress', '', /house or flat number and building, so the certificate reaches the door/],
    ['giftPin', '56', /PIN code/],
    ['currency', 'usd', /given in rupees/]
  ]) {
    const res = await refused(Object.assign({}, GIFT, { [field]: value }));
    assert.equal(res.statusCode, 400, field);
    assert.match(res.html, said, field);
  }
});

test('an ordinary donation carries no gift, whatever else is posted with it', async () => {
  const sentOut = await start(Object.assign({}, GIFT, { gift: '' }));
  assert.equal(sentOut.merchant_param2, 'PFA Donation');
  await callback(bankSays(sentOut));
  const record = db.store.get(`submissions/${transaction(sentOut.order_id).donationReference}`);
  assert.equal(record.fields.giftTo, undefined);
  assert.equal(record.gift, undefined);
  assert.match(record.fields.title, /^Donation of INR 2500/);
});

test('the gift is offered on the donate page, linked from every footer, and the old address still arrives there', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  const page = fs.readFileSync(path.join(ROOT, 'donate.html'), 'utf8');
  assert.match(page, /data-kind="gift"[^>]*>Give as a gift</);
  assert.match(page, /<fieldset class="giftset" id="giftSet" hidden disabled>/, 'off, and not sent, until a gift is chosen');
  /* the certificate is posted, so the address comes in parts, door first (29 Oct 2026) */
  for (const name of ['gift', 'giftTo', 'giftHouse', 'giftStreet', 'giftLandmark', 'giftPin', 'giftEmail']) {
    assert.match(page, new RegExp(`name="${name}"`), name);
  }
  const { GIFT_MIN_INR, parseGift } = require('../lib/payment');
  assert.match(page, new RegExp(`GIFT_MIN = ${GIFT_MIN_INR}\\b`), 'the page and the server hold the same floor');
  /* a gift asks for no occasion (owner, 21 Oct 2026: "let that section not
     be there.. simply creates confusion.. be sensible"); it once defaulted to
     "Just because" and showed on the check screen as if chosen */
  assert.doesNotMatch(page, /giftOccasion|[Oo]ccasion|Just because/, 'no occasion is asked for, offered or printed');
  const base = { gift: 'yes', giftTo: 'Ravi Kumar', giftAddress: '12 MG Road, Bengaluru', giftPin: '560038' };
  assert.deepEqual(Object.keys(parseGift({ ...base, giftOccasion: 'Just because' }, 'inr', 1000)).sort(), ['address', 'email', 'pin', 'to'], 'an old form that still sends one is ignored');
  assert.match(page, /title: gift \? 'Check your gift before you pay' : 'Check your donation before you pay'/, 'a donation is checked as a donation');
  assert.match(fs.readFileSync(path.join(ROOT, 'assets', 'chrome-footer.html'), 'utf8'), /<a href="donate\.html\?gift=1">Make a gift<\/a>/);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const firebase = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  assert.ok(vercel.redirects.some((r) => r.source === '/make-a-gift.html' && r.destination === '/donate.html?gift=1' && r.permanent));
  assert.ok(firebase.hosting.redirects.some((r) => r.source === '/make-a-gift.html' && r.destination === '/donate.html?gift=1' && r.type === 301));
});

test('a gift reads plainly and asks one thing per step: amount, who it is for, your details', () => {
  /* Owner, 8 Oct 2026: "let gift cert not say rabies shots in their name etc..
     sounds crass. let it be plain and classy.. and the journey not be
     confusing". The amounts are bare figures, and the person the gift is for
     has a step of their own before the donor's details. */
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'donate.html'), 'utf8');
  const giftPresets = /gift:\s*(\[\[[^\n]*\]\])/.exec(page);
  assert.ok(giftPresets, 'the gift presets are where they were');
  assert.deepEqual(JSON.parse(giftPresets[1].replace(/'/g, '"')), [[1000, ''], [2500, ''], [5000, '']], 'bare figures, no captions');
  assert.doesNotMatch(page, /in their name'/, 'nothing counted out "in their name"');
  assert.match(page, /function panes\(\)\{ return gift \? \['#p1', '#pG', '#p2'\]/, 'a gift has its own step');
  const step = page.slice(page.indexOf('<div class="pane" id="pG">'), page.indexOf('<div class="pane" id="p2">'));
  assert.match(step, /id="giftSet"/, 'who it is for is on that step');
  /* the certificate is posted, so the address comes in parts, door first (29 Oct 2026) */
  for (const name of ['gift', 'giftTo', 'giftHouse', 'giftStreet', 'giftLandmark', 'giftPin', 'giftEmail']) {
    assert.match(step, new RegExp(`name="${name}"[^>]*form="giveForm"`), `${name} still posts with the payment form`);
  }
  assert.match(page, /\['01 Amount', '02 Who it is for', '03 Your details'\]/);
});

/* ---- the thank-you after the bank, and the receipt as a PDF (owner,
   31 Oct 2026: "let the transition happen once the donation is successful
   and ensure it shows up with the thank you message post pg confirmation,
   hope donation receipt can be downloaded - pdf in pfa template!") ---- */

const zlib = require('zlib');
const RECEIPT = require('../lib/donation-receipt');
const receiptRoute = require('../lib/routes/payment/receipt');

async function getReceipt(url) {
  const headers = {};
  const out = await new Promise((resolve) => {
    const response = {
      statusCode: 200,
      setHeader(n, v) { headers[n.toLowerCase()] = v; },
      end(raw) { resolve({ status: this.statusCode, body: Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || '')) }); }
    };
    receiptRoute({ method: 'GET', url, headers: { host: 'pfa.test' } }, response);
  });
  return Object.assign(out, { headers });
}

/* the words on the page of a PDF this file wrote: its one content stream, inflated */
function pdfWords(buffer) {
  const raw = buffer.toString('latin1');
  const at = raw.lastIndexOf('/Filter /FlateDecode >>\nstream\n');
  const start = at + '/Filter /FlateDecode >>\nstream\n'.length;
  const end = raw.indexOf('\nendstream', start);
  const ops = zlib.inflateSync(buffer.subarray(start, end)).toString('latin1');
  return [...ops.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1')).join(' | ');
}

test('the bank confirms: the dog smiles, the thank-you, and the receipt to download', async () => {
  const sentOut = await start();
  const page = await callback(bankSays(sentOut));
  assert.match(page, /<h1>You made their day\.<\/h1>/);
  assert.match(page, /Thank you for standing with animals\./);
  assert.match(page, /Asha, your donation of ₹1,500\.00 has reached People for Animals\./);
  assert.match(page, /<div class="dog" role="img" aria-label="A dog, now smiling"><i class="was"><\/i><i class="now"><\/i><\/div>/);
  assert.match(page, /url\(\/img\/donate-dog\.webp\)/);
  assert.match(page, /\.dog \.now\{background-position:right center;opacity:0;animation:show 1\.7s [^}]* 1s forwards\}/, 'the smile comes in by itself, a moment after the page opens');
  assert.doesNotMatch(page, /<script/, 'no script: the page is the server\'s word, not the browser\'s');
  const t = transaction(sentOut.order_id);
  assert.match(t.receiptKey, RECEIPT.KEY);
  assert.ok(t.receiptIssuedAt);
  const link = `/api/payment/receipt?order=${sentOut.order_id}&amp;k=${t.receiptKey}`;
  assert.ok(page.includes(`href="${link}" download>Download your receipt (PDF)`), 'the receipt, a button away');
  /* the same link in the email, whole */
  const mail = sent.find((m) => m.template === 'payment_received');
  assert.equal(mail.payload.receiptUrl, `https://pfa.test/api/payment/receipt?order=${sentOut.order_id}&k=${t.receiptKey}`);
  /* the same key on a second callback: a link once given keeps working */
  await callback(bankSays(sentOut));
  assert.equal(transaction(sentOut.order_id).receiptKey, t.receiptKey);
});

test('the receipt: a PDF in PFA\'s type, with the donor, the amount in words and the 80G line', async () => {
  const sentOut = await start();
  await callback(bankSays(sentOut));
  const t = transaction(sentOut.order_id);
  const got = await getReceipt(`/api/payment/receipt?order=${sentOut.order_id}&k=${t.receiptKey}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'application/pdf');
  assert.match(got.headers['content-disposition'], new RegExp(`attachment; filename="PFA-donation-receipt-${t.donationReference}\\.pdf"`));
  assert.equal(got.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(got.body.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  const raw = got.body.toString('latin1');
  assert.ok(raw.includes('/BaseFont /PFAAAA+Marcellus') && raw.includes('/BaseFont /PFAAAB+EBGaramond-Medium'), 'the site\'s own type, embedded');
  assert.ok(raw.includes('/FontFile2') && raw.includes('/Subtype /Image'), 'and the logo');
  const words = pdfWords(got.body);
  for (const bit of ['DONATION RECEIPT', t.donationReference, 'THANK YOU', 'INR 1,500.00', 'Rupees One Thousand Five Hundred only', 'Asha Kumar', 'PAN ABCPK1234F', '16 MG Road', 'Karnataka 576101',
    sentOut.order_id, 'BNK900', '31233', 'UPI', 'Section 80G', 'needs no signature', 'PEOPLE FOR ANIMALS']) {
    assert.ok(words.includes(bit), `the receipt says ${bit}`);
  }
  assert.doesNotMatch(words, /[–—]/, 'no dashes');
});

test('a receipt is reached only with its key, and only for a confirmed donation', async () => {
  const sentOut = await start();
  await callback(bankSays(sentOut));
  const t = transaction(sentOut.order_id);
  for (const url of [
    `/api/payment/receipt?order=${sentOut.order_id}`,
    `/api/payment/receipt?order=${sentOut.order_id}&k=${'A'.repeat(24)}`,
    `/api/payment/receipt?order=PFA-DON-ZZZZZZZZ&k=${t.receiptKey}`,
    `/api/payment/receipt?order=../../x&k=${t.receiptKey}`
  ]) {
    const got = await getReceipt(url);
    assert.equal(got.status, 404, url);
    assert.match(got.body.toString(), /This receipt link is not valid\./, 'one answer for every refusal');
  }
  /* a failed payment has no key, no link, no receipt */
  const other = await start();
  const page = await callback(bankSays(other, { order_status: 'Failure', status_message: 'Insufficient funds' }));
  assert.doesNotMatch(page, /donate-dog|You made their day|receipt\?order/);
  assert.equal(transaction(other.order_id).receiptKey, undefined);
});

test('the amount in words, the Indian way', () => {
  assert.equal(RECEIPT.amountInWords(1500, 'INR'), 'Rupees One Thousand Five Hundred only');
  assert.equal(RECEIPT.amountInWords(250000.5, 'INR'), 'Rupees Two Lakh Fifty Thousand and Fifty Paise only');
  assert.equal(RECEIPT.amountInWords(12345678, 'INR'), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight only');
  assert.equal(RECEIPT.amountInWords(1250.05, 'USD'), 'US Dollars One Thousand Two Hundred Fifty and Five Cents only');
  assert.equal(RECEIPT.indiaDate('2026-10-31T20:00:00Z'), '1 November 2026', 'the date in India');
  const fs = require('fs');
  const path = require('path');
  for (const f of ['lib/donation-receipt.js', 'lib/routes/payment/receipt.js']) assert.ok(!/[–—]/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f}: no dashes`);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8'), /'payment\/receipt': \(\) => require\('\.\.\/lib\/routes\/payment\/receipt\.js'\)/);
});

/* Date of birth (owner, 11 Nov 2026: optional, "Date of birth", saved to
   the person's profile). Carried on the transaction, filed on the record
   with the month and day on their own, and never sent to CCAvenue. */
test('a date of birth given on the donation form is filed on the record, and CCAvenue never sees it', async () => {
  const sentOut = await start(Object.assign({}, DONOR, { dob: '1990-05-12' }));
  assert.ok(!Object.values(sentOut).some((v) => /1990/.test(String(v))), 'not in anything sent to the bank');
  assert.equal(transaction(sentOut.order_id).metadata.dob, '1990-05-12');
  await callback(bankSays(sentOut));
  const rec = [...db.store.entries()].find(([k, v]) => k.startsWith('submissions/') && v.kind === 'PFA-DON')[1];
  assert.equal(rec.fields.dob, '1990-05-12');
  assert.equal(rec.birthday, '05-12');
});

test('left empty, nothing is filed; a date that is not real is refused with its own message', async () => {
  const sentOut = await start();
  assert.equal(transaction(sentOut.order_id).metadata.dob, undefined);
  const rec = recorder();
  await create(request(Object.assign({}, DONOR, { dob: '2099-01-01', client_ref: 'dob-future' })), rec.response);
  assert.equal(rec.response.statusCode, 400);
  assert.match(rec.response.html, /Enter a real date of birth, or leave it empty\./);
});
