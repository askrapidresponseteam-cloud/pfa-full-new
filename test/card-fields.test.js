'use strict';

/* The claim being tested is "no field on either card is ever blank". That is a
   claim about every combination of missing input, not about a few cases
   someone thought of - so it is tested that way: every subset of the inputs is
   withheld in turn and every string the renderer would draw is checked.

   Six inputs on the Patron card and seven on the Colony caregiver card, so 64 and 128
   combinations. Exhaustive over the field set, which is what makes the claim
   worth making. */

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../assets/card-fields.js');

const NOW = new Date(2026, 7, 22);          /* 22 Aug 2026 */

/* Every string either renderer puts on the card. If a field is added to a card
   it belongs here, or the guarantee quietly stops covering it. */
function patronStrings(out) {
  return [
    ['idText', out.idText], ['serial', out.serial], ['name', out.name],
    ['since', out.since], ['valid', out.valid], ['stamp', out.stamp],
    ['standing', out.standing], ['qr', out.qr], ['qrCaption', out.qrCaption]
  ].concat(out.addressLines.map((line, i) => [`address[${i}]`, line]));
}

function caregiverStrings(out) {
  return [
    ['idText', out.idText], ['name', out.name], ['year', out.year],
    ['issuedOn', out.issuedOn], ['role', out.role], ['mobile', out.mobile],
    ['qr', out.qr], ['qrCaption', out.qrCaption]
  ].concat(out.addressLines.map((line, i) => [`address[${i}]`, line]))
   .concat(out.contactLines.map((line, i) => [`contact[${i}]`, line]));
}

function subsets(keys) {
  const out = [];
  for (let mask = 0; mask < (1 << keys.length); mask += 1) {
    const withheld = keys.filter((_, i) => mask & (1 << i));
    out.push(withheld);
  }
  return out;
}

test('no Patron card field is ever blank, for any combination of missing input', () => {
  const full = {
    id: 'PFA-MBR-4K7M2QX9', name: 'Ananya Krishnan', since: 'Aug 2026',
    valid: 'Aug 2027', addressLines: [{ text: '221B Kalbadevi Road' }, { text: 'Mumbai 400002' }],
    photo: 'data:image/jpeg;base64,xx'
  };
  const keys = Object.keys(full);
  let checked = 0;

  for (const withheld of subsets(keys)) {
    const input = Object.assign({}, full);
    withheld.forEach((k) => { delete input[k]; });

    const out = F.patron(input, NOW);
    for (const [field, value] of patronStrings(out)) {
      assert.equal(typeof value, 'string', `${field} is not a string without [${withheld}]`);
      assert.ok(value.trim().length > 0, `${field} is blank when [${withheld}] are missing`);
      checked += 1;
    }
    /* Anything shown as a placeholder must be reported, so an issued card can
       be refused rather than printed with ghost text on it. */
    Object.keys(out.ghost).forEach((field) => {
      assert.ok(out.missing.includes(field),
        `${field} was placeholdered but not reported, withholding [${withheld}]`);
    });
    assert.equal(out.issuable, withheld.length === 0);
  }
  assert.equal(subsets(keys).length, 64);
  assert.ok(checked > 500, `only ${checked} values checked`);
});

test('no Colony caregiver card field is ever blank, for any combination of missing input', () => {
  const full = {
    cardId: 'PFA-CCT-4K7M2QX9', name: 'Karthik Dhanya',
    address: '4/232 Ashraya Ankadakatte NH66\nKoteshwara, Udupi, Karnataka, 576217',
    mobile: '8105250299', email: 'karthik.dhanya11@gmail.com',
    issuedOn: '22 August 2026', year: '2026', district: 'Udupi', state: 'Karnataka'
  };
  const keys = Object.keys(full);
  let checked = 0;

  for (const withheld of subsets(keys)) {
    const input = Object.assign({}, full);
    withheld.forEach((k) => { delete input[k]; });

    const out = F.caregiver(input, NOW);
    for (const [field, value] of caregiverStrings(out)) {
      assert.equal(typeof value, 'string', `${field} is not a string without [${withheld}]`);
      assert.ok(value.trim().length > 0, `${field} is blank when [${withheld}] are missing`);
      checked += 1;
    }
    /* Not "anything withheld must be reported" - withholding the mobile when
       an email is present substitutes nothing, and a card carrying a real
       email has real contact details. The invariant that matters is that
       anything SHOWN AS A PLACEHOLDER is reported, so an issued card can never
       be printed with the word "Address line" on it without the caller having
       been told. */
    Object.keys(out.ghost).forEach((field) => {
      assert.ok(out.missing.includes(field),
        `${field} was placeholdered but not reported, withholding [${withheld}]`);
    });
    if (withheld.includes('cardId')) assert.ok(out.missing.includes('cardId'));
    if (withheld.includes('address')) assert.ok(out.missing.includes('address'));
    if (withheld.includes('mobile') && withheld.includes('email')) {
      assert.ok(out.missing.includes('contact'), 'a card with no way to reach anyone must say so');
    }
  }
  assert.equal(subsets(keys).length, 512);
  assert.ok(checked > 3600, `only ${checked} values checked`);
});

