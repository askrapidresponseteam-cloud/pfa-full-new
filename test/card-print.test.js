'use strict';

/* The card is printed the way a bank prints a card (owner, 24 Oct 2026:
   "text/font size needs to be same for every card ... no matter the length
   of the name or address. like aadhar card, credit card printing system").
   assets/card-print.js decides what each line prints and proves it fits at
   the one size; these hold it. The widths were checked against Chromium's
   own measure of the card's font on 770 strings (every district and state
   in India among them): the largest difference was 0.03 px on a 220 px
   line, and half a pixel is kept back. */

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
  assert.equal(P.placeName('North and Middle Andaman'), 'North & Middle Andaman');
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
  assert.deepEqual(P.suggestName('Venkata Subramanian Krishnamurthy'), { text: 'Venkata S. Krishnamurthy', shortened: true, fits: true }, 'the middle names first');
  assert.deepEqual(P.suggestName('Mohammed Abdul Rahman Siddiqui'), { text: 'Mohammed A. R. Siddiqui', shortened: true, fits: true });
  assert.deepEqual(P.suggestName('Lakshminarayana Venkataramanappa'), { text: 'L. Venkataramanappa', shortened: true, fits: true }, 'then every name but the last');
  assert.equal(P.suggestName('Wwwwwwwwwwwwwwwwwwwwwwwwwwwwww').fits, false, 'one word too long for any rule needs a person');
  assert.equal(P.suggestName('').fits, false);
});

test('the name on the card is refused when it would not print exactly', () => {
  assert.equal(P.nameProblem('V. S. Krishnamurthy'), '');
  assert.equal(P.nameProblem("K. D'Souza"), '');
  assert.match(P.nameProblem(''), /Give the name/);
  assert.match(P.nameProblem('Venkata Subramanian Krishnamurthy'), /Too long for the card/);
  assert.match(P.nameProblem('Asha <b>Rao</b>'), /letters, spaces/);
  assert.match(P.nameProblem('Asha 2 Rao'), /letters, spaces/);
});

test('widths are the font\'s own, at the card\'s size, and the line is the template\'s', () => {
  assert.equal(P.SIZE, 18.06);
  assert.equal(P.ROOM.toFixed(2), '220.15', 'from the value\'s left edge to the end of its rule');
  assert.equal(P.LIMIT.toFixed(2), '219.65', 'half a pixel kept back');
  /* measured in Chromium with the card's font (fonts/arimo-latin-400.woff2) */
  assert.ok(Math.abs(P.width('Selina Thakur') - 111.43) < 0.05, P.width('Selina Thakur'));
  assert.ok(Math.abs(P.width('PFA-CCT-ABCD2345') - 172.63) < 0.05, P.width('PFA-CCT-ABCD2345'));
  assert.ok(P.width('AV') < P.width('A') + P.width('V'), 'kerned within a word');
  assert.equal(P.width('A A'), P.width('A') + P.width(' ') + P.width('A'), 'never across a space');
  /* the fixed formats always fit */
  assert.ok(P.fits('PFA-CCT-WWWWWWWW'));
  assert.ok(P.fits('28/08/2026'));
});

test('the browser and the server read the one rule', () => {
  /* the panel is the one page that draws the card (24 Oct 2026) */
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.indexOf('assets/card-print.js') > -1 && html.indexOf('assets/card-print.js') < html.indexOf('assets/caregiver-card.js'), 'admin.html loads the rule before the card');
  for (const f of ['lib/routes/admin/case.js', 'lib/routes/admin/applications.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /require\('\.\.\/\.\.\/\.\.\/assets\/card-print\.js'\)/, f);
  }
});
