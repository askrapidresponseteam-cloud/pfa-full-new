'use strict';

/* Member numbers, state by state, never the same twice (owner, 3 Nov 2026:
   "MP and Chhattisgarh go on rotational basis ... how to ensure we do
   enterprise grade numbering- statewise and ensure that no 2 members ever
   get same number, old , new and future"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const NUM = require('../lib/member-numbers');
const CASE = require('../lib/routes/admin/case');
const INDIA = require('../assets/india-districts.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOV = Date.parse('2026-11-03T04:00:00.000Z');

let db;
test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); });
test.afterEach(() => { firebase._setDbForTests(null); });

/* the old site's lists, as the old members page holds them */
const OLD = [
  { person: 'p1', list: 'TN', number: '4788' }, { person: 'p2', list: 'TN', number: '4777' },
  { person: 'p3', list: 'AP TG', number: 'TG 1132' },
  { person: 'p4', list: 'UP UK', number: 'UK 1484' }, { person: 'p5', list: 'UP UK', number: 'UP 1462' },
  { person: 'p6', list: 'Master list', number: 'PUD 001' },
  { person: 'p7', list: 'MP CG', number: '1500' },
  { person: 'p8', list: 'Master list', number: '77' },
  { person: 'p9', list: 'HRY', number: '3068' }, { person: 'p10', list: 'HRY', number: '3068' }
];
const oldList = (entries, version) => async () => ({ version: version || 'IMP-1:0', entries: entries || OLD });

let seq = 0;
async function member(state, pin, ms) {
  seq += 1;
  const id = `PFA-MEM-2026-${String(seq).padStart(5, '0')}`;
  await db.collection('submissions').doc(id).set({ kind: 'PFA-MEM', status: 'new', receivedAtMs: ms || NOV + seq, fields: { name: `Member ${seq}`, state, pin } });
  return id;
}
const numberOf = (id) => (db.dump()[`submissions/${id}`].memberNo || {}).label;

test('every state on the forms has a series; AP and TG, UP and UK, MP and CG each share one', () => {
  for (const s of INDIA.STATES) assert.ok(NUM.placeOf(s), `${s} has a series`);
  const series = (s) => NUM.placeOf(s).series;
  assert.equal(series('Madhya Pradesh'), series('Chhattisgarh'));
  assert.equal(series('Andhra Pradesh'), series('Telangana'));
  assert.equal(series('Uttar Pradesh'), series('Uttarakhand'));
  assert.notEqual(series('Tamil Nadu'), series('Puducherry'));
  assert.deepEqual([NUM.placeOf('Madhya Pradesh').code, NUM.placeOf('Chhattisgarh').code], ['MP', 'CG'], 'each number carries its own state');
  const codes = INDIA.STATES.map((s) => NUM.placeOf(s).code);
  assert.equal(new Set(codes).size, codes.length, 'no two states share a code');
});

test('old numbers are read from their own prefix, or from the list they are on', () => {
  assert.deepEqual(NUM.readOld('TG 1132', 'AP TG'), { series: 'AP-TG', n: 1132, code: 'TG', label: 'TG 1132' });
  assert.deepEqual(NUM.readOld('4788', 'TN'), { series: 'TN', n: 4788, code: 'TN', label: 'TN 4788' });
  assert.deepEqual(NUM.readOld('PUD 001', 'Master list'), { series: 'PUD', n: 1, code: 'PUD', label: 'PUD 1' });
  assert.equal(NUM.readOld('UK 1484', 'UP UK').series, NUM.readOld('UP 1462', 'UP UK').series, 'one count for UP and UK');
  assert.equal(NUM.readOld('3068', 'HRY').series, 'HRY');
  assert.equal(NUM.readOld('ts-0045', 'x').label, 'TG 45');
  assert.match(NUM.readOld('77', 'Master list').problem, /has no state code, and that list is not for one state/);
  assert.match(NUM.readOld('XQ 12', 'TN').problem, /XQ, which is not a state code/);
  assert.match(NUM.readOld('none', 'TN').problem, /not a number/);
});

