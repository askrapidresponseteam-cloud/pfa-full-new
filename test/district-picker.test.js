'use strict';
/* The food order this file's predecessor guarded was retired in v1.300, but
   the fault it existed for did not retire with it: a district typed as free
   text under the wrong state - Punjab with Udupi under it - was accepted,
   saved and paid for. The same discipline now guards the colony caregiver
   application on get-involved.html, where district and state print on the
   card itself, so the picker tests moved there (this file was
   donate-district.test.js until v1.300). The asset-integrity tests never
   cared which page read the table and stay as they were.

   Retired with the donate picker, deliberately: the PIN-to-state inference
   and the campaign-link prefill were features of that picker alone, and the
   caregiver form has neither. If either returns, its tests return with it.

   The list is a snapshot of an administrative geography that changes, so the
   checks here are about the pairing being enforced and the data agreeing with
   itself, not about any one district being current. */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');

/* The table as the site ships it. One file, read by this page, by the ask
   page and by the API, rather than a second copy here that could agree with
   nothing. */
const INDIA = require(path.join(ROOT, 'assets', 'india-districts.js'));
const DISTRICTS_JS = fs.readFileSync(path.join(ROOT, 'assets', 'india-districts.js'), 'utf8');
function districts() {
  const out = {};
  for (const s of INDIA.STATES) out[s] = INDIA.districtsOf(s);
  return out;
}

test('the geography is one file, not a copy per page', () => {
  /* Two copies of a geography drift, and the day they drift is the day an
     applicant picks a district the server then refuses. */
  assert.match(html, /<script src="assets\/india-districts\.js"><\/script>/, 'get-involved.html links it');
  assert.ok(!/var DISTRICTS=\{/.test(html), 'and holds no copy of its own');
});

test('the district is chosen from a list, never typed', () => {
  assert.match(html, /<select id="cgDistrict" name="district" required disabled>/, 'the district is a select');
  assert.ok(!/<input[^>]*name="district"/.test(html), 'no free-text district input exists');
});

test('the table carries the reorganisations the source data predates', () => {
  const D = districts();
  assert.ok(D['Ladakh'] && D['Ladakh'].includes('Leh'), 'Ladakh separated from J&K in 2019');
  assert.ok(D['Dadra and Nagar Haveli and Daman and Diu'], 'the merged UT of 2020 exists');
});

test('no district is listed with leading, trailing or doubled spaces', () => {
  const bad = [];
  const D = districts();
  for (const s of Object.keys(D)) {
    for (const d of D[s]) if (d !== d.trim() || /\s{2,}/.test(d)) bad.push(`${s}: "${d}"`);
  }
  assert.deepEqual(bad, [], 'a stray space makes an unmatchable value');
});

/* ------------------------------------------------------------- behaviour --- */

/* jsdom does not fetch <script src>, so the shared module is inlined where
   the page links it. Same code, same order, same global. */
function withDistricts(markup) {
  const tag = '<script src="assets/india-districts.js"></script>';
  assert.ok(markup.includes(tag), 'the page must link the shared district module');
  return markup.replace(tag, `<script>${DISTRICTS_JS}</script>`);
}

function page() {
  const dom = new JSDOM(withDistricts(html), { runScripts: 'dangerously', url: 'https://pfa.test/get-involved.html' });
  const $ = (q) => dom.window.document.querySelector(q);
  return { dom, $, w: dom.window };
}

function change(w, el) { el.dispatchEvent(new w.Event('change', { bubbles: true })); }

test('every state the applicant can choose has districts to choose from', () => {
  const p = page();
  const offered = [...p.$('#cgState').options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(offered, INDIA.STATES, 'the states offered are exactly the table\'s');
  const D = districts();
  const empty = offered.filter((s) => !D[s] || !D[s].length);
  assert.deepEqual(empty, [], 'a state with no districts is a dead end mid-form');
});

test('the district stays shut until a state is chosen', () => {
  const p = page();
  assert.equal(p.$('#cgDistrict').disabled, true, 'there is no correct district before there is a state');
  p.$('#cgState').value = 'Karnataka';
  change(p.w, p.$('#cgState'));
  assert.equal(p.$('#cgDistrict').disabled, false);
});

test('choosing a state offers that state\'s districts and no others', () => {
  const p = page();
  p.$('#cgState').value = 'Karnataka';
  change(p.w, p.$('#cgState'));
  const shown = [...p.$('#cgDistrict').options].map((o) => o.value).filter(Boolean);
  const D = districts();
  assert.deepEqual(shown, D['Karnataka'], 'the list must be exactly this state\'s');
  assert.ok(!shown.some((d) => D['Punjab'].includes(d)), 'and hold nothing from another state');
});

test('changing the state drops a district that state does not have', () => {
  /* The reported shape: Udupi picked under Karnataka, then the state moved to
     Punjab, and the pair went forward as it stood. The rebuild empties the
     selection, so the wrong pair cannot survive the move. */
  const p = page();
  p.$('#cgState').value = 'Karnataka';
  change(p.w, p.$('#cgState'));
  p.$('#cgDistrict').value = 'Udupi';
  p.$('#cgState').value = 'Punjab';
  change(p.w, p.$('#cgState'));
  assert.equal(p.$('#cgDistrict').value, '', 'Udupi cannot ride into Punjab');
  const shown = [...p.$('#cgDistrict').options].map((o) => o.value).filter(Boolean);
  assert.ok(!shown.includes('Udupi'));
});

test('the server refuses the pair the picker prevents', () => {
  /* The picker is a kindness; the parse is the law. A caregiver application
     posted straight at the API with no district is refused the same way the
     form would have refused it. */
  const payment = require(path.join(ROOT, 'lib', 'payment.js'));
  const good = {
    type: 'caregiver-application', name: 'Asha Rao', mobile: '9876543210', email: 'a@b.in',
    house: '12', street: 'Car Street', colony: 'Car Street colony', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pincode: '576101',
    documents: 'b'.repeat(48)
  };
  assert.doesNotThrow(() => payment.parsePaymentRequest(good));
  assert.throws(() => payment.parsePaymentRequest({ ...good, district: '' }), /district/i);
  assert.throws(() => payment.parsePaymentRequest({ ...good, state: '' }), /state/i);
});
