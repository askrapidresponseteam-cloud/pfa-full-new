'use strict';

/* PFA's state code directory (owner, 11 Nov 2026, with PFA_State_Codes.xlsx:
   "state wise code directory- add this to admin panel", "I want the state
   codes to be as given in the xlsx sheet", "for the ones that migrated- do
   mention was PB earlier", "let state come before member number column",
   "ensure the code is correctly updated so that admin writes perfectly to
   sheets automatically"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const NUM = require('../lib/member-numbers');
const CASE = require('../lib/routes/admin/case');
const SHEET = require('../lib/register-sheet');
const INDIA = require('../assets/india-districts.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOV = Date.parse('2026-11-11T04:00:00.000Z');

let db;
test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); });
test.afterEach(() => { firebase._setDbForTests(null); });

/* PFA_State_Codes.xlsx, as sent */
const XLSX = {
  'Andaman and Nicobar Islands': 'A&N', 'Andhra Pradesh': 'AP', 'Arunachal Pradesh': 'ARP', Assam: 'ASSM', Bihar: 'BHR',
  Chandigarh: 'CHD', Chhattisgarh: 'CHT', 'Dadra and Nagar Haveli and Daman and Diu': 'DNH', Delhi: 'DLH', Goa: 'GOA',
  Gujarat: 'GJT', Haryana: 'HRY', 'Himachal Pradesh': 'HP', 'Jammu and Kashmir': 'J&K', Jharkhand: 'JK', Karnataka: 'KNT',
  Kerala: 'KRL', Ladakh: 'LDK', Lakshadweep: 'LAK', 'Madhya Pradesh': 'MP', Maharashtra: 'MST', Manipur: 'MNP',
  Meghalaya: 'MGH', Mizoram: 'MZR', Nagaland: 'NGL', Odisha: 'ORS', Puducherry: 'PDY', Punjab: 'PNB', Rajasthan: 'RAJ',
  Sikkim: 'SKM', 'Tamil Nadu': 'TN', Telangana: 'TG', Tripura: 'TRP', 'Uttar Pradesh': 'UP', Uttarakhand: 'UK', 'West Bengal': 'WB'
};

test('every state and union territory carries the code in the directory, and no code means two states', () => {
  assert.equal(Object.keys(XLSX).length, 36);
  for (const [state, code] of Object.entries(XLSX)) assert.equal(NUM.placeOf(state).code, code, state);
  for (const s of INDIA.STATES) assert.ok(XLSX[s], `${s} is in the directory`);
  const seen = {};
  for (const [name, s] of Object.entries(NUM.STATES)) {
    for (const k of [s.code].concat(s.aka || [])) { assert.ok(!seen[k] || seen[k] === name, `${k} means both ${seen[k]} and ${name}`); seen[k] = name; }
  }
  assert.deepEqual(NUM.directory().map((x) => [x.state, x.code]), Object.entries(XLSX).sort((a, b) => a[0].localeCompare(b[0])));
});

test('a new code never moves a count: each state keeps the series it had, so no number is given twice', () => {
  const before = { Punjab: 'PB', Karnataka: 'KA', Maharashtra: 'MH', Rajasthan: 'RJ', 'Jammu and Kashmir': 'JK', Jharkhand: 'JH',
    Chhattisgarh: 'MP-CG', 'Madhya Pradesh': 'MP-CG', Telangana: 'AP-TG', Uttarakhand: 'UP-UK', 'Tamil Nadu': 'TN', Haryana: 'HRY', Delhi: 'DLH', Goa: 'GA', Puducherry: 'PUD' };
  for (const [state, series] of Object.entries(before)) assert.equal(NUM.placeOf(state).series, series, state);
  /* an old number is still read, in the old code or the new */
  assert.equal(NUM.readOld('PB 1378').label, 'PNB 1378');
  assert.equal(NUM.readOld('PNB 1378').series, 'PB');
  assert.equal(NUM.readOld('KA 2036').label, 'KNT 2036');
  assert.equal(NUM.readOld('J&K 1201').series, 'JK');
  assert.equal(NUM.seriesList().find((x) => x.series === 'MP-CG').name, 'CHT MP');
});

