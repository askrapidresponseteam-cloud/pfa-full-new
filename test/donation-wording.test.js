'use strict';

/* A donation is a donation; only a donation given in someone's name
   ("Give as a gift") is a gift.

   Owner, 21 Oct 2026, of a plain donation's check screen and receipt that
   both said gift: "why donate also says gift. dont have any such goof up
   anywhere on the site", and of the receipt: "for donation. why does it show
   gift". The receipt is held by test/email-wording.test.js; this holds the
   pages. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the donate page, as it loads (a plain donation), never says gift outside the gift choice', () => {
  const doc = new JSDOM(read('donate.html')).window.document;
  for (const id of ['impactLabel', 'gAgreeText', 'gAgreeErr', 'payNote', 'doneHead']) {
    const el = doc.getElementById(id);
    assert.ok(el, `#${id} is on the page`);
    assert.doesNotMatch(el.textContent, /\bgifts?\b/i, `#${id}: "${el.textContent.trim()}"`);
    assert.match(el.textContent, /\bdonation\b/i, `#${id} says donation`);
  }
  /* the dollar note under the PayPal button */
  const fine = [...doc.querySelectorAll('.fine')].map((p) => p.textContent).find((t) => /PayPal/.test(t));
  assert.match(fine, /Dollar donations go through PayPal/);
});

test('the words follow the choice: donation for Donate, gift for Give as a gift', () => {
  const src = read('donate.html');
  assert.match(src, /\$\('#impactLabel'\)\.textContent = wantGift \? 'A gift' : 'Your donation';/);
  assert.match(src, /\$\('#gAgreeText'\)\.textContent = 'I confirm these details are mine and I accept the ' \+ \(wantGift \? 'gift' : 'donation'\) \+ ' and receipt terms\.';/);
  assert.match(src, /\$\('#gAgreeErr'\)\.textContent = 'Accept the ' \+ \(wantGift \? 'gift' : 'donation'\) \+ ' and receipt terms to continue\.';/);
  assert.match(src, /title: gift \? 'Check your gift before you pay' : 'Check your donation before you pay'/);
  /* the plain-donation pay notes */
  const note = src.slice(src.indexOf("$('#payNote').textContent = gift"), src.indexOf('function render()'));
  const plain = note.split(': freq')[1] || '';
  assert.doesNotMatch(plain, /\bgift\b/, 'the once and monthly notes for a donation');
});

test('the server and the shared field rules speak of a donation too', () => {
  assert.match(read('lib/payment.js'), /throw new Error\('Accept the donation and receipt terms to continue\.'\)/);
  assert.match(read('assets/field-rules.js'), /'For a donation above 1 crore, please contact the office directly\.'/);
  assert.match(read('campaign.html'), /Donations through PFA's <a href="donate\.html">donate page<\/a> get an 80G receipt\./);
  assert.match(read('admin.html'), /\.count \+ ' donations'\)/, 'the dashboard counts donations');
});
