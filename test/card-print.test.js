'use strict';

/* The card is printed the way a bank prints a card (owner, 24 Oct 2026:
   "text/font size needs to be same for every card ... no matter the length
   of the name or address. like aadhar card, credit card printing system").
   assets/card-print.js decides what each line prints and proves it fits at
   the one size; these hold it. Since the owner's Classical White template
   (24 Oct 2026) the card is set in Absans, and the widths were checked
   against Chromium's own layout of the template's font on 1,232 strings
   (every district and state in India among them): the same to 0.0125 px
   at 100 px, and the canvas the card is drawn on never wider by more than
   0.002 px. Half a tenth of a millimetre is kept back. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../assets/card-print.js');
const INDIA = require('../assets/india-districts.js');

test('every district and every state in India prints on the card at its one size', () => {
  const misses = [];
  INDIA.STATES.forEach((state) => {
    if (!P.fits(P.placeName(state))) misses.push(state);
    INDIA.districtsOf(state).forEach((d) => { if (!P.fits(P.placeName(d))) misses.push(`${d} (${state})`); });
  });
  assert.deepEqual(misses, []);
});

test('a place prints as the list spells it, without its other name in brackets, and the long ones in a fixed short form', () => {
  assert.equal(P.placeName('Mysuru (Mysore)'), 'Mysuru');
  assert.equal(P.placeName('Bengaluru (Bangalore) Urban'), 'Bengaluru Urban');
  assert.equal(P.placeName('Warangal (Rural)'), 'Warangal Rural', 'a bracket that tells two districts apart stays, as a word');
  assert.equal(P.placeName('Warangal (Urban)'), 'Warangal Urban');
  assert.equal(P.placeName('Dadra and Nagar Haveli and Daman and Diu'), 'DNH and Daman and Diu');
  assert.equal(P.placeName('Andaman and Nicobar Islands'), 'Andaman and Nicobar');
  assert.equal(P.placeName('Sahibzada Ajit Singh Nagar (Mohali)'), 'SAS Nagar (Mohali)');
  assert.equal(P.placeName('North and Middle Andaman'), 'N. & M. Andaman');
  assert.equal(P.placeName('Komaram Bheem Asifabad'), 'K. B. Asifabad');
  assert.equal(P.placeName('Jayashankar Bhoopalpally'), 'J. Bhoopalpally');
  assert.equal(P.placeName('South Salmara-Mankachar'), 'S. Salmara-Mankachar');
  assert.equal(P.placeName('North 24 Parganas'), 'North 24 Parganas');
  assert.equal(P.placeName('udupi'), 'Udupi', 'one typed in lower case is cased');
  assert.equal(P.placeName('ANDAMAN AND NICOBAR ISLANDS'), 'Andaman and Nicobar');
  /* no two districts of one state print alike */
  INDIA.STATES.forEach((state) => {
    const printed = INDIA.districtsOf(state).map(P.placeName);
    assert.equal(new Set(printed).size, printed.length, `${state}: two districts would print alike`);
  });
});

test('a name prints whole when it fits, and otherwise in a fixed short form for the reviewer to confirm', () => {
  assert.deepEqual(P.suggestName('Selina Thakur'), { text: 'Selina Thakur', shortened: false, fits: true });
  assert.deepEqual(P.suggestName('Suresh Venkatesh Kulkarni'), { text: 'Suresh V. Kulkarni', shortened: true, fits: true }, 'the middle names first');
  assert.deepEqual(P.suggestName('Venkata Subramanian Krishnamurthy'), { text: 'V. S. Krishnamurthy', shortened: true, fits: true }, 'then every name but the last');
  assert.deepEqual(P.suggestName('Mohammed Abdul Rahman Siddiqui'), { text: 'M. A. R. Siddiqui', shortened: true, fits: true });
  assert.deepEqual(P.suggestName('Lakshminarayana Venkataramanappa'), { text: 'L. Venkataramanappa', shortened: true, fits: true });
  assert.deepEqual(P.suggestName('José Fernandes'), { text: 'Jose Fernandes', shortened: true, fits: true }, 'an accent comes off, as on a bank card, for the reviewer to confirm');
  assert.equal(P.suggestName('Wwwwwwwwwwwwwwwwwwwwwwwwwwwwww').fits, false, 'one word too long for any rule needs a person');
  assert.equal(P.suggestName('').fits, false);
});

test('the name on the card is refused when it would not print exactly', () => {
  assert.equal(P.nameProblem('V. S. Krishnamurthy'), '');
  assert.equal(P.nameProblem("K. D'Souza"), '');
  assert.match(P.nameProblem(''), /Give the name/);
  assert.match(P.nameProblem('Venkata Subramanian Krishnamurthy'), /Too long for the card/);
  assert.match(P.nameProblem('José Fernandes'), /letters A to Z/, 'the card prints plain letters');
  assert.match(P.nameProblem('Asha <b>Rao</b>'), /letters A to Z, spaces/);
  assert.match(P.nameProblem('Asha 2 Rao'), /letters A to Z, spaces/);
});

test('widths are the font\'s own, at the card\'s size, and the line is the template\'s', () => {
  /* in tenths of a millimetre on the 85.6 x 54 mm card */
  assert.equal(P.SIZE, 25.3407, 'the template\'s 7.2 pt');
  assert.equal(P.ROOM.toFixed(3), '296.516', 'the value column of the template');
  assert.equal(P.LIMIT.toFixed(3), '296.016', 'half a tenth of a millimetre kept back');
  /* the template's own font laid out by Chromium at 100 px */
  assert.ok(Math.abs(P.width('Selina Thakur', 100) - 633.906) < 0.05, P.width('Selina Thakur', 100));
  assert.ok(Math.abs(P.width('PFA-CCT-ABCD2345', 100) - 1033.203) < 0.05, P.width('PFA-CCT-ABCD2345', 100));
  assert.ok(Math.abs(P.width('AV', 100) - 139.609) < 0.05, 'and its kerning');
  assert.ok(P.width('AV') < P.width('A') + P.width('V'), 'kerned within a word');
  assert.equal(P.width('A A'), P.width('A') + P.width(' ') + P.width('A'), 'never across a space');
  /* a date always fits; a card number is only ever given if it fits
     (lib/caregiver.js), and even the widest the alphabet can make ends
     clear of the photograph (assets/caregiver-card.js: the value column
     starts at 24.25 mm, the photograph at 59.45 mm) */
  assert.ok(P.fits('28/08/2026'));
  assert.ok(242.484 + P.width('PFA-CCT-WWWWWWWW') < 594.516 - 20, 'two millimetres clear of the photograph');
  const CAREGIVER = require('../lib/caregiver');
  for (let i = 0; i < 300; i += 1) assert.ok(P.fits(CAREGIVER.createCardId()));
});

test('the browser and the server read the one rule', () => {
  /* the panel is the one page that draws the card (24 Oct 2026) */
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.indexOf('assets/card-print.js') > -1 && html.indexOf('assets/card-print.js') < html.indexOf('assets/caregiver-card.js'), 'admin.html loads the rule before the card');
  for (const f of ['lib/routes/admin/case.js', 'lib/routes/admin/applications.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /require\('\.\.\/\.\.\/\.\.\/assets\/card-print\.js'\)/, f);
  }
});
