'use strict';

/* The address on every form (owner, 24 Oct 2026). Maneka Gandhi, forwarded:
   "This is NOT working out. 90% of people filling in this rubbish do not
   give any addresses , not even the city." Then the owner: "can you ensure
   all the forms have the address clearly captured and sent to gandhim email
   ID", and "filling in the address in mandatory. and it should be in the
   right format. and pincode has to be valid. all field level intelligence
   and validations must exist".

   Held here:
     1. every form page carries the block (assets/address.js) for its own
        kind, loads what it needs, and checks it before sending;
     2. the PIN table: every state and union territory has its prefixes, and
        a PIN is judged against the state beside it;
     3. /api/location-lookup?pin= asks India Post, and says which of three
        things happened (a bad PIN, an unknown one, India Post unreachable);
     4. the block's live PIN verdict survives a page that clears messages on
        every keystroke (donate, get-involved, the shop);
     5. the shop and the paid forms refuse a PIN that is not in the state;
     6. a map link typed into an address is kept as typed, never title-cased
        into "Https//Maps.App.Goo.Gl/..." (what gandhim was sent);
     7. gandhim's email carries the address as one line, with a map link. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FIELDS = require('../lib/submission-fields');
const INDIA = require('../assets/india-districts.js');
const RULES = require('../assets/field-rules.js');
const FORWARD = require('../lib/submission-forward');

/* ---- 1. every form page ------------------------------------------------- */

