/* Owner, 29 Oct 2026: "for all orders like ecom ones and card dispatches ask
   for proper mailing address including their house number etc. else will be
   hard to email.. check everysuch place on the end user website and update".

   Everything PFA posts is asked for door first: the house or flat number and
   building (required), the street and area (required), a landmark
   (optional), then the town, state, district and PIN. The four places:
   membership (card and kit), colony caregiver card, the shop, a gift's
   certificate. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const P = require('../lib/payment');
const POSTAL = require('../lib/postal');
const SHOP = require('../lib/routes/shop/checkout')._private;

function form(file, selector) {
  const doc = new JSDOM(read(file)).window.document;
  const f = doc.querySelector(selector);
  const id = f.id;
  const named = (n) => f.querySelector(`[name="${n}"]`) || doc.querySelector(`[form="${id}"][name="${n}"]`);
  return { doc, f, named };
}

for (const [label, file, selector, names] of [
  ['membership', 'get-involved.html', '#memForm', { house: 'house', street: 'street', landmark: 'landmark' }],
  ['colony caregiver card', 'get-involved.html', '#cgForm', { house: 'house', street: 'street', landmark: 'landmark' }],
  ['shop', 'shop.html', '#checkout', { house: 'house', street: 'street', landmark: 'landmark' }],
  ['gift certificate', 'donate.html', '#giveForm', { house: 'giftHouse', street: 'giftStreet', landmark: 'giftLandmark' }]
]) {
  test(`${label}: asks for the house or flat number, the street and a landmark`, () => {
    const { doc, named } = form(file, selector);
    const house = named(names.house);
    const street = named(names.street);
    const landmark = named(names.landmark);
    assert.ok(house && house.hasAttribute('required'), 'the house is required');
    assert.ok(street && street.hasAttribute('required'), 'the street is required');
    assert.ok(landmark && !landmark.hasAttribute('required'), 'the landmark is optional');
    const labelOf = (el) => doc.querySelector(`label[for="${el.id}"]`).textContent;
    assert.match(labelOf(house), /house or flat number, and building/i);
    assert.match(labelOf(street), /street/i);
    assert.match(labelOf(landmark), /landmark/i);
    assert.match(labelOf(landmark), /optional/i);
    const page = read(file);
    assert.ok(!/[–—]/.test(labelOf(house) + labelOf(street) + labelOf(landmark) + house.getAttribute('placeholder')), 'no dashes');
    assert.ok(page.includes('so the courier finds the door') || page.includes('so the certificate reaches the door'), 'the reason is said');
  });
}

test('the shop asks for the town too, and the colony card asks for the colony on its own step', () => {
  const shop = form('shop.html', '#checkout');
  assert.ok(shop.named('city') && shop.named('city').hasAttribute('required'));
  const cg = form('get-involved.html', '#cgForm');
  assert.ok(cg.named('colony') && cg.named('colony').hasAttribute('required'));
  const steps = [...cg.f.querySelectorAll('.gi__step')].map((s) => s.getAttribute('data-step'));
  assert.deepEqual(steps, ['The card', 'About you', 'Your address', 'Your colony', 'Pay']);
  const dots = [...cg.doc.querySelectorAll('#caregiver .gi__progress li')].map((li) => li.textContent);
  assert.deepEqual(dots, steps, 'the progress row matches the steps');
  const address = cg.f.querySelector('[data-step="Your address"]');
  assert.ok(address.querySelector('[name="house"]') && address.querySelector('[name="pincode"]'), 'the postal address is one step');
  assert.ok(cg.f.querySelector('[data-step="Your colony"] [name="colony"]'));
});

test('one line, door first: Flat 4B, Sai Residency, 12th Cross, Kodavoor, Near Sri Krishna Temple', () => {
  const got = POSTAL.read({ house: 'flat 4b, sai residency', street: '12th cross, kodavoor', landmark: 'sri krishna temple' });
  assert.equal(got.address, 'Flat 4B, Sai Residency, 12th Cross, Kodavoor, Near Sri Krishna Temple');
  assert.equal(POSTAL.compose('12', 'MG Road', ''), '12 MG Road', 'a bare number reads with its street');
  assert.equal(POSTAL.compose('Krishna Nilaya', 'Krishna Nilaya, Car Street', 'opposite the bank'), 'Krishna Nilaya, Car Street, opposite the bank', 'never twice; a landmark said with its own word kept');
  assert.throws(() => POSTAL.read({ street: 'MG Road' }), (e) => e.field === 'house' && /house or flat number/.test(e.message));
  assert.throws(() => POSTAL.read({ house: '12', street: '' }), (e) => e.field === 'street');
  assert.throws(() => POSTAL.read({ house: '--', street: 'MG Road' }), /house or flat number, or the house name/);
  /* an old page's one line is taken only with a house number in it */
  assert.equal(POSTAL.read({ address: '16 MG Road, Lajpat Nagar' }).address, '16 MG Road, Lajpat Nagar');
  assert.throws(() => POSTAL.read({ address: 'MG Road, Lajpat Nagar' }), /house or flat number/);
});