test('numbers already given take the new code, keep their digits and say what they were, everywhere at once, once', async () => {
  const pb = { label: 'PB 1378', code: 'PB', n: 1378, series: 'PB', state: 'Punjab', at: '2026-10-29T00:00:00Z' };
  const ka = { label: 'KA 2036', code: 'KA', n: 2036, series: 'KA', state: 'Karnataka' };
  const tn = { label: 'TN 4841', code: 'TN', n: 4841, series: 'TN', state: 'Tamil Nadu' };
  const mh = { label: 'MH 2399', code: 'MH', n: 2399, series: 'MH', state: 'Maharashtra' };
  await db.collection('submissions').doc('PFA-MEM-2026-00004').set({ kind: 'PFA-MEM', status: 'card-approved', fields: { state: 'Punjab' }, memberNo: pb, memberCard: { cardId: 'PB 1378', printed: false } });
  await db.collection('submissions').doc('PFA-MEM-2026-00017').set({ kind: 'PFA-MEM', status: 'new', fields: { state: 'Karnataka' }, memberNo: ka });
  await db.collection('submissions').doc('PFA-MEM-2026-00005').set({ kind: 'PFA-MEM', status: 'new', fields: { state: 'Tamil Nadu' }, memberNo: tn });
  await db.collection('submissions').doc('PFA-CG-2026-00016').set({ kind: 'PFA-CG', status: 'approved', cardId: 'PFA-CCT-ABCD2345', fields: { state: 'Maharashtra' }, caregiverNo: mh });
  await db.collection('caretakerCards').doc('PFA-CCT-ABCD2345').set({ caregiverNo: 'MH 2399' });
  await db.collection('caretakerPublic').doc('PFA-CCT-ABCD2345').set({ caregiverNo: 'MH 2399' });
  await db.collection('member_numbers').doc('PB-1378').set(Object.assign({ kind: 'new', holder: 'PFA-MEM-2026-00004' }, pb));
  await db.collection('member_numbers').doc('PB-1201').set({ kind: 'old', series: 'PB', n: 1201, code: 'PB', label: 'PB 1201' });
  await db.collection('member_number_holders').doc('PFA-MEM-2026-00004').set({ number: pb, holder: 'PFA-MEM-2026-00004' });
  await db.collection('caregiver_number_holders').doc('PFA-CG-2026-00016').set({ number: mh, holder: 'PFA-CG-2026-00016' });

  const r = await CASE.applyStateCodes(db, { nowMs: NOV });
  assert.equal(r.state, 'relabelled');
  const dump = db.dump();
  const m = dump['submissions/PFA-MEM-2026-00004'];
  assert.equal(m.memberNo.label, 'PNB 1378');
  assert.equal(m.memberNo.code, 'PNB');
  assert.equal(m.memberNo.n, 1378, 'the digits stay');
  assert.equal(m.memberNo.series, 'PB', 'and so does the count it came from');
  assert.equal(m.memberNo.was, 'PB 1378', 'it says what it was');
  assert.deepEqual(m.memberNoBefore, ['PB 1378'], 'search still finds it by the old number');
  assert.equal(m.memberCard.cardId, 'PNB 1378', 'the card number is the member number');
  assert.equal(m.memberCard.printed, false, 'the rest of the card is untouched');
  assert.ok(m.history.some((h) => h.event === 'number-relabelled' && h.was === 'PB 1378' && h.number === 'PNB 1378'));
  assert.equal(dump['submissions/PFA-MEM-2026-00017'].memberNo.label, 'KNT 2036');
  assert.equal(dump['submissions/PFA-MEM-2026-00005'].memberNo.label, 'TN 4841', 'a code that did not change is left alone');
  assert.equal(dump['submissions/PFA-MEM-2026-00005'].memberNo.was, undefined);
  const c = dump['submissions/PFA-CG-2026-00016'];
  assert.equal(c.caregiverNo.label, 'MST 2399');
  assert.equal(c.caregiverNo.was, 'MH 2399');
  assert.deepEqual(c.caregiverNoBefore, ['MH 2399']);
  assert.equal(dump['caretakerCards/PFA-CCT-ABCD2345'].caregiverNo, 'MST 2399', 'on the card');
  assert.equal(dump['caretakerPublic/PFA-CCT-ABCD2345'].caregiverNo, 'MST 2399', 'and on the card check');
  assert.equal(dump['member_numbers/PB-1378'].label, 'PNB 1378', 'the register entry, under the same id');
  assert.equal(dump['member_numbers/PB-1201'].label, 'PNB 1201', 'old numbers too');
  assert.equal(dump['member_number_holders/PFA-MEM-2026-00004'].number.label, 'PNB 1378');
  assert.equal(dump['caregiver_number_holders/PFA-CG-2026-00016'].number.label, 'MST 2399');
  assert.equal(dump['counters/memberNumbers'].codesVersion, NUM.CODES_VERSION);

  /* once: a second run reads one record and changes nothing */
  const again = await CASE.applyStateCodes(db, { nowMs: NOV + 60000 });
  assert.equal(again.state, 'already');
  assert.equal(db.dump()['submissions/PFA-MEM-2026-00004'].history.filter((h) => h.event === 'number-relabelled').length, 1);
  /* forced, nothing is left to change */
  const forced = await CASE.applyStateCodes(db, { nowMs: NOV + 120000, force: true });
  assert.deepEqual([forced.members.length, forced.caregivers.length, forced.register], [0, 0, 0]);
});

