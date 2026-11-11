'use strict';

/* Date of birth for donors and members (owner, 11 Nov 2026: "Please add a
   date-of-birth field for each donor or member, wherever applicable. Keep it
   optional and label it 'Date of birth.' Save it to their individual profile
   ... but do not mention birthday cards or automated greetings in the form",
   and "admin section should also have birthday column for each people"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../lib/payment');
const DIR = require('../lib/people-directory');
const SHEET = require('../lib/register-sheet');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-11T06:00:00Z');

test('read as a real day that has come: typed either way, kept as 1990-05-12', () => {
  assert.equal(P.dobOf('1990-05-12', NOW), '1990-05-12');
  assert.equal(P.dobOf('12/05/1990', NOW), '1990-05-12');
  assert.equal(P.dobOf('1990-02-30', NOW), null, 'no 30 February');
  assert.equal(P.dobOf('2026-11-12', NOW), null, 'not a day to come');
  assert.equal(P.dobOf('2026-11-11', NOW), '2026-11-11', 'today, India time');
  assert.equal(P.dobOf('1899-12-31', NOW), null);
  assert.equal(P.birthdayOf('1990-05-12'), '05-12');
});

const MEMBER = {
  type: 'membership', tier: 'silver', terms: 'yes', name: 'Rishabh Sharma', mobile: '9357574422', email: 'r@example.com',
  house: 'Chamber No 588', street: 'District Courts', city: 'Patiala', district: 'Patiala', state: 'Punjab', pincode: '147001'
};

test('the membership form: optional, kept on the transaction, never in what CCAvenue is sent', () => {
  const none = P.parsePaymentRequest(MEMBER);
  assert.equal(none.metadata.dob, undefined, 'left empty, nothing');
  const given = P.parsePaymentRequest(Object.assign({}, MEMBER, { dob: '1985-01-26' }));
  assert.equal(given.metadata.dob, '1985-01-26');
  assert.ok(!JSON.stringify(given.merchantValues).includes('1985'));
  assert.throws(() => P.parsePaymentRequest(Object.assign({}, MEMBER, { dob: 'yesterday' })), /Enter a real date of birth, or leave it empty\./);
});

test('on both forms, labelled Date of birth, optional, and nothing said about what it is for', () => {
  for (const [file, id] of [['donate.html', 'gDob'], ['get-involved.html', 'memDob']]) {
    const html = read(file);
    const box = new RegExp(`<div class="field"><label for="${id}">Date of birth <span class="opt">\\(optional\\)</span></label><input id="${id}" name="dob" type="date" autocomplete="bday" min="1900-01-01"><span class="error">Enter a real date of birth, or leave it empty\\.</span></div>`);
    assert.match(html, box, `${file}: the field`);
    assert.doesNotMatch(html.match(box)[0], /required/, `${file}: optional`);
    const words = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(words, /birthday|greeting/i, `${file}: no word of what it is for`);
    assert.match(html, /\.field input\[type="date"\]\{[^}]*height:/, `${file}: as tall as the other boxes when empty`);
  }
  assert.match(read('lib/routes/payment/response.js'), /\.\.\.\(meta\.dob \? \{ dob: meta\.dob \} : \{\}\)/);
  assert.match(read('lib/submission-forward.js'), /dob: 'Date of birth'/);
  assert.match(read('assets/form-preview.js'), /a date reads as a date/);
});

test('the People directory: one date of birth for each person, the latest given, in its own column and the download', () => {
  const at = Date.parse('2026-11-01T00:00:00Z');
  const people = DIR.merge([
    DIR.entryOf('PFA-DON-2026-00001', { kind: 'PFA-DON', status: 'new', receivedAtMs: at, fields: { name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', dob: '1990-05-12' } }),
    DIR.entryOf('PFA-MEM-2026-00009', { kind: 'PFA-MEM', status: 'new', receivedAtMs: at + 1000, fields: { name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', state: 'Karnataka' } }),
    DIR.entryOf('PFA-MEM-2026-00010', { kind: 'PFA-MEM', status: 'new', receivedAtMs: at + 2000, fields: { name: 'Ravi Rao', mobile: '9876500000', dob: 'not a date' } })
  ]);
  const asha = people.find((p) => p.name === 'Asha Kumar');
  assert.equal(asha.dob, '1990-05-12', 'kept when a later record did not ask');
  assert.equal(asha.birthday, '05-12');
  assert.deepEqual(asha.categories.sort(), ['donor', 'member']);
  assert.equal(people.find((p) => p.name === 'Ravi Rao').dob, '', 'nothing made of a value that is not a date');
  const csv = DIR.csvOf(people);
  assert.match(csv.split('\r\n')[0], /Email,Date of birth,Category/);
  assert.match(csv, /asha@example\.com,12\/05\/1990,/);
  const panel = read('assets/admin-directory.js');
  assert.match(panel, /<th>Phone<\/th><th>Birthday<\/th><th>Category<\/th>/);
  assert.match(panel, /data-bday="' \+ esc\(p\.dob \|\| ''\) \+ '">' \+ \(p\.dob \? esc\(born\(p\.dob\)\) : '-'\)/);
});

test('the Membership register and its Google Sheet carry it, after the email', () => {
  const h = SHEET._test.layoutOf('membership').headers;
  assert.equal(h.indexOf('Date of birth'), h.indexOf('Email') + 1);
  assert.match(read('lib/routes/admin/registers.js'), /\['Date of birth', 'dob'\]/);
});