const WHO = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', city: 'Udupi', state: 'Karnataka', district: 'Udupi', pincode: '576101' };

test('the server holds membership, the colony card and the gift to the same door', () => {
  const member = { type: 'membership', tier: 'silver', terms: 'yes', ...WHO, house: 'Flat 4B, Sai Residency', street: 'Car Street', landmark: 'the Krishna temple' };
  const m = P.parsePaymentRequest(member);
  assert.equal(m.metadata.address, 'Flat 4B, Sai Residency, Car Street, Near the Krishna Temple');
  assert.equal(m.merchantValues.billing_address, m.metadata.address, 'CCAvenue gets the same line');
  assert.throws(() => P.parsePaymentRequest({ ...member, house: '' }), /house or flat number/);

  const cg = { type: 'caregiver-application', documents: 'a'.repeat(48), ...WHO, house: '12', street: 'Car Street', colony: 'Shanthi Nagar' };
  const c = P.parsePaymentRequest(cg);
  assert.equal(c.metadata.address, '12 Car Street', 'the card is posted here');
  assert.equal(c.metadata.colony, 'Shanthi Nagar', 'the colony is kept apart');
  assert.throws(() => P.parsePaymentRequest({ ...cg, house: '' }), /house or flat number/);
  assert.throws(() => P.parsePaymentRequest({ ...cg, colony: '' }), /colony or locality/);
});

test('the shop parcel goes to the door and the town', () => {
  const body = { name: 'Meera Shah', mobile: '9876543210', email: 'meera@example.com', house: 'Flat 4, Shanti Niwas', street: 'FC Road, Shivajinagar', landmark: 'near the college', city: 'Pune', state: 'Maharashtra', district: 'Pune', pincode: '411004' };
  const d = SHOP.readShopper(body).delivery;
  assert.equal(d.address, 'Flat 4, Shanti Niwas, FC Road, Shivajinagar, Near the College');
  assert.equal(d.city, 'Pune');
  assert.equal(d.house, 'Flat 4, Shanti Niwas');
  assert.throws(() => SHOP.readShopper({ ...body, house: '' }), /house or flat number/);
});

test('the panel and the copy to gandhim say where the card goes', () => {
  assert.match(read('lib/submission-forward.js'), /'PFA-CG': \{[^}]*address: 'Post the card to', colony: 'Colony where they feed'/);
  assert.match(read('lib/submission-forward.js'), /'PFA-MEM': \{[^}]*address: 'Post the card and kit to'/);
  assert.match(read('admin.html'), /row\.colony \? 'Post the card to' : 'Colony address'/);
  assert.match(read('lib/routes/payment/response.js'), /colony: meta\.colony \|\| ''/);
});
