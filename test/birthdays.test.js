'use strict';

/* Birthdays in the panel (owner, 11 Nov 2026, with PFA-Birthday-Template.html:
   "ensure that there is no abnormal amount of gap anywhere. implement
   enterprise grade. have this in the admin panel. and also have a section
   for birthday's today", "let the font in the card also be marcellus",
   "admin should have birthday reminder stuff"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../lib/routes/admin/birthdays');
const api = require('../api/index.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 11 Nov 2026, 10:00 in India */
const NOW = Date.parse('2026-11-11T04:30:00Z');
const person = (id, name, dob, more) => Object.assign({ id, name, dob, mobile: '9876543210', email: `${id}@example.com`, state: 'Karnataka', district: 'Udupi', categories: ['member'] }, more || {});

test('today\'s birthdays, then the next 30 days, soonest first; age turned; no address', () => {
  const r = R._private.birthdays([
    person('P1', 'Asha Kumar', '1990-11-11'),
    person('P2', 'Ravi Rao', '1985-11-14', { categories: ['donor', 'member'] }),
    person('P3', 'Meera Nair', '2001-12-10'),
    person('P4', 'Late Year', '1970-12-12'),
    person('P5', 'Nobody', ''),
    person('P6', 'Earlier', '1995-11-10')
  ], NOW, 30);
  assert.equal(r.today, '2026-11-11');
  assert.deepEqual(r.people.map((p) => [p.name, p.turns]), [['Asha Kumar', 36]]);
  assert.deepEqual(r.upcoming.map((p) => [p.name, p.inDays]), [['Ravi Rao', 3], ['Meera Nair', 29]], 'within 30 days only; yesterday\'s is next year\'s');
  assert.deepEqual(r.upcoming[0].categories, ['Donor', 'Member']);
  assert.ok(!('address' in r.people[0]), 'no address leaves');
});

test('India\'s day decides, and 29 February is kept on 28 February in other years', () => {
  /* 18:40 UTC on the 10th is the 11th in India */
  const r = R._private.birthdays([person('P1', 'Asha', '1990-11-11')], Date.parse('2026-11-10T18:40:00Z'), 30);
  assert.equal(r.people.length, 1);
  assert.equal(R._private.birthdayIn(2027, '2000-02-29'), '2027-02-28');
  assert.equal(R._private.birthdayIn(2028, '2000-02-29'), '2028-02-29');
  const feb = R._private.birthdays([person('P1', 'Leap', '2000-02-29')], Date.parse('2027-02-28T04:30:00Z'), 30);
  assert.deepEqual(feb.people.map((p) => p.name), ['Leap']);
});

test('its own route, behind the People directory\'s module', () => {
  assert.equal(api._private.ROUTES['admin/birthdays'], './admin/birthdays.js');
  assert.match(read('api/index.js'), /'admin\/birthdays': \(\) => require\('\.\.\/lib\/routes\/admin\/birthdays\.js'\)/);
  assert.match(read('lib/routes/admin/birthdays.js'), /requireAdmin\(request, response, 'directory'\)/);
});

test('in the panel: a Birthdays tab with today\'s count, a notice on every page, and the pane', () => {
  const admin = read('admin.html');
  assert.match(admin, /data-tab="birthdays">Birthdays<span class="pip" id="pipBirthdays" hidden>0<\/span>/);
  assert.match(admin, /<div class="pane" data-pane="birthdays" role="region" aria-label="Birthdays"><\/div>/);
  assert.match(admin, /birthdays: \{ title: 'Birthdays', module: 'directory', needs: 'directory' \}/);
  assert.match(admin, /id="bdayNote" role="status" aria-live="polite" hidden><p id="bdayNoteText"><\/p><button class="press" type="button" id="bdayNoteGo">Open birthdays<\/button>/);
  assert.match(admin, /function replyWatch\(\) \{\n {4}birthdayWatch\(\);/);
  assert.match(admin, /<script src="assets\/birthday-card\.js"><\/script>\n<script src="assets\/admin-birthdays\.js"><\/script>/);
  const fb = read('scripts/build-firebase.js');
  for (const f of ['assets/birthday-card.js', 'assets/admin-birthdays.js', 'media/birthday/card-flowers.jpg', 'media/birthday/card-logo.png']) {
    assert.match(fb, new RegExp(`'${f.replace(/[.]/g, '\\.')}'`), f);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is in the site`);
  }
  const pane = read('assets/admin-birthdays.js');
  assert.match(pane, /<p class="bd-h">Today<\/p>/);
  assert.match(pane, /Coming up <small>/);
  assert.match(pane, /data-bd="download">Download card/);
  assert.match(pane, /data-bd="wish">Copy wish/);
});

test('the card: the template\'s picture and words, all in Marcellus, laid out together with no gap kept for an unused line', () => {
  const card = read('assets/birthday-card.js');
  assert.match(card, /var FACE = 'Marcellus, /);
  assert.match(card, /'\/fonts\/marcellus-latin\.woff2'/);
  assert.doesNotMatch(card, /italic|Georgia, serif'\);/i, 'no other face for the words');
  for (const words of ['Happy Birthday', 'The world is kinder', 'because of you.', 'Wishing you joy, today and always.', 'Warm regards,', 'Maneka Sanjay Gandhi']) assert.ok(card.includes(`'${words}'`), words);
  assert.match(card, /var y = TOP \+ \(BOTTOM - TOP - h\) \/ 2;/, 'the block centred in the space it has');
  assert.match(card, /if \(ctx\.measureText\(l\[0\]\)\.width > widthAt\(base\)\) return null;/, 'every line inside the paper at its height');
  assert.match(card, /throw new RangeError\('Use a name of 160 letters or fewer\.'\)/);
  assert.doesNotMatch(card + read('assets/admin-birthdays.js'), /[–—]/);
});
