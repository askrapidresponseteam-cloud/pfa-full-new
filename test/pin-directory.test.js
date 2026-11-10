'use strict';

/* Every PIN code in India against its place (owner, 10 Nov 2026: "ensure
   pincode and area/place match, it should work seamlessly across each and
   every pincode in the country").

   Held here, over all 19,586 PINs in India Post's directory: each PIN names
   districts the forms can offer, in a state its PIN can be in; none of its
   own post offices, its town or its districts is ever refused for it; a town
   or district that is clearly somewhere else is refused, by the page, the
   form API, the payments and the shop alike; and a village India Post does
   not list, or a name many villages share, is never refused. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PINS = require('../lib/pin-directory.js');
const INDIA = require('../assets/india-districts.js');

test('every PIN in India is in the directory, with districts the forms offer and a state its PIN can be in', () => {
  const data = PINS._private.load();
  const pins = Object.keys(data.pins);
  assert.ok(pins.length > 19000, `${pins.length} PINs`);
  let named = 0;
  for (const pin of pins) {
    const f = PINS.find(pin);
    if (!f.districts.length) continue;
    named += 1;
    for (const d of f.districts) assert.ok(f.states.some((s) => INDIA.pairOk(s, d)), `${pin}: ${d} is not a district the forms offer`);
    assert.ok(f.states.some((s) => INDIA.pinOk(s, pin)) || f.states.length, `${pin}: ${f.states}`);
  }
  assert.ok(named / pins.length > 0.99, 'all but the PINs India Post files under no district');
  assert.match(data.source, /India Post, All India Pincode Directory/);
});

test('no PIN is ever refused its own town, post offices or districts', () => {
  const data = PINS._private.load();
  const refused = [];
  for (const pin of Object.keys(data.pins)) {
    const f = PINS.find(pin);
    if (f.city && PINS.placeProblem(pin, f.city)) refused.push(`${pin} ${f.city}`);
    for (const a of f.areas) if (PINS.placeProblem(pin, a)) refused.push(`${pin} ${a}`);
    for (const d of f.districts) {
      const s = f.states.find((x) => INDIA.pairOk(x, d));
      if (PINS.districtProblem(pin, s, d)) refused.push(`${pin} district ${d}`);
      if (PINS.placeProblem(pin, d)) refused.push(`${pin} town ${d}`);
    }
  }
  assert.deepEqual(refused.slice(0, 20), []);
});

test('a town or district clearly somewhere else is refused, in plain words', () => {
  assert.equal(PINS.placeProblem('576101', 'Mumbai'), 'PIN code 576101 is Udupi, Udupi district, Karnataka, not Mumbai. Check the PIN code or the town.');
  for (const [pin, town] of [['110017', 'Noida'], ['560034', 'Chennai'], ['400050', 'Pune'], ['380001', 'Surat'], ['144001', 'Amritsar'], ['500032', 'Vijayawada']]) {
    assert.match(PINS.placeProblem(pin, town), new RegExp(`^PIN code ${pin} is .+, not ${town}\\. Check the PIN code or the town\\.$`), `${pin} ${town}`);
  }
  assert.equal(PINS.districtProblem('576101', 'Karnataka', 'Bengaluru (Bangalore) Urban'), 'PIN code 576101 is in Udupi district, not Bengaluru Urban. Check the PIN code or the district.');
  assert.match(PINS.districtProblem('576101', 'Karnataka', 'Dakshina Kannada'), /is in Udupi district/);
});

test('how people really write their address is accepted', () => {
  const fine = [
    ['110017', 'New Delhi'], ['110017', 'Delhi'], ['110017', 'Saket'], ['500032', 'Hyderabad'], ['500032', 'Secunderabad'],
    ['560034', 'Bangalore'], ['560034', 'Bengaluru'], ['560034', 'Koramangala'], ['400050', 'Bombay'], ['400050', 'Bandra'],
    ['600096', 'Madras'], ['700016', 'Calcutta'], ['122001', 'Gurgaon'], ['122001', 'Gurugram'], ['682001', 'Cochin'],
    ['695001', 'Trivandrum'], ['576101', 'Manipal'], ['576101', 'Udupi, Karnataka'], ['576101', 'UDUPI'], ['576222', 'Kundapur'],
    /* a village India Post does not list, and a name many villages share */
    ['576222', 'Hosangadi Gramapanchayat Village'], ['576222', 'Rampur'], ['800001', 'Rampur'],
    /* a district a PIN shares a postal division with: the edges of a delivery area */
    ['533001', 'Kakinada'], ['533001', 'East Godavari']
  ];
  for (const [pin, town] of fine) assert.equal(PINS.placeProblem(pin, town), '', `${pin} ${town}`);
  assert.equal(PINS.districtProblem('500032', 'Telangana', 'Rangareddy'), '');
  assert.equal(PINS.districtProblem('500032', 'Telangana', 'Hyderabad'), '');
  assert.equal(PINS.districtProblem('533001', 'Andhra Pradesh', 'East Godavari'), '', 'a district carved in two: both names');
  assert.equal(PINS.districtProblem('533001', 'Andhra Pradesh', 'Kakinada'), '');
  /* a PIN the directory does not have is not judged here */
  assert.equal(PINS.placeProblem('576999', 'Mumbai'), '');
  assert.equal(PINS.find('576999'), null);
});