test('a number given after the change is in the new code from the start; asking again keeps it', async () => {
  await db.collection('counters').doc('memberNumbers').set({ last: { PB: 1385 }, oldVersion: 'none' });
  await db.collection('submissions').doc('PFA-MEM-2026-00030').set({ kind: 'PFA-MEM', status: 'new', receivedAtMs: NOV, fields: { name: 'New member', state: 'Punjab', pin: '147001' } });
  const r = await CASE.giveMemberNumber(db, 'PFA-MEM-2026-00030', { nowMs: NOV, readOld: async () => ({ version: 'none', entries: [] }) });
  assert.equal(r.number.label, 'PNB 1386', 'the Punjab count carries on past PB 1385');
  assert.equal(db.dump()['member_numbers/PB-1386'].label, 'PNB 1386');
});

test('the Google Sheet: State just before the number, and a relabelled number says what it was', () => {
  const L = SHEET._test.layoutOf('membership');
  const h = L.headers;
  assert.equal(h.indexOf('State') + 1, h.indexOf('Member number'), 'State comes just before Member number');
  assert.equal(h.filter((x) => x === 'State').length, 1);
  assert.deepEqual(L.edit.map((i) => h[i]), ['Courier', 'Tracking number', 'Shipped on'], 'the typed columns are still found by name');
  const row = { id: 'PFA-MEM-2026-00004', memberNo: 'PNB 1378', memberNoWas: 'PB 1378', state: 'Punjab', lines: [] };
  const out = SHEET._test.valuesOf('membership', [row, { id: 'PFA-MEM-2026-00005', memberNo: 'TN 4841', memberNoWas: '', state: 'Tamil Nadu', lines: [] }], {});
  const col = h.indexOf('Member number');
  assert.equal(out[1][col], 'PNB 1378 (was PB 1378)');
  assert.equal(out[1][col - 1], 'Punjab');
  assert.equal(out[2][col], 'TN 4841', 'unchanged numbers are just the number');
  const cg = SHEET._test.layoutOf('caregiver');
  const cgOut = SHEET._test.valuesOf('caregiver', [{ id: 'PFA-CG-2026-00016', caregiverNo: 'MST 2399', caregiverNoWas: 'MH 2399', lines: [] }], {});
  assert.equal(cgOut[1][cg.headers.indexOf('Caregiver number')], 'MST 2399 (was MH 2399)');
});

test('wired: before every sheet run, as numbers are caught up, and in the panel', () => {
  assert.match(read('lib/register-sheet.js'), /require\('\.\/routes\/admin\/case'\)\.applyStateCodes\(db, \{ nowMs \}\)/);
  const caseSrc = read('lib/routes/admin/case.js');
  assert.equal((caseSrc.match(/await applyStateCodes\(db, \{ nowMs \}\)/g) || []).length, 2, 'members and caregivers both');
  assert.doesNotMatch(read('lib/member-numbers.js'), /collection\('submissions'\)/, 'the records are written by the case module only');
  const panel = read('assets/admin-registers.js');
  assert.match(panel, /function codesHtml\(st\)/);
  assert.match(panel, /\+ codesHtml\(st\)/);
  assert.match(panel, /'Was ' \+ r\.memberNoWas/);
  assert.match(panel, /'Was ' \+ r\.caregiverNoWas/);
  assert.match(read('lib/routes/admin/registers.js'), /const codes = require\('\.\.\/\.\.\/member-numbers'\)\.directory\(\);/);
  assert.match(read('lib/admin-search.js'), /d\.caregiverNoBefore/);
});
