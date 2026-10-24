'use strict';

/* The one rule file is used by every form and every API route. These tests
   pin down what it accepts, what it refuses, and the shape it stores. */

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../assets/field-rules.js');

test('names take letters only, in Title Case, never digits', () => {
  assert.equal(R.checkField('name', '0000', { required: true }), 'A name cannot contain numbers.');
  assert.equal(R.checkField('name', 'karthik dhanya11', { required: true }), 'A name cannot contain numbers.');
  assert.equal(R.checkField('name', 'A', { required: true }), 'Enter the full name.');
  assert.equal(R.checkField('name', '--', { required: true }), 'Use letters, with spaces, hyphens, apostrophes, or a full stop after an initial.');
  assert.equal(R.checkField('name', '', { required: true, emptyMessage: 'Enter your name.' }), 'Enter your name.');
  assert.equal(R.checkField('name', 'rajesh KUMAR', { required: true }), null);
  assert.equal(R.normaliseField('name', '  rajesh   KUMAR rao '), 'Rajesh Kumar Rao');
  assert.equal(R.normaliseField('name', "dr. a.p.j abdul kalam"), 'Dr. A.P.J Abdul Kalam');
  assert.equal(R.normaliseField('name', "o'brien-smith"), "O'Brien-Smith");
  assert.equal(R.checkField('name', 'राम कुमार', { required: true }), null, 'Indic scripts are names');
  assert.equal(R.filterField('name', 'Priya 123 Sharma!'), 'Priya  Sharma', 'digits and symbols never land in the box');
});

test('every name field on the site is covered by the name rule', () => {
  ['ctName', 'ctRecipient', 'lcRecipient', 'patronName', 'feedName', 'gtlName', 'pName', 'eName',
    'playerName', 'certPlayerName', 'recipient', 'nominee'].forEach((field) => {
    assert.equal(R.ruleName(field), 'personName', field);
  });
});

test('mobiles normalise to ten digits starting 6 to 9', () => {
  assert.equal(R.normaliseField('mobile', '+91 98765 43210'), '9876543210');
  assert.equal(R.normaliseField('mobile', '098765 43210'), '9876543210');
  assert.equal(R.filterField('mobile', '+91 98765 43210'), '9876543210');
  assert.equal(R.filterField('mobile', 'abc98765'), '98765');
  assert.equal(R.checkField('mobile', '0000000000', { required: true }), 'Indian mobile numbers start with 6, 7, 8 or 9.');
  assert.equal(R.checkField('mobile', '98765', { required: true }), 'An Indian mobile number is 10 digits.');
  assert.equal(R.checkField('mobile', '9876543210', { required: true }), null);
});