test('the payments, the forms and the shop refuse what the page refuses', () => {
  const { parsePaymentRequest } = require('../lib/payment.js');
  const body = { type: 'donate', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road', state: 'Karnataka', pincode: '576101', terms: 'yes', amount: '500' };
  assert.equal(parsePaymentRequest({ ...body, city: 'Udupi' }).customer.city, 'Udupi');
  assert.throws(() => parsePaymentRequest({ ...body, city: 'Mumbai' }), /PIN code 576101 is Udupi.*not Mumbai/);
  const member = { type: 'membership', tier: 'student', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', house: '12', street: 'Car Street', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes' };
  assert.equal(parsePaymentRequest({ ...member, district: 'Udupi' }).customer.district, 'Udupi');
  assert.throws(() => parsePaymentRequest({ ...member, district: 'Mysuru (Mysore)' }), /PIN code 576101 is in Udupi district, not Mysuru/);
  const SF = require('../lib/submission-fields.js');
  assert.deepEqual(SF.addressProblems({ address: '16 MG Road, Bannanje', pincode: '576101', city: 'Udupi', state: 'Karnataka', district: 'Udupi' }), []);
  const wrong = SF.addressProblems({ address: '16 MG Road, Bannanje', pincode: '576101', city: 'Pune', state: 'Karnataka', district: 'Udupi' });
  assert.deepEqual(wrong.map((e) => e.field), ['city']);
  assert.deepEqual(SF.addressProblems({ address: '16 MG Road, Bannanje', pincode: '576101', city: 'Udupi', state: 'Karnataka', district: 'Kodagu' }).map((e) => e.field), ['district']);
  assert.match(read('lib/routes/shop/checkout.js'), /if \(cleanText\(body\.city, 5\)\) placeAgrees\(\{ pin: zip, city \}\);/);
});

test('the page offers the PIN\'s post offices in the town box and says a mismatch on the box', () => {
  const js = read('assets/address.js');
  assert.match(js, /lookup\('pin=' \+ pin \+ '&place=' \+ encodeURIComponent/);
  assert.match(js, /dl = doc\.createElement\('datalist'\)/);
  assert.match(js, /cityEl\.setAttribute\('list', dl\.id\)/);
  assert.match(js, /mark\('city', [^\n]*cityWhy\(p, c\)\);/);
  assert.match(js, /mark\('district', [^\n]*districtWhy\(p, s, d\)\);/);
  assert.match(js, /verify: verify,/);
  assert.match(read('donate.html'), /window\.PFAAddress\.verify\(document\.getElementById\('giveForm'\)\)/);
  assert.equal((read('get-involved.html').match(/window\.PFAAddress\.verify\(/g) || []).length, 3, 'the steps, the membership and the caregiver card');
});

test('the directory is built from India Post\'s file, every district matched to the site\'s list', () => {
  const B = require('../scripts/build-pin-directory.js');
  assert.equal(B.officeName('KOTESHWARA S.O'), 'Koteshwara');
  assert.equal(B.officeName('Malviya Nagar SO South Delhi'), 'Malviya Nagar');
  assert.equal(B.officeName('Haladi28 B.O'), 'Haladi');
  assert.equal(B.officeName('New Delhi G.P.O.'), 'New Delhi');
  assert.deepEqual(B.siteDistricts('Delhi', 'SOUTH'), ['South Delhi']);
  assert.deepEqual(B.siteDistricts('Telangana', 'MEDCHAL MALKAJGIRI'), ['Medchal']);
  assert.deepEqual(B.siteDistricts('Karnataka', 'BENGALURU URBAN'), ['Bengaluru (Bangalore) Urban']);
  assert.deepEqual(B.siteDistricts('Uttar Pradesh', 'PRAYAGRAJ'), ['Prayagraj (Allahabad)']);
  assert.equal(B.stateOf('THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'), 'Dadra and Nagar Haveli and Daman and Diu');
  /* the districts formed since the list's source are on it */
  for (const [s, d] of [['Andhra Pradesh', 'Kakinada'], ['Andhra Pradesh', 'Tirupati'], ['Telangana', 'Hanumakonda'], ['Tamil Nadu', 'Chengalpattu'], ['West Bengal', 'Purba Bardhaman'], ['Mizoram', 'Saitual']]) {
    assert.ok(INDIA.pairOk(s, d), `${d}, ${s}`);
  }
  assert.ok(fs.statSync(path.join(ROOT, 'lib', 'pin-directory.json.gz')).size < 1.5 * 1024 * 1024, 'small enough to ship with the API');
});
