'use strict';

/* The place, exactly as PFA should read it.

   Owner, 25 Oct 2026: "I hope now all the forms go to gandhim with location
   details captured perfectly". Every form was then filled in a browser and
   sent through the real server; the address line reached gandhim on all of
   them. Two things in it were not yet exact, and are held here:

     1. India Post names every Mumbai PIN's district "Mumbai", Bandra and
        Andheri included, and the list has Mumbai City and Mumbai Suburban;
        the PIN filled in Mumbai City for a Bandra address. A district that
        only matches once "City" or a bracket is dropped from it, while
        another district shares the name, is now left for the person to
        choose. A name that is a district exactly is still that district.
     2. An address typed in capitals (as many are) came out "Near THE Metro,
        NEW Delhi", and the little words of any address were capitalised
        ("Bank Of Baroda"). Capitals throughout now say nothing about
        initialisms beyond the known ones (MG, DLF, SBI), and the, of, and
        and the like are small inside a part of the address. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const RULES = require('../assets/field-rules.js');

function address() {
  const india = require('../assets/india-districts.js');
  const doc = { addEventListener() {}, readyState: 'complete', querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
  const win = { PFA_INDIA: india, document: doc, navigator: {} };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'address.js'), 'utf8'), win);
  return win.PFAAddress;
}

test('a PIN names a district only when it can only be that one', () => {
  const A = address();
  const cases = [
    ['Maharashtra', 'Mumbai', ''], ['Maharashtra', 'Mumbai Suburban', 'Mumbai Suburban'], ['Maharashtra', 'Mumbai City', 'Mumbai City'],
    ['Telangana', 'Warangal', ''], ['Karnataka', 'Bangalore', ''],
    ['Assam', 'Kamrup', 'Kamrup'], ['Assam', 'Kamrup Metro', 'Kamrup Metropolitan'],
    ['Delhi', 'East Delhi', 'East Delhi'], ['Delhi', 'South Delhi', 'South Delhi'], ['Uttar Pradesh', 'Rampur', 'Rampur'],
    ['West Bengal', 'Kolkata', 'Kolkata'], ['Karnataka', 'Udupi', 'Udupi'], ['Telangana', 'Hyderabad', 'Hyderabad'], ['Odisha', 'Khordha', 'Khordha']
  ];
  for (const [state, said, want] of cases) assert.equal(A._districtOf(state, said), want, `${said}, ${state}`);
});

test('an address reads as an address, however it was typed', () => {
  const cases = [
    ['12 PARK STREET, NEAR THE METRO, NEW DELHI', '12 Park Street, Near the Metro, New Delhi'],
    ['H NO 5, GALI NO 3, OLD DLF COLONY', 'H No 5, Gali No 3, Old DLF Colony'],
    ['near the temple of sri krishna and the tank', 'Near the Temple of Sri Krishna and the Tank'],
    ['bank of baroda building, mg road', 'Bank of Baroda Building, MG Road'],
    ['The Leela, Sahar Road', 'The Leela, Sahar Road'],
    ['plot 7, block a, sector 4', 'Plot 7, Block A, Sector 4'],
    ['House 3, By Lane 4, Hatigaon', 'House 3, By Lane 4, Hatigaon'],
    ['Flat 12, SBI Colony', 'Flat 12, SBI Colony'],
    ['IIT CAMPUS, HAUZ KHAS', 'IIT Campus, Hauz Khas'],
    ['flat 4b, 2nd floor', 'Flat 4B, 2nd Floor']
  ];
  for (const [typed, want] of cases) assert.equal(RULES.titleCase(typed), want, typed);
  /* the town box too: NEW DELHI is New Delhi, and a union territory keeps its "and" */
  assert.equal(RULES.normaliseField('city', 'NEW DELHI'), 'New Delhi');
  assert.equal(RULES.titleCase('dadra and nagar haveli'), 'Dadra and Nagar Haveli');
  /* a person's name is not an address: every word of it is a name */
  assert.equal(RULES.nameCase('ASHA DE SOUZA'), 'Asha De Souza');
});

test('Join the tribe stays on one line', () => {
  const html = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  assert.match(html, /<h1 class="pfa-title gi__title">Join the tribe\.<\/h1>/);
  assert.match(html, /\.gi__head\{max-width:none\}/, 'the head is not held narrower than its title');
  assert.match(html, /@media \(min-width:360px\)\{main h1\.gi__title\{white-space:nowrap\}\}/);
});

/* ---- what the person sees while typing -------------------------------- */

const { JSDOM } = require('jsdom');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function ownBoxes(place) {
  const dom = new JSDOM(`<form id="f">
    <div class="field"><input name="address" id="a"><span class="error">Add the address.</span></div>
    <div class="field"><input name="city" id="c"><span class="error">Tell us the city or town.</span></div>
    <div class="field"><select name="state" id="s"><option value="">Select</option><option>Karnataka</option><option>West Bengal</option></select><span class="error">Pick your state.</span></div>
    <div class="field"><input name="pincode" id="p"><span class="error">Enter the 6-digit PIN code.</span></div>
    <input id="next">
  </form>`, { runScripts: 'outside-only', url: 'https://pfa.test/get-involved.html' });
  const w = dom.window;
  let answer = null;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer) });
  for (const f of ['assets/india-districts.js', 'assets/field-rules.js', 'assets/field-validate.js', 'assets/address.js']) w.eval(read(f));
  const doc = w.document;
  w.PFAAddress.enhance(doc.getElementById('f'), { pincode: doc.getElementById('p'), state: doc.getElementById('s'), city: doc.getElementById('c'), address: doc.getElementById('a') });
  answer = place;
  return { w, doc };
}

test('a PIN in another state keeps saying so after the box is left, and gives no town', async () => {
  const { w, doc } = ownBoxes({ pincode: '700016', state: 'West Bengal', district: 'Kolkata', city: 'Kolkata', street: '' });
  doc.getElementById('s').value = 'Karnataka';
  const pin = doc.getElementById('p');
  pin.value = '700016';
  pin.dispatchEvent(new w.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const box = pin.closest('.field');
  assert.equal(box.querySelector('.error').textContent, 'PIN code 700016 is in West Bengal, not Karnataka. Check the PIN code or the state.');
  /* leaving the box judged its shape alone, and wiped the message */
  pin.dispatchEvent(new w.FocusEvent('blur'));
  assert.ok(box.classList.contains('is-bad'), 'still marked after the box is left');
  assert.equal(box.querySelector('.error').textContent, 'PIN code 700016 is in West Bengal, not Karnataka. Check the PIN code or the state.');
  assert.equal(doc.getElementById('c').value, '', 'Kolkata is not put in as the town of a Karnataka address');
  assert.equal(doc.getElementById('s').value, 'Karnataka', 'the state the person chose stays');
});