test('emails are lowercased and must have a dotted domain', () => {
  assert.equal(R.normaliseField('email', ' Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(R.checkField('email', 'a@b', { required: false }), 'Check this email address, for example name@example.com.');
  assert.equal(R.checkField('email', 'name..x@example.com', { required: false }), 'Check this email address, for example name@example.com.');
  assert.equal(R.checkField('email', 'name@example.com', { required: false }), null);
  assert.equal(R.checkField('email', '', { required: false }), null, 'optional and blank is fine');
});

test('PIN codes are six digits and never start with zero', () => {
  assert.equal(R.filterField('pin', '56a0001'), '560001');
  assert.equal(R.checkField('pin', '012345', { required: true }), 'A PIN code does not start with 0.');
  assert.equal(R.checkField('pin', '5600', { required: true }), 'A PIN code is 6 digits.');
  assert.equal(R.checkField('pin', '560001', { required: true }), null);
  ['ctPin', 'ctDeliveryPin', 'lcDeliveryPin', 'patronPin', 'checkoutPin', 'zip', 'pincode'].forEach((f) => {
    assert.equal(R.ruleName(f), 'pin', f);
  });
});

test('addresses keep digits, refuse bare numbers, and print in Title Case', () => {
  assert.equal(R.normaliseField('address', '12b, mg road, koramangala 5th block'), '12B, MG Road, Koramangala 5th Block');
  assert.equal(R.normaliseField('address', 'flat 4\n\nnear temple'), 'Flat 4\n\nNear Temple');
  assert.equal(R.checkField('address', '12345678', { required: true }), 'An address needs a street or locality name, not just numbers.');
  assert.equal(R.checkField('address', 'x', { required: true }), 'Enter the full address: house or building, street and area.');
  assert.equal(R.checkField('address', 'h no 4, abc nagar', { required: true }), null);
});

test('districts, states and cities are letters only and Title Case', () => {
  assert.equal(R.normaliseField('district', 'bengaluru urban'), 'Bengaluru Urban');
  assert.equal(R.normaliseField('state', 'dadra & nagar haveli'), 'Dadra & Nagar Haveli');
  assert.equal(R.checkField('district', 'Sector 12', { required: true }), 'A place name cannot contain numbers.');
  assert.equal(R.filterField('city', 'Delhi 110031'), 'Delhi ');
  /* but a locality or landmark may carry a number */
  assert.equal(R.checkField('place', 'Sector 12, near the temple', { required: true }), null);
  assert.equal(R.checkField('caseLocation', '3rd cross, HSR Layout', { required: true }), null);
});

test('identifiers are uppercased and shaped', () => {
  assert.equal(R.normaliseField('lcCardId', 'pfa-cct-4k7m2qx9'), 'PFA-CCT-4K7M2QX9');
  assert.equal(R.checkField('lcCardId', 'PFA-CCT-4K7', { required: true }), 'Check the card number, for example PFA-CCT-4K7M2QX9.');
  assert.equal(R.checkField('patron', 'PFA-MBR-ABCD1234', { required: true }), null, 'the Patron number field is not a name');
  assert.equal(R.checkField('patron', 'rajesh', { required: true }), 'Check the Patron number, for example PFA-MBR-4K7M2QX9.');
  assert.equal(R.filterField('mCode', '12a34b56'), '123456');
});

test('contact accepts either an email or a mobile, and nothing else', () => {
  assert.equal(R.normaliseField('contact', '+91-9876543210'), '9876543210');
  assert.equal(R.normaliseField('contact', 'Me@Example.com'), 'me@example.com');
  assert.equal(R.checkField('contact', 'hello', { required: true }), 'Enter an email address or a 10-digit mobile number.');
});

test('parseFields gives the API one call with the same verdicts the form shows', () => {
  const bad = R.parseFields({ name: 'a1', mobile: '9876543210' }, [['name', { required: true }], ['mobile', { required: true }]]);
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'name');
  const good = R.parseFields({ name: 'asha RAO', mobile: '+91 9876543210', email: '' },
    [['name', { required: true }], ['mobile', { required: true }], ['email', { required: false }]]);
  assert.deepEqual(good, { ok: true, values: { name: 'Asha Rao', mobile: '9876543210', email: '' } });
});

test('title case keeps initialisms in addresses but not in names', () => {
  assert.equal(R.titleCase('c/o K.S. RAO, MG road, NH 48'), 'C/O K.S. RAO, MG Road, NH 48');
  assert.equal(R.nameCase('K.S. RAO'), 'K.S. Rao');
  assert.equal(R.nameCase('SMT MEENA DAS'), 'Smt Meena Das');
});

/* Added after "Rajesh Kumar." was accepted by the Patron card form and would
   have gone to print with the stop still attached. The tests above covered
   digits, empties and doubled marks: nobody had thought to type a full stop at
   the end of a name, so nothing here caught it.

   The rule now: a full stop abbreviates something. It is earned after an
   initial (K. Srinivasan) or an honorific (Dr. Rajesh) and nowhere else.
   Hyphens and apostrophes join two letters and mean nothing dangling. */

test('a full stop is only ever an abbreviation mark in a name', () => {
  const stored = (v) => R.checkField('name', v, { required: true }) ? null : R.normaliseField('name', v);

  /* the reported bug, and everything shaped like it */
  assert.equal(stored('Rajesh Kumar.'), 'Rajesh Kumar');
  assert.equal(stored('Rajesh.'), 'Rajesh');
  assert.equal(stored('Rajesh Kumar . '), 'Rajesh Kumar');
  assert.equal(stored('Rajesh . Kumar'), 'Rajesh Kumar');
  assert.equal(stored('Rajesh.Kumar'), 'Rajesh Kumar', 'a stop between two words is a missing space');
  assert.equal(stored('Rajesh-'), 'Rajesh');
  assert.equal(stored("Rajesh'"), 'Rajesh');
  assert.equal(stored('.Rajesh'), 'Rajesh');
  assert.equal(stored('Ab...'), 'Ab');

  /* names that are only marks have nothing left once the marks are dropped */
  assert.equal(stored('.'), null);
  assert.equal(stored('...   ...'), null);
  assert.equal(stored("-.'"), null);

  /* initials and honorifics are not a name on their own */
  assert.equal(R.checkField('name', 'A.R.', { required: true }), 'Enter the full name, not only initials.');
  assert.equal(R.checkField('name', 'Dr.', { required: true }), 'Enter the full name, not only initials.');
});

test('the name forms people actually have still go through', () => {
  const stored = (v) => R.checkField('name', v, { required: true }) ? null : R.normaliseField('name', v);

  assert.equal(stored('A.R. Rahman'), 'A.R. Rahman');
  assert.equal(stored('K. Srinivasan'), 'K. Srinivasan');
  assert.equal(stored('Srinivasan K.'), 'Srinivasan K.', 'the initial goes last as often as first');
  assert.equal(stored('M.G.Ramachandran'), 'M.G. Ramachandran');
  assert.equal(stored('Dr. Rajesh'), 'Dr. Rajesh');
  assert.equal(stored('Smt. Sunita Devi'), 'Smt. Sunita Devi');
  assert.equal(stored("O'Connor"), "O'Connor");
  assert.equal(stored('Jean-Luc Picard'), 'Jean-Luc Picard');
  assert.equal(stored('राजेश कुमार'), 'राजेश कुमार');
});

test('a field that asks for a city and a state accepts the comma between them', () => {
  /* careers.html's box is labelled "City and State you are based in" and shows
     "Lucknow, Uttar Pradesh" as the example. The comma was not in the place
     rule's character set, so an applicant who typed what the page asked for
     had it deleted as they typed and, on a direct post, was refused with
     "Use letters only". */
  assert.equal(R.checkField('city', 'Lucknow, Uttar Pradesh', { required: true }), null);
  assert.equal(R.normaliseField('city', 'lucknow, uttar pradesh'), 'Lucknow, Uttar Pradesh');
  assert.equal(R.filterField('city', 'Lucknow, Uttar Pradesh'), 'Lucknow, Uttar Pradesh');

  /* and it is still tidied, not merely tolerated */
  assert.equal(R.normaliseField('city', 'Bengaluru,,,'), 'Bengaluru');
  assert.equal(R.normaliseField('city', ',Bengaluru'), 'Bengaluru');
  assert.equal(R.checkField('city', 'Sector 12', { required: true }), 'A place name cannot contain numbers.');
});

test('place names get the same treatment as names', () => {
  const stored = (v) => R.checkField('city', v, { required: true }) ? null : R.normaliseField('city', v);

  assert.equal(stored('Bengaluru...'), 'Bengaluru');
  assert.equal(stored('Bengaluru--'), 'Bengaluru');
  assert.equal(stored('Ab&&&((('), 'Ab');
  assert.equal(stored('...'), null);

  assert.equal(stored('Bengaluru'), 'Bengaluru');
  assert.equal(stored('Dadra & Nagar Haveli'), 'Dadra & Nagar Haveli');
  assert.equal(stored('Jammu (J&K)'), 'Jammu (J&K)', 'a closing bracket with an opening one to answer to stays');
});
