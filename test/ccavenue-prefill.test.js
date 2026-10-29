'use strict';

/* CCAvenue's billing page arrives filled in.

   Owner, 21 Oct 2026, with a screenshot of CCAvenue's Billing page showing
   name, mobile, email and address filled, and Zip Code, City, State and
   Country empty: "can you ensure these are collected in the website form
   and autofilled when it gets here. so that user doesnt have to fill again.
   has to work perfectly.."

   Each form that pays through CCAvenue now asks for the PIN code, city and
   state, and the server hands them on as billing_zip, billing_city,
   billing_state and billing_country (lib/payment.js billingPlace), within
   CCAvenue's own limits (Integration Guide v3.1: city and state "Alphabets
   (30)", zip "Alphanumeric (15)", address "Alphanumeric (150)").

   The field names below are read from the pages themselves, so a field
   renamed on a page and not on the server fails here rather than quietly
   leaving CCAvenue's boxes empty again. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const { decrypt, decodeMerchantData } = require('../lib/ccavenue');
const P = require('../lib/payment');
const INDIA = require('../assets/india-districts.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const ENV = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PUBLIC_SITE_URL'];
const saved = {};

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test' });
  firebase._setDbForTests(memoryFirestore());
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); resolve(out); }
    };
    const request = { method: 'POST', url: '/api', body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function toCCAvenue(body) {
  const res = await call(require('../lib/routes/payment/create'), body);
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(res.raw);
  assert.ok(enc, `not handed to CCAvenue: ${res.raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)}`);
  return decodeMerchantData(decrypt(enc[1], KEY));
}

/* the names a page's form posts, its own fields and those joined to it by form="..." */
function namesOf(file, formId) {
  const doc = new JSDOM(read(file)).window.document;
  const form = doc.getElementById(formId);
  assert.ok(form, `${file} has no #${formId}`);
  return new Set([...form.elements].map((e) => e.name).filter(Boolean));
}

const PLACE = { city: 'Kundapura', pincode: '576201', state: 'Karnataka',
  /* what is posted is asked for in parts, door first (owner, 29 Oct 2026) */
  house: '4/232 Ashraya', street: 'Ankadakatte, Koteshwara', colony: 'Ankadakatte' };
const WHO = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '4/232 Ashraya, Ankadakatte, Koteshwara' };

function expectFilled(sent, { city, state, pin }) {
  assert.equal(sent.billing_name, 'Asha Rao');
  assert.equal(sent.billing_tel, '9876543210');
  assert.equal(sent.billing_email, 'asha@example.com');
  assert.equal(sent.billing_address, '4/232 Ashraya, Ankadakatte, Koteshwara');
  assert.equal(sent.billing_city, city, 'City');
  assert.equal(sent.billing_state, state, 'State');
  assert.equal(sent.billing_zip, pin, 'Zip Code');
  assert.equal(sent.billing_country, 'India', 'Country');
}

for (const [label, file, formId, extra] of [
  ['a donation', 'donate.html', 'giveForm', { type: 'donate', currency: 'inr', amount: '111', terms: 'yes', cause: 'Where it is needed most' }],
  ['a membership', 'get-involved.html', 'memForm', { type: 'membership', tier: 'silver', terms: 'yes', district: 'Udupi' }],
  ['a colony caregiver application', 'get-involved.html', 'cgForm', { type: 'caregiver-application', district: 'Udupi', documents: 'a'.repeat(48), animals: '12' }]
]) {
  test(`${label}: the page asks for PIN, city and state, and CCAvenue's billing page arrives with all of them`, async () => {
    const names = namesOf(file, formId);
    const door = formId === 'giveForm' ? ['address'] : ['house', 'street'];
    for (const n of ['name', 'mobile', 'email', ...door, 'city', 'pincode', 'state']) assert.ok(names.has(n), `${file} #${formId} does not post "${n}"`);
    const doc = new JSDOM(read(file)).window.document;
    const pin = doc.querySelector(`#${formId} [name="pincode"], [form="${formId}"][name="pincode"]`);
    assert.equal(pin.getAttribute('inputmode'), 'numeric', 'a number pad on a phone');
    assert.equal(pin.getAttribute('maxlength'), '6');
    assert.equal(pin.getAttribute('autocomplete'), 'postal-code', 'the browser can fill it from the address it knows');
    assert.ok(pin.hasAttribute('required'));
    const body = { ...extra };
    for (const n of names) if (n in WHO) body[n] = WHO[n]; else if (n in PLACE) body[n] = PLACE[n];
    expectFilled(await toCCAvenue(body), { city: 'Kundapura', state: 'Karnataka', pin: '576201' });
  });
}