test('every form the server knows has the address block on its page, for its own kind', () => {
  for (const [kind, spec] of Object.entries(FIELDS.KINDS)) {
    const html = read(spec.page);
    const doc = new JSDOM(html).window.document;
    const blocks = [...doc.querySelectorAll('fieldset[data-address]')].filter((b) => (b.getAttribute('data-kind') || '').split(/\s+/).includes(kind));
    assert.equal(blocks.length, 1, `${spec.page} has no address block for ${kind}`);
    const block = blocks[0];
    const form = block.closest('form');
    assert.ok(form, `${spec.page}: the block sits inside the form it belongs to`);
    assert.ok(block.getAttribute('data-legend'), `${spec.page}: the block says whose address it is`);
    /* the table first, then the block; both before the page's own send */
    const tableAt = html.indexOf('<script src="assets/india-districts.js"');
    const blockAt = html.indexOf('<script src="assets/address.js"');
    assert.ok(tableAt > -1 && blockAt > tableAt, `${spec.page} loads the district table, then the block`);
    if (form.hasAttribute('data-address-own')) {
      /* a page that checks the block with its own boxes, so every problem
         shows at once, must actually check it */
      const checks = /PFAAddress\.check\(/.test(html)
        || (/<script src="assets\/micro\.js/.test(html) && /root\.PFAAddress\.check\(block\)/.test(read('assets/micro.js')));
      assert.ok(checks, `${spec.page} says it checks the block, and nothing does`);
    }
  }
});

test('the page sends the block\'s fields: pfa-forms.js adds them before anything goes', () => {
  const src = read('pfa-forms.js');
  assert.match(src, /var placed = root\.PFAAddress\.merge\(kind, data\);\s*if \(placed\.error\) return Promise\.reject\(new Error\(placed\.error\)\);\s*data = placed\.data;/);
});

test('a form that keeps its own address boxes gets the same PIN intelligence', () => {
  assert.match(read('donate.html'), /window\.PFAAddress\.enhance\(by\('giveForm'\), \{ pincode: by\('gPin'\), state: by\('gState'\)/);
  assert.match(read('assets/shop.js'), /window\.PFAAddress\.enhance\(checkout, \{ pincode: \$\('coPin'\), state: stateSel, district: districtSel, city: \$\('coCity'\), address: \$\('coAddress'\) \}\)/);
  assert.match(read('shop.html'), /<script src="assets\/india-districts\.js" defer><\/script>\s*<script src="assets\/address\.js" defer><\/script>\s*<script src="assets\/shop\.js" defer><\/script>/);
  const gi = read('get-involved.html');
  assert.equal((gi.match(/PFAAddress\.enhance\(/g) || []).length, 2, 'membership and caregiver');
});

/* ---- 2. the PIN table ---------------------------------------------------- */

test('every state and union territory has its PIN prefixes, and a PIN is judged against its state', () => {
  for (const state of INDIA.STATES) assert.ok(INDIA.PIN_PREFIX[state] && INDIA.PIN_PREFIX[state].length, `${state} has no PIN prefix`);
  assert.deepEqual(INDIA.pinStates('700016'), ['West Bengal']);
  assert.deepEqual(INDIA.pinStates('110001'), ['Delhi']);
  assert.deepEqual(INDIA.pinStates('990000'), [], 'no state starts 99');
  assert.equal(INDIA.pinOk('West Bengal', '700016'), true);
  assert.equal(INDIA.pinOk('Delhi', '700016'), false);
  assert.equal(INDIA.pinOk('Karnataka', '576222'), true);
  assert.equal(INDIA.pinShape('057622'), false, 'a PIN does not start with 0');
});

/* ---- 3. India Post ------------------------------------------------------- */

function ask(query, answer) {
  const route = require('../lib/routes/location-lookup.js');
  const real = global.fetch;
  const asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    if (answer instanceof Error) throw answer;
    return { ok: true, status: 200, json: async () => answer };
  };
  return new Promise((resolve) => {
    const out = { statusCode: 200, headers: {} };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.body = JSON.parse(String(raw)); out.asked = asked; global.fetch = real; resolve(out); }
    };
    route({ method: 'GET', query, headers: {} }, response);
  });
}

test('a PIN is looked up with India Post: its state, district and town', async () => {
  const res = await ask({ pin: '576222' }, [{ Status: 'Success', PostOffice: [{ Name: 'Koteshwara', Block: 'Kundapura', District: 'Udupi', State: 'Karnataka' }] }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { pincode: '576222', state: 'Karnataka', district: 'Udupi', city: 'Kundapura', street: '' });
  assert.equal(res.asked[0], 'https://api.postalpincode.in/pincode/576222');
  assert.match(res.headers['cache-control'], /max-age=86400/, 'a PIN does not move: kept a day');
});

test('India Post\'s "NA" block is not a town', async () => {
  const res = await ask({ pin: '700016' }, [{ Status: 'Success', PostOffice: [{ Block: 'NA', District: 'Kolkata', State: 'West Bengal' }] }]);
  assert.equal(res.body.city, 'Kolkata');
});

test('a PIN of the wrong shape, one India Post does not know, and India Post down are three different answers', async () => {
  const bad = await ask({ pin: '05762' }, []);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.code, 'BAD_PIN');
  assert.deepEqual(bad.asked, [], 'India Post is not asked about something that cannot be a PIN');
  const unknown = await ask({ pin: '799999' }, [{ Status: 'Error', PostOffice: null }]);
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.body.code, 'UNKNOWN_PIN');
  const down = await ask({ pin: '576222' }, new Error('ETIMEDOUT'));
  assert.equal(down.statusCode, 503, 'India Post being down is not the person\'s mistake');
  assert.equal(down.body.code, 'UNAVAILABLE');
});

/* ---- 4. the live verdict, on a page that clears messages ----------------- */

test('the PIN\'s verdict stays on a form that clears every message as you type', () => {
  const dom = new JSDOM(`<form id="f">
    <div class="field"><input name="address" id="a"><span class="error">Add the address.</span></div>
    <div class="field"><select name="state" id="s"><option value="">Select</option><option>Delhi</option><option>West Bengal</option></select><span class="error">Pick your state.</span></div>
    <div class="field"><input name="pincode" id="p"><span class="error">Enter the 6-digit PIN code.</span></div>
  </form>`, { runScripts: 'outside-only', url: 'https://pfa.test/donate.html' });
  const w = dom.window;
  w.fetch = () => new Promise(() => {});
  w.eval(read('assets/india-districts.js'));
  w.eval(read('assets/address.js'));
  const doc = w.document;
  const form = doc.getElementById('f');
  /* the page's own habit: any keystroke clears that box's message */
  form.addEventListener('input', (e) => { const f = e.target.closest('.field'); if (f) f.classList.remove('is-bad'); });
  w.PFAAddress.enhance(form, { pincode: doc.getElementById('p'), state: doc.getElementById('s'), address: doc.getElementById('a') });
  doc.getElementById('s').value = 'Delhi';
  const pin = doc.getElementById('p');
  pin.value = '700016';
  pin.dispatchEvent(new w.Event('input', { bubbles: true }));
  const box = pin.closest('.field');
  assert.ok(box.classList.contains('is-bad'), 'the PIN is still marked');
  assert.equal(box.querySelector('.error').textContent, 'PIN code 700016 is in West Bengal, not Delhi. Check the PIN code or the state.');
  /* corrected, the message goes and the page's own words come back */
  pin.value = '110001';
  pin.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.ok(!box.classList.contains('is-bad'));
  assert.equal(box.querySelector('.error').textContent, 'Enter the 6-digit PIN code.');
});

/* ---- 5. the shop and the paid forms -------------------------------------- */

test('the paid forms and the shop refuse a PIN that is not in the state', () => {
  const payment = require('../lib/payment');
  assert.throws(() => payment.placeAgrees({ state: 'Delhi', pin: '700016' }), /PIN code 700016 is in West Bengal, not Delhi/);
  assert.throws(() => payment.placeAgrees({ state: 'Delhi', district: 'Udupi', pin: '110001' }), /Choose a district in Delhi/);
  assert.doesNotThrow(() => payment.placeAgrees({ state: 'Delhi', district: 'New Delhi', pin: '110001' }));
  const membership = { type: 'membership', tier: 'golden', amount: '1', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com',
    address: '12 Lake Road', city: 'Pune', state: 'Maharashtra', district: 'Pune', pincode: '700016', terms: 'yes' };
  assert.throws(() => payment.parsePaymentRequest(membership), /not Maharashtra/);
  assert.doesNotThrow(() => payment.parsePaymentRequest(Object.assign({}, membership, { pincode: '411004' })));
  const checkout = read('lib/routes/shop/checkout.js');
  assert.match(checkout, /placeAgrees\(\{ state, district, pin: zip \}\);/, 'the shop holds the delivery address to the same rule');
});

/* ---- 6. a map link is kept as typed --------------------------------------- */

test('a map link in an address is kept exactly, not title-cased into a link that goes nowhere', () => {
  const link = 'https://maps.app.goo.gl/1xIqJuQvCkSlhjYk8';
  for (const field of ['address', 'location', 'where']) {
    assert.equal(RULES.normaliseField(field, link), link, `${field}: the link alone`);
    const both = RULES.normaliseField(field, `showroom near the metro ${link}`);
    assert.ok(both.includes(link), `${field}: the link inside words: ${both}`);
    assert.doesNotMatch(both, /Https\/\/|Goo\.Gl/);
  }
});

/* ---- 7. what gandhim reads ----------------------------------------------- */

test('gandhim\'s email gives the address as one line with a map link, first where the address is the case', () => {
  const report = FORWARD.payloadFor({ reference: 'PFA-CR-2026-00009', kind: 'PFA-CR', fields: {
    what: 'A husky kept tied all day', name: 'Selina Thakur', email: 'seth@example.com', mobile: '9330720918',
    address: 'Showroom, 12 Park Street, Near The Metro', city: 'Kolkata', district: 'Kolkata', state: 'West Bengal', pincode: '700016',
    mapLink: 'https://maps.app.goo.gl/1xIqJuQvCkSlhjYk8' } }, 'https://pfa.test');
  assert.deepEqual(report.place, { label: 'Where it is happening', value: 'Showroom, 12 Park Street, Near The Metro, Kolkata, West Bengal 700016',
    map: 'https://maps.app.goo.gl/1xIqJuQvCkSlhjYk8', first: true });
  /* a town that is not its district keeps the district: it names the unit */
  const unit = FORWARD.placeOf({ kind: 'PFA-U', fields: { address: '12 Main Road, Koteshwara', city: 'Kundapur', district: 'Udupi', state: 'Karnataka', pincode: '576222' } });
  assert.equal(unit.value, '12 Main Road, Koteshwara, Kundapur, Udupi district, Karnataka 576222');
  assert.match(unit.map, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=12%20Main%20Road/, 'no link given: a search for the address');

  const mail = require('../lib/caregiver-mail');
  const message = mail.render('submission_forward', report);
  assert.match(message.text, /Where it is happening: Showroom, 12 Park Street, Near The Metro, Kolkata, West Bengal 700016/);
  assert.match(message.text, /Map: https:\/\/maps\.app\.goo\.gl\/1xIqJuQvCkSlhjYk8/);
  assert.match(message.html, /<a href="https:\/\/maps\.app\.goo\.gl\/1xIqJuQvCkSlhjYk8"[^>]*>Open in Google Maps<\/a>/);
  assert.ok(message.text.indexOf('Where it is happening') < message.text.indexOf('Name:'), 'the place first, for a report');
  assert.doesNotMatch(message.text + message.html, /[–—]/, 'no long dashes');
});