test('MP and CG take turns from one count, past the old numbers; each state counts past its own', async () => {
  const mp1 = await member('Madhya Pradesh', '462001');
  const cg1 = await member('Chhattisgarh', '492001');
  const mp2 = await member('Madhya Pradesh', '452001');
  const tn = await member('Tamil Nadu', '600001');
  const tg = await member('Telangana', '500001');
  const uk = await member('Uttarakhand', '248001');
  const ka = await member('Karnataka', '560001');
  const r = await CASE.numberWaitingMembers(db, { readOld: oldList() });
  assert.equal(r.numbered.length, 7);
  assert.deepEqual([mp1, cg1, mp2].map(numberOf), ['MP 1501', 'CG 1502', 'MP 1503'], 'one running count, each with its own code');
  assert.equal(numberOf(tn), 'TN 4789', 'past the highest old TN number');
  assert.equal(numberOf(tg), 'TG 1133');
  assert.equal(numberOf(uk), 'UK 1485', 'UP and UK share the count past UK 1484');
  assert.equal(numberOf(ka), 'KA 1', 'a state with no old numbers starts at 1');
  /* every number is in the register once; old ones first */
  const dump = db.dump();
  const register = Object.keys(dump).filter((k) => k.startsWith('member_numbers/'));
  assert.ok(register.includes('member_numbers/TN-4788') && register.includes('member_numbers/MP-CG-1500'));
  assert.equal(dump['member_numbers/MP-CG-1502'].kind, 'new');
  assert.equal(dump['member_numbers/MP-CG-1502'].holder, cg1);
  assert.equal(dump['member_numbers/TN-4788'].kind, 'old');
  assert.doesNotMatch(JSON.stringify(dump['member_numbers/TN-4788']), /p1|Member/, 'no one from the old list is named in the register');
  /* the history says when */
  assert.ok(dump[`submissions/${mp1}`].history.some((h) => h.event === 'member-number' && h.number === 'MP 1501'));
});

test('what the old lists leave for PFA: no state, one number held by two people', async () => {
  await member('Tamil Nadu', '600001');
  await CASE.numberWaitingMembers(db, { readOld: oldList() });
  const st = await NUM.status(db);
  assert.equal(st.oldReport.unplacedCount, 1);
  assert.match(st.oldReport.unplaced[0].why, /"77" \(Master list\)/);
  assert.deepEqual(st.oldReport.sharedByTwo, [{ label: 'HRY 3068', people: 2 }]);
  assert.equal(st.series.find((s) => s.series === 'MP-CG').next, 1501);
  assert.deepEqual(st.series.find((s) => s.series === 'MP-CG').states.map((s) => s.code), ['CG', 'MP']);
});

test('a membership with no state, or a PIN not in its state, is held, not numbered, until put right', async () => {
  const wrongPin = await member('Karnataka', '400001');
  const noState = await member('', '560001');
  const r = await CASE.numberWaitingMembers(db, { readOld: oldList() });
  assert.deepEqual(r.numbered, []);
  assert.match(r.held.find((x) => x.reference === wrongPin).reason, /PIN code 400001 is not in Karnataka/);
  assert.match(r.held.find((x) => x.reference === noState).reason, /No state on the membership/);
  assert.match(db.dump()[`submissions/${wrongPin}`].memberNumberHold.reason, /not in Karnataka/);
  /* put right: numbered on the next run, and the hold cleared */
  await db.collection('submissions').doc(wrongPin).set({ fields: { state: 'Maharashtra', pin: '400001' } }, { merge: true });
  const again = await CASE.numberWaitingMembers(db, { readOld: oldList() });
  assert.deepEqual(again.numbered.map((x) => x.number), ['MH 1']);
  assert.equal(db.dump()[`submissions/${wrongPin}`].memberNumberHold, null);
});

