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
  address: '16 MG Road, Udupi', cause: 'Where it is needed most', pan: 'ABCDE1234F'
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
  assert.equal(copies.length, 1, 'one copy to the inbox');
  assert.equal(copies[0].to, 'gandhim@exmpls.sansad.in');
  assert.equal(copies[0].payload.email, 'asha@example.com', 'Reply-To the donor');
  assert.equal(copies[0].payload.kind, 'PFA-DON');
});

test('CCAvenue delivering the same success twice changes nothing and sends nothing more', async () => {
  const sentOut = await start();
  await callback(bankSays(sentOut));
  const again = await callback(bankSays(sentOut));
  assert.match(again, /Donation successful/, 'the second visit still shows the donor their result');
  assert.equal(sent.filter((m) => m.template === 'payment_received').length, 1, 'one receipt');
  assert.equal(sent.filter((m) => m.template === 'submission_forward').length, 1, 'one copy to the inbox');
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
  assert.match(page, /Ravi Menon \(Birthday\)/);
  assert.match(page, /Certificate of Appreciation signed by Smt\. Maneka Sanjay Gandhi, posted to 12 Lake View Road, Indiranagar, Bengaluru, 560038/);

  const ref = transaction(sentOut.order_id).donationReference;
  const record = db.store.get(`submissions/${ref}`);
  assert.equal(record.kind, 'PFA-DON');
  assert.equal(record.fields.title, 'Gift of INR 2500 for Ravi Menon, from Asha Kumar');
  assert.equal(record.fields.giftTo, 'Ravi Menon');
  assert.equal(record.fields.giftAddress, '12 Lake View Road, Indiranagar, Bengaluru, 560038');
  assert.equal(record.fields.giftOccasion, 'Birthday');
  assert.equal(record.fields.giftEmail, 'ravi@example.com');
  assert.match(record.fields.certificate, /Post a Certificate of Appreciation/);
  assert.equal(record.gift.certificate, 'to post');
  const keys = Object.keys(record.fields);
  assert.ok(keys.indexOf('certificate') === keys.indexOf('amount') + 1, 'what to post comes straight after the amount');

  const copy = sent.find((m) => m.template === 'submission_forward');
  assert.equal(copy.to, 'gandhim@exmpls.sansad.in');
  assert.equal(copy.payload.email, 'asha@example.com', 'Reply-To is the donor, never the person the gift is for');
  const rows = Object.fromEntries(copy.payload.rows.map((r) => [r.label, r.value]));
  assert.match(rows['To do'], /Post a Certificate of Appreciation, signed by Smt\. Maneka Sanjay Gandhi/);
  assert.equal(rows['Certificate for'], 'Ravi Menon');
  assert.equal(rows['Post the certificate to'], '12 Lake View Road, Indiranagar, Bengaluru, 560038');
  assert.equal(rows['Occasion'], 'Birthday');
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

test('a gift needs who it is for and where to post it, and is given in rupees', async () => {
  for (const [field, value, said] of [
    ['giftTo', '', /name of the person the gift is for/],
    ['giftAddress', '', /address the certificate should be posted to/],
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
  for (const name of ['gift', 'giftTo', 'giftAddress', 'giftPin', 'giftOccasion', 'giftEmail']) {
    assert.match(page, new RegExp(`name="${name}"`), name);
  }
  const { GIFT_MIN_INR, GIFT_OCCASIONS } = require('../lib/payment');
  assert.match(page, new RegExp(`GIFT_MIN = ${GIFT_MIN_INR}\\b`), 'the page and the server hold the same floor');
  const offered = [...page.matchAll(/<select id="giftOccasion"[\s\S]*?<\/select>/g)][0][0].match(/<option>([^<]+)<\/option>/g).map((o) => o.replace(/<\/?option>/g, ''));
  assert.deepEqual([...offered].sort(), [...GIFT_OCCASIONS].sort(), 'every occasion offered is one the server accepts');
  /* the occasion is optional: nothing chosen is nothing said (owner, 21 Oct
     2026, of the old default: "what nonsense is just becoz?") */
  assert.match(page, /<select id="giftOccasion"[^>]*>\s*<option value="">No particular occasion<\/option>/, 'the first choice is no occasion at all');
  assert.ok(!GIFT_OCCASIONS.includes('Just because'));
  assert.doesNotMatch(page, /Just because/, 'and the page never offers or prints it');
  const { parseGift } = require('../lib/payment');
  const base = { gift: 'yes', giftTo: 'Ravi Kumar', giftAddress: '12 MG Road, Bengaluru', giftPin: '560038' };
  assert.equal(parseGift({ ...base }, 'inr', 1000).occasion, '', 'no occasion sent, none recorded');
  assert.equal(parseGift({ ...base, giftOccasion: 'Just because' }, 'inr', 1000).occasion, '', 'nor the old default');
  assert.equal(parseGift({ ...base, giftOccasion: 'Birthday' }, 'inr', 1000).occasion, 'Birthday');
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
  for (const name of ['gift', 'giftTo', 'giftAddress', 'giftPin', 'giftOccasion', 'giftEmail']) {
    assert.match(step, new RegExp(`name="${name}"[^>]*form="giveForm"`), `${name} still posts with the payment form`);
  }
  assert.match(page, /\['01 Amount', '02 Who it is for', '03 Your details'\]/);
});