test('empty strings, whitespace and nulls count as missing, not as values', () => {
  /* The commonest real fault is not an absent key but a blank one arriving
     from a form or a database. */
  for (const empty of ['', '   ', null, undefined, '\n\t ']) {
    const p = F.patron({ id: 'PFA-MBR-4K7M2QX9', name: empty, since: empty }, NOW);
    assert.equal(p.name, 'Your Name');
    assert.ok(p.missing.includes('name'));
    assert.ok(p.since.trim().length > 0);

    const c = F.caregiver({ cardId: 'PFA-CCT-4K7M2QX9', address: empty, mobile: empty, email: empty }, NOW);
    assert.ok(c.addressLines.every((l) => l.trim().length > 0));
    assert.ok(c.contactLines.every((l) => l.trim().length > 0));
    assert.ok(c.missing.includes('contact'));
  }
});

test('dates are derived rather than placeholdered', () => {
  /* A validity date is the issue date plus a year. Deriving it makes the card
     correct; a placeholder would only make it non-empty. */
  assert.equal(F.patron({ since: 'Aug 2026' }, NOW).valid, 'Aug 2027');
  assert.equal(F.patron({ valid: 'Mar 2028' }, NOW).since, 'Mar 2027');
  assert.equal(F.patron({ since: 'Aug 2026' }, NOW).stamp, '01082026');

  const neither = F.patron({}, NOW);
  assert.equal(neither.since, 'Aug 2026');
  assert.equal(neither.valid, 'Aug 2027');
  assert.deepEqual(neither.missing.filter((m) => m === 'since' || m === 'valid'), ['since', 'valid']);

  /* An unparseable date is treated as absent, never formatted as NaN. */
  const rubbish = F.patron({ since: 'sometime last year' }, NOW);
  assert.ok(!/NaN/.test(rubbish.since + rubbish.valid + rubbish.stamp));
});

test('the QR always has something valid to encode', () => {
  const issued = F.patron({ id: 'PFA-MBR-4K7M2QX9' }, NOW);
  assert.ok(issued.qr.includes('PFA-MBR-4K7M2QX9'));
  assert.equal(issued.qrCaption, 'Scan to verify');

  const preview = F.patron({}, NOW);
  assert.ok(preview.qr.includes('SPECIMEN'), 'a preview encodes a specimen, not an empty id');
  assert.equal(preview.qrCaption, 'Specimen');

  assert.ok(F.caregiver({ cardId: 'PFA-CCT-4K7M2QX9' }, NOW).qr.includes('PFA-CCT-4K7M2QX9'));

  /* The hole that the exhaustive sweep missed the first time, because `qr` was
     not in the list of strings it checked: a card with no number drew a white
     plate with no code in it, under a caption telling the reader to scan it. */
  const noNumber = F.caregiver({}, NOW);
  assert.ok(noNumber.qr.includes('SPECIMEN'), 'an unissued caregiver card still encodes something');
  assert.equal(noNumber.qrCaption, 'Specimen');
});

test('a real value is never replaced by a placeholder', () => {
  /* The failure that would make all of the above worthless. */
  const p = F.patron({
    id: 'PFA-MBR-4K7M2QX9', name: "K. D'Souza", since: 'Jan 2020', valid: 'Jan 2021',
    addressLines: [{ text: '12 MG Road' }]
  }, NOW);
  assert.equal(p.name, "K. D'Souza");
  assert.equal(p.since, 'Jan 2020');
  assert.equal(p.valid, 'Jan 2021');
  assert.deepEqual(p.addressLines, ['12 MG Road']);
  assert.equal(p.serial, '2QX9');

  const c = F.caregiver({
    cardId: 'PFA-CCT-ABCD1234', name: 'Meena Iyer', address: 'Line one\nLine two',
    mobile: '9876543210', email: 'm@example.com', issuedOn: '1 March 2026', district: 'Udupi', state: 'Karnataka'
  }, NOW);
  assert.equal(c.issuedShort, '01/03/2026', 'the date as the card prints it');
  assert.equal(c.district, 'Udupi');
  assert.deepEqual(c.addressLines, ['Line one', 'Line two']);
  assert.deepEqual(c.contactLines, ['9876543210', 'm@example.com']);
  assert.equal(c.issuedOn, '1 March 2026');
  assert.equal(c.missing.length, 0);
  assert.equal(c.issuable, true);
});

test('every page that draws a card also loads the field completer', () => {
  /* The renderers fall back to raw, possibly blank, data when PFACardFields is
     not on the page. That fallback is deliberate - a missing script should not
     throw - but it means the guarantee is only as good as the script tag. So
     the pages are checked rather than trusted. */
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const drawing = pages.filter((f) => {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    return /assets\/caregiver-card\.js/.test(html);
  });

  /* This used to require four such pages, from when the Patron card and its
     own pages existed. Only the colony caregiver card is left, drawn in the
     panel, so the floor is one: the point is that every page which draws a
     card loads the completer, not how many pages there happen to be. */
  assert.ok(drawing.length >= 1, `expected at least one card page, found ${drawing.length}`);
  for (const page of drawing) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.includes('assets/card-fields.js'),
      `${page} draws a card but does not load card-fields.js, so its fields could print blank`);
  }
});