test('many joining in the same moment: every one a different number; asking again changes nothing', async () => {
  const ids = [];
  for (let i = 0; i < 15; i += 1) ids.push(await member(i % 2 ? 'Chhattisgarh' : 'Madhya Pradesh', i % 2 ? '492001' : '462001'));
  const got = await Promise.all(ids.map((id) => CASE.giveMemberNumber(db, id, { readOld: oldList() })));
  const labels = got.map((g) => g.number.label);
  const ns = got.map((g) => g.number.n).sort((a, b) => a - b);
  assert.equal(new Set(ns).size, 15, 'fifteen different numbers in the shared series');
  assert.deepEqual(ns, Array.from({ length: 15 }, (_, i) => 1501 + i), 'no gaps, none reused');
  labels.forEach((l, i) => assert.ok(l.startsWith(i % 2 ? 'CG ' : 'MP '), l));
  const again = await Promise.all(ids.map((id) => CASE.giveMemberNumber(db, id, { readOld: oldList() })));
  assert.deepEqual(again.map((g) => g.number.label), labels);
  assert.ok(again.every((g) => g.already));
  assert.equal(Object.keys(db.dump()).filter((k) => /^member_number_holders\//.test(k)).length, 15, 'one number per membership');
});

test('a number already taken is never given again, even if the count were behind', async () => {
  const a = await member('Tamil Nadu', '600001');
  await CASE.giveMemberNumber(db, a, { readOld: oldList() });
  assert.equal(numberOf(a), 'TN 4789');
  /* the count put back by hand, by mistake */
  await db.collection('counters').doc('memberNumbers').set({ last: { TN: 4700 } }, { merge: true });
  await db.collection('member_numbers').doc('TN-4701').set({ series: 'TN', n: 4701, kind: 'old' });
  const b = await member('Tamil Nadu', '600001');
  await CASE.giveMemberNumber(db, b, { readOld: oldList() });
  assert.equal(numberOf(b), 'TN 4702', 'steps past the taken TN 4701');
  /* and the old TN 4777 and 4788 are still never given: */
  const all = [];
  for (let i = 0; i < 90; i += 1) { const id = await member('Tamil Nadu', '600001'); all.push((await CASE.giveMemberNumber(db, id, { readOld: oldList() })).number.label); }
  assert.ok(!all.includes('TN 4777') && !all.includes('TN 4788') && !all.includes('TN 4789'), 'old and given numbers skipped');
  assert.equal(new Set(all).size, all.length);
});

test('the old list changed later: new old numbers are held at once; one a new member already has is reported, and the new member keeps it', async () => {
  const a = await member('Tamil Nadu', '600001');
  await CASE.giveMemberNumber(db, a, { readOld: oldList() });
  assert.equal(numberOf(a), 'TN 4789');
  const later = OLD.concat([{ person: 'p11', list: 'TN', number: '4789' }, { person: 'p12', list: 'TN', number: '5000' }]);
  const b = await member('Tamil Nadu', '600001');
  await CASE.giveMemberNumber(db, b, { readOld: oldList(later, 'IMP-2:0') });
  assert.equal(numberOf(b), 'TN 5001', 'past the new highest old number');
  assert.equal(numberOf(a), 'TN 4789', 'the new member keeps theirs');
  const st = await NUM.status(db);
  assert.deepEqual(st.oldReport.takenByNew, [{ label: 'TN 4789', reference: a }]);
  assert.equal(st.oldVersion, 'IMP-2:0');
});

test('with no old list imported, numbers still start at 1 and nothing breaks', async () => {
  const a = await member('Goa', '403001');
  const r = await CASE.giveMemberNumber(db, a, { nowMs: NOV });
  assert.equal(r.number.label, 'GA 1');
  assert.equal((await NUM.status(db)).oldVersion, 'none');
});

test('wired: given at payment, on the card, in the letters and the register; caught up every run', () => {
  const pay = read('lib/routes/payment/response.js');
  assert.match(pay, /require\('\.\.\/admin\/case'\)\.giveMemberNumber\(getDb\(\), applicationRef\)/);
  assert.match(read('lib/membership-card.js'), /cardId: memberNoOf\(data\) \|\| reference,/);
  assert.match(read('lib/routes/admin/membership.js'), /const numbered = await CASE\.giveMemberNumber\(db, reference, \{ by \}\);/);
  assert.match(read('lib/routes/caregiver/email-worker.js'), /require\('\.\.\/admin\/case'\)\.numberWaitingMembers\(getDb\(\), \{ limit: 25 \}\)/);
  assert.match(read('lib/routes/admin/registers.js'), /\['Member number', 'memberNo'\], \['Membership reference', 'id'\]/);
  assert.match(read('assets/admin-registers.js'), /\['Member number', function \(r\)/);
  /* the record is written only by the case module, as every submission write is */
  assert.doesNotMatch(read('lib/member-numbers.js'), /collection\('submissions'\)/);
});

/* owner, 3 Nov 2026: "still dont see the membership number issue sorted" */
test('members held for their state never keep the others waiting; a failure is said on the record', async () => {
  for (let i = 0; i < 30; i += 1) await member('', '', NOV - 100000 + i);
  const ready = await member('Karnataka', '576102');
  const r = await CASE.numberWaitingMembers(db, { readOld: oldList(), limit: 25 });
  assert.equal(numberOf(ready), 'KA 1', 'numbered, though thirty held members joined before');
  assert.equal(r.numbered.length, 1);
  assert.equal(r.held.length, 25);
  /* a number that cannot be given just now: the reason is on the record for the panel */
  const tn = await member('Tamil Nadu', '600037');
  const broken = async () => { throw new Error('The old list could not be read'); };
  const r2 = await CASE.numberWaitingMembers(db, { readOld: broken, limit: 5 });
  assert.equal(r2.failed.length, 1);
  assert.match(db.dump()[`submissions/${tn}`].memberNumberHold.reason, /^Not given yet: The old list could not be read/);
  /* put right, it is numbered and the hold is cleared */
  await CASE.numberWaitingMembers(db, { readOld: oldList() });
  assert.equal(numberOf(tn), 'TN 4789');
  assert.equal(db.dump()[`submissions/${tn}`].memberNumberHold, null);
});

test('opening the membership register numbers whoever is waiting, and says so', async () => {
  const OLDMEM = require('../lib/routes/admin/old-members')._private;
  const realStanding = OLDMEM.standing;
  OLDMEM.standing = async () => null;
  try {
    const a = await member('Madhya Pradesh', '462001');
    const b = await member('', '');
    const ROUTE = require('../lib/routes/admin/registers');
    const handler = ROUTE.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u', email: 'k@pfa.test', role: 'super' }), now: () => NOV + 3600000 });
    const out = await new Promise((resolve, reject) => {
      const o = { status: 200, headers: {} };
      const response = { set statusCode(v) { o.status = v; }, get statusCode() { return o.status; }, setHeader(k, v) { o.headers[k] = v; }, end(raw) { o.json = JSON.parse(String(raw)); resolve(o); } };
      Promise.resolve(handler({ method: 'GET', url: '/api/admin/registers?kind=membership', query: { kind: 'membership' }, headers: {} }, response)).catch(reject);
    });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.deepEqual(out.json.numbering.numbered, [{ reference: a, number: 'MP 1' }]);
    assert.equal(out.json.rows.find((r) => r.id === a).memberNo, 'MP 1', 'on the list the panel draws');
    assert.match(out.json.rows.find((r) => r.id === b).numberHold, /No state on the membership/);
    assert.equal(db.dump()[`submissions/${a}`].memberNo.by, undefined);
    assert.match(JSON.stringify(db.dump()[`submissions/${a}`].history), /"by":"admin:k@pfa\.test"/);
  } finally { OLDMEM.standing = realStanding; }
  const js = read('assets/admin-registers.js');
  assert.match(js, /members numbered just now: /);
  assert.match(js, /could not be numbered: /);
  assert.doesNotMatch(js, /waiting for the next run/);
});
