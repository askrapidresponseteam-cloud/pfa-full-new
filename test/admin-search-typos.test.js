'use strict';

/* The panel's search forgives one wrong letter (owner, 21 Oct 2026: "there
   should be a google grade global search"). A word typed with a letter
   missing, added, changed or two swapped still finds the record, through
   one extra query on the same index, and only when nothing matched as
   typed. Driven through the real route against the in-memory Firestore. */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');
const SEARCH = require('../lib/admin-search');
const ROUTE = () => require('../lib/routes/admin/search');
const { Timestamp } = require('firebase-admin/firestore');

let W;
test.beforeEach(() => { W = H.fresh({ latency: 0 }); SEARCH._reset(); ROUTE()._private.resetPeople(); });
test.afterEach(() => { W.restore(); });

const find = async (q) => {
  const res = await H.call(ROUTE(), { method: 'GET', query: { q }, token: 'tok-a' });
  assert.equal(res.statusCode, 200, res.raw);
  return res.json;
};
const ids = (out) => out.results.map((r) => r.id);

async function world(db) {
  await H.seed(db, 'PFA-V-2026-00011', {
    kind: 'PFA-V', kindLabel: 'Volunteer application', receivedAtMs: Date.parse('2026-10-20T05:00:00Z'),
    fields: { name: 'Karthik Dhanya', email: 'karthik.dhanya11@gmail.com', mobile: '9876500011', city: 'Udupi', about: 'I feed fifty dogs every day.' }
  });
  await H.seed(db, 'PFA-Q-2026-00012', {
    kind: 'PFA-Q', receivedAtMs: Date.parse('2026-10-19T05:00:00Z'),
    fields: { question: 'Where can I adopt a puppy?', name: 'Meera Nair', email: 'meera@example.com', city: 'Bengaluru' }
  });
  await db.collection('transactions').doc('PFA-DON-AB12CD99').set({
    orderId: 'PFA-DON-AB12CD99', type: 'donate', status: 'success', amount: 1500, currency: 'INR',
    customer: { name: 'Priyanka Sharma', email: 'priyanka@example.com', mobile: '9900112299' },
    createdAt: Timestamp.fromMillis(Date.parse('2026-10-18T05:00:00Z')), updatedAt: Timestamp.fromMillis(Date.parse('2026-10-18T05:01:00Z'))
  });
}

test('one wrong letter still finds the person: missing, extra, changed or swapped', async () => {
  await world(W.db);
  for (const q of ['karthk', 'karthikk', 'karthek', 'kartihk', 'dhanyaa', 'udpi', 'priyanaka', 'sharam']) {
    const out = await find(q);
    assert.ok(out.results.length >= 1, `${q} finds something`);
    assert.equal(out.near, true, `${q}: said to be a close match`);
  }
  assert.deepEqual(ids(await find('karthk')), ['PFA-V-2026-00011']);
  assert.deepEqual(ids(await find('priyanaka')), ['PFA-DON-AB12CD99'], 'payments too');
  assert.deepEqual(ids(await find('meeera bengaluru')), ['PFA-Q-2026-00012'], 'two words, one of them off');
});

test('an exact match is never mixed with guesses, and nonsense finds nothing', async () => {
  await world(W.db);
  const exact = await find('karthik');
  assert.deepEqual(ids(exact), ['PFA-V-2026-00011']);
  assert.equal(exact.near, false);
  assert.deepEqual(ids(await find('zzqxw')), []);
  assert.deepEqual(ids(await find('karthk nair')), [], 'every word must still fit the same record');
  assert.deepEqual(ids(await find('rakesh')), [], 'a name nobody has finds nothing');
});

test('the one-letter rule itself', () => {
  for (const [a, b] of [['karthik', 'karthk'], ['karthik', 'kartihk'], ['karthik', 'karthek'], ['karthik', 'karthiik']]) assert.ok(SEARCH.oneOff(a, b), `${a} ~ ${b}`);
  for (const [a, b] of [['karthik', 'kartk'], ['meera', 'mohan'], ['asha', 'ashaxx']]) assert.ok(!SEARCH.oneOff(a, b), `${a} !~ ${b}`);
  assert.deepEqual(SEARCH.nearKeys('abc'), [], 'three letters or fewer: not guessed');
  assert.equal(SEARCH.nearKeys('karthik').length, 8, 'the word and its seven one-letter drops');
});