test('without them a rupee payment is refused before CCAvenue, saying which is missing; a dollar gift goes through PayPal and is not asked', () => {
  const donate = { type: 'donate', currency: 'inr', amount: '111', terms: 'yes', ...WHO, ...PLACE };
  assert.throws(() => P.parsePaymentRequest({ ...donate, city: '' }), /city or town/);
  assert.throws(() => P.parsePaymentRequest({ ...donate, pincode: '' }), /PIN code/);
  assert.throws(() => P.parsePaymentRequest({ ...donate, pincode: '012345' }), /does not start with 0/);
  assert.throws(() => P.parsePaymentRequest({ ...donate, state: '' }), /state/i);
  assert.throws(() => P.parsePaymentRequest({ ...donate, state: 'Narnia' }), /from the list/);
  assert.equal(P.parsePaymentRequest({ ...donate, state: 'karnataka' }).merchantValues.billing_state, 'Karnataka', 'spelled one way, the list\'s');
  const usd = P.parsePaymentRequest({ type: 'donate', currency: 'usd', amount: '25', terms: 'yes', ...WHO });
  assert.equal(usd.merchantValues.billing_zip, undefined);
  const member = { type: 'membership', tier: 'silver', terms: 'yes', district: 'Udupi', ...WHO, ...PLACE };
  assert.throws(() => P.parsePaymentRequest({ ...member, pincode: '' }), /PIN code/);
  const cg = { type: 'caregiver-application', district: 'Udupi', documents: 'a'.repeat(48), ...WHO, ...PLACE };
  assert.throws(() => P.parsePaymentRequest({ ...cg, pincode: '57' }), /6 digits/);
});

test('every state on the site\'s list reaches CCAvenue within its 30 letters, and nothing else overruns', () => {
  for (const state of INDIA.STATES) {
    const v = P.billingPlace({ state }).billing_state;
    assert.ok(v && v.length <= 30 && /^[A-Za-z .'-]+$/.test(v), `${state} became "${v}"`);
  }
  assert.equal(P.billingPlace({ state: 'Dadra and Nagar Haveli and Daman and Diu' }).billing_state, 'Dadra Nagar Haveli Daman Diu');
  const long = P.billingPlace({ city: 'Bengaluru (Bangalore) Urban, near the long road name', pin: '560 001' });
  assert.ok(long.billing_city.length <= 30 && /^[A-Za-z .'-]+$/.test(long.billing_city), long.billing_city);
  assert.equal(long.billing_zip, '560001');
  const addr = P.parsePaymentRequest({ type: 'donate', currency: 'inr', amount: '111', terms: 'yes', ...WHO, ...PLACE, address: 'x'.repeat(190) }).merchantValues.billing_address;
  assert.ok(addr.length <= 150, 'the address is fitted to 150');
});

test('the printed caregiver card fills city and state from the holder\'s card when it is posted to them', () => {
  for (const f of ['lib/routes/caregiver/order.js', 'lib/routes/caregiver/replace.js']) {
    const src = read(f);
    assert.match(src, /billingPlace\(delivery\.sameAsCardAddress\s*\? \{ city: card\.district, state: card\.state, pin/, f);
  }
  assert.deepEqual(P.billingPlace({ city: 'Ballari (Bellary)', state: 'Karnataka', pin: '583101' }),
    { billing_country: 'India', billing_city: 'Ballari Bellary', billing_state: 'Karnataka', billing_zip: '583101' });
});

test('the shop already sent all four, and still does', () => {
  const src = read('lib/routes/shop/checkout.js');
  for (const k of ['billing_city: d.city', 'billing_state: d.state', 'billing_zip: d.zip', 'billing_country: d.country']) assert.ok(src.includes(k), k);
});

test('on Get Involved, a missing state or district, or a short PIN, is caught on its own step, not at Pay', () => {
  const src = read('get-involved.html');
  /* since 24 Oct 2026 the PIN is judged by the address block's rule: six
     digits not starting with 0, in the state chosen beside it */
  assert.match(src, /if \(el\.name === 'pincode'\) \{[\s\S]{0,200}window\.PFAAddress\.pinProblem\(v, st \? st\.value : ''\)[\s\S]{0,120}\/\^\[1-9\]\\d\{5\}\$\/[\s\S]{0,400}wrong = !!why;/, 'the PIN is six digits not starting with 0, and in the state');
  assert.match(src, /steps\[at\]\.querySelectorAll\('select\[required\]'\), function\(el\)\{\s*if \(el\.closest\('\[data-address\]'\)\) return;\s*errs \+= bad\(el, !el\.value\) \? 1 : 0;/, 'every required dropdown on the step (the address block checks its own)');
  /* and the caregiver form's own final check carries them too */
  assert.match(src, /errs \+= bad\(st, !st\.value\) \? 1 : 0;\s*errs \+= bad\(di, !di\.value\) \? 1 : 0;\s*var pinWhy = window\.PFAAddress \? window\.PFAAddress\.pinProblem\(pin\.value, st\.value\)[\s\S]{0,400}errs \+= bad\(pin, !!pinWhy\)/);
});
