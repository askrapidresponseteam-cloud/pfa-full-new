'use strict';
/* The ask form routes an answer to the unit nearest the person, so where they
   are is not decoration. It was one optional free-text box, then a state and
   a city from two lists; since 24 Oct 2026 it is the address every form on
   the site carries (assets/address.js; owner, forwarding Maneka Gandhi: "90%
   of people filling in this rubbish do not give any addresses, not even the
   city", then "filling in the address in mandatory. and it should be in the
   right format. and pincode has to be valid"): house and street, a PIN that
   can be in the state, the town, and a state and district from the list.

   Both halves are held here. The browser must not be able to compose a bad
   address, and the API must refuse one anyway, because a form is a
   convenience and the endpoint is the rule. The page runs here with its real
   scripts: the district table, the field rules, the block and pfa-forms.js,
   with the network stood in for. */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('ask.html');
const INDIA = require(path.join(ROOT, 'assets', 'india-districts.js'));
const { validate } = require(path.join(ROOT, 'lib', 'submission-fields.js'));

/* jsdom does not fetch <script src>, so each shared script is inlined where
   the page links it: same code, same order, same globals. */
const INLINE = ['assets/india-districts.js', 'assets/field-rules.js', 'assets/address.js', 'pfa-forms.js'];
function page(lookup) {
  let source = html;
  for (const file of INLINE) {
    const tag = new RegExp(`<script src="${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"( defer)?></script>`);
    assert.match(source, tag, `ask.html links ${file}`);
    source = source.replace(tag, () => `<script>${read(file).replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  const posted = [];
  const dom = new JSDOM(source, {
    runScripts: 'dangerously', url: 'https://pfa.test/ask.html',
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = (url, init) => {
        if (String(url).startsWith('/api/location-lookup')) {
          const place = lookup && lookup(new URL(url, 'https://pfa.test').searchParams.get('pin'));
          return Promise.resolve({ ok: !!place, status: place ? 200 : 503, json: () => Promise.resolve(place || { code: 'UNAVAILABLE' }) });
        }
        if (String(url) === '/api/pfa-submissions') {
          posted.push(JSON.parse(init.body));
          return new w.Promise(() => {});
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
    }
  });
  const w = dom.window;
  /* the block mounts on DOMContentLoaded, which jsdom fires a moment later */
  w.PFAAddress.mountAll();
  const $ = (q) => w.document.querySelector(q);
  const box = (key) => $(`#askForm [data-address] [data-addr="${key}"]`);
  const errOf = (el) => el.closest('.field').querySelector('.err');
  const set = (el, value, kind) => { el.value = value; el.dispatchEvent(new w.Event(kind || 'input', { bubbles: true })); };
  const fill = (place) => {
    $('#question').value = 'Can I feed the dogs in my society every evening?';
    $('#topic').value = 'Animal law';
    $('#name').value = 'Asha Rao';
    $('#email').value = 'asha@example.in';
    $('#consent').checked = true;
    if (!place) return;
    if (place.state) set(box('state'), place.state, 'change');
    if (place.district) set(box('district'), place.district, 'change');
    if (place.address) set(box('address'), place.address);
    if (place.city) set(box('city'), place.city);
    if (place.pincode) set(box('pincode'), place.pincode);
  };
  const send = () => $('#askForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, w, $, box, errOf, set, fill, send, posted };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const UDUPI = { address: '12 Main Road, Koteshwara', pincode: '576222', city: 'Kundapur', state: 'Karnataka', district: 'Udupi' };

test('the place is the address block: a house and street, a PIN, the town, and a state and district from the list', () => {
  assert.match(html, /<fieldset data-address data-kind="PFA-Q" data-legend="Your address"><\/fieldset>/);
  assert.match(html, /<form class="form" id="askForm" novalidate data-address-own>/, 'the page checks the block with its own fields, so every problem shows at once');
  const p = page();
  for (const key of ['address', 'pincode', 'city', 'state', 'district']) {
    assert.ok(p.box(key), `the block asks for ${key}`);
    assert.ok(p.box(key).required, `${key} is required`);
  }
  assert.equal(p.box('state').tagName, 'SELECT', 'the state is chosen, not typed');
  assert.equal(p.box('district').tagName, 'SELECT', 'so is the district');
  assert.deepEqual([...p.box('state').options].map((o) => o.value).filter(Boolean), INDIA.STATES);
});

test('the district list waits for a state, then holds only that state\'s', () => {
  const p = page();
  assert.equal(p.box('district').disabled, true, 'there is no right district before there is a state');
  p.set(p.box('state'), 'Karnataka', 'change');
  assert.equal(p.box('district').disabled, false);
  assert.deepEqual([...p.box('district').options].map((o) => o.value).filter(Boolean), INDIA.districtsOf('Karnataka'));
});

test('changing the state drops a district that state does not have', () => {
  const p = page();
  p.set(p.box('state'), 'Karnataka', 'change');
  p.set(p.box('district'), 'Udupi', 'change');
  p.set(p.box('state'), 'Punjab', 'change');
  assert.equal(p.box('district').value, '', 'Udupi is not in Punjab and must not survive the move');
});

test('the form will not send without an address, and says so on every box', async () => {
  const p = page();
  p.fill(null);
  p.send();
  await tick();
  assert.equal(p.posted.length, 0, 'a question from nowhere cannot be pointed at a unit');
  for (const key of ['address', 'pincode', 'city', 'state', 'district']) {
    assert.ok(p.box(key).closest('.field').classList.contains('is-bad'), `${key} says it is needed`);
    assert.ok(p.errOf(p.box(key)).textContent.trim(), `with words: ${key}`);
  }
});

test('the form will not send a district the state does not have', async () => {
  /* Reachable by choosing a district and then changing the state with the
     keyboard, which fires no change event that rebuilds the list. */
  const p = page();
  p.fill(UDUPI);
  p.box('state').value = 'Punjab';          /* moved without rebuilding the list */
  p.send();
  await tick();
  assert.equal(p.posted.length, 0, 'Punjab with Udupi under it must not leave the page');
  assert.match(p.errOf(p.box('district')).textContent, /Choose a district in Punjab/);
});

test('a PIN that cannot be in the state is caught as it is typed, and again on send', async () => {
  const p = page();
  p.fill(Object.assign({}, UDUPI, { pincode: '700016' }));
  assert.match(p.errOf(p.box('pincode')).textContent, /PIN code 700016 is in West Bengal, not Karnataka/);
  p.send();
  await tick();
  assert.equal(p.posted.length, 0);
  p.set(p.box('pincode'), '056222');
  assert.match(p.errOf(p.box('pincode')).textContent, /6 digits and does not start with 0/);
});

test('a house number alone, or the town again, is not an address', async () => {
  const p = page();
  p.fill(Object.assign({}, UDUPI, { address: '12' }));
  p.send();
  await tick();
  assert.equal(p.posted.length, 0);
  assert.match(p.errOf(p.box('address')).textContent, /full address/);
  p.set(p.box('address'), 'Kundapur');
  p.send();
  await tick();
  assert.equal(p.posted.length, 0);
  assert.match(p.errOf(p.box('address')).textContent, /not just the place name/);
});

test('a PIN typed in full fills the state, district and town', async () => {
  const p = page((pin) => (pin === '576222' ? { pincode: '576222', state: 'Karnataka', district: 'Udupi', city: 'Koteshwara' } : null));
  p.set(p.box('pincode'), '576222');
  assert.equal(p.box('state').value, 'Karnataka', 'the state at once, from the PIN table');
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(p.box('district').value, 'Udupi', 'the district from India Post');
  assert.equal(p.box('city').value, 'Koteshwara');
  assert.equal(p.errOf(p.box('pincode')).hidden, true, 'and the PIN is good');
});

test('a real address sends, and travels with the question', async () => {
  const p = page();
  p.fill(UDUPI);
  p.send();
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(p.posted.length, 1, 'nothing else should have been in the way');
  const body = p.posted[0];
  assert.equal(body.kind, 'PFA-Q');
  for (const [key, value] of Object.entries(UDUPI)) assert.equal(body.data[key], value, key);
});

/* ---------------------------------------------------------------- server --- */

const askable = (extra) => Object.assign({
  question: 'Can I feed the dogs in my society every evening?',
  topic: 'Animal law', name: 'Asha Rao', email: 'asha@example.in'
}, extra);
const fieldsOf = (data) => validate('PFA-Q', data).errors.map((e) => e.field);

test('the API requires the address, whatever the form does', () => {
  /* A form is a convenience. Anyone can post to the endpoint directly. */
  assert.deepEqual(fieldsOf(askable()), ['address', 'pincode', 'city', 'state', 'district']);
});

test('the API refuses a district that is not in the state given', () => {
  const errs = validate('PFA-Q', askable(Object.assign({}, UDUPI, { state: 'Punjab', pincode: '141001' }))).errors;
  assert.deepEqual(errs.map((e) => e.field), ['district'], 'the pair is wrong, and it is the district that is wrong in it');
  assert.match(errs[0].message, /Choose a district in Punjab/);
});

test('the API refuses a PIN that cannot be in the state', () => {
  const errs = validate('PFA-Q', askable(Object.assign({}, UDUPI, { pincode: '700016' }))).errors;
  assert.deepEqual(errs.map((e) => e.field), ['pincode']);
  assert.match(errs[0].message, /PIN code 700016 is in West Bengal, not Karnataka/);
});

test('a real address passes', () => {
  assert.deepEqual(fieldsOf(askable(UDUPI)), []);
});

test('a missing part is reported once, as missing, not as a broken pair', () => {
  const errs = validate('PFA-Q', askable(Object.assign({}, UDUPI, { district: '' }))).errors.filter((e) => e.field === 'district');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /Choose the district/);
});

test('surrounding space does not turn a real address into a rejection', () => {
  assert.deepEqual(fieldsOf(askable({ address: ' 12 Main Road, Koteshwara ', pincode: ' 576222 ', city: ' Kundapur ', state: ' Karnataka ', district: ' Udupi ' })), []);
});

test('the browser and the API read the one table', () => {
  assert.match(html, /<script src="assets\/india-districts\.js"><\/script>/, 'the page links it');
  const server = read('lib/submission-fields.js');
  assert.match(server, /require\('\.\.\/assets\/india-districts\.js'\)/, 'the API requires it');
  assert.ok(!/var DISTRICTS *= *\{/.test(html), 'and the page keeps no copy that could drift from it');
});
