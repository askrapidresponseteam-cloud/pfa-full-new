'use strict';

/* The panel's one search box, the server side (owner, 8 Oct 2026: "there
   needs to be a univeral/global search bar to search anything and
   everything", and: costs must stay low).

   Driven through the real route and the real index builder, against the
   strict in-memory Firestore, with sign-in stubbed: what can be found (by
   name, part of a name, email, mobile however it is typed, reference, part
   of a reference, a word in the report, a word in a reply or a note, Hindi),
   who may see what, freshness (a case filed a moment ago, a status changed a
   moment ago), newest first, and what one search costs in reads. */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');

const SEARCH = require('../lib/admin-search');
const ROUTE = () => require('../lib/routes/admin/search');
const CASE = () => require('../lib/routes/admin/case');
const { Timestamp } = require('firebase-admin/firestore');

let W;
test.beforeEach(() => { W = H.fresh({ latency: 0 }); SEARCH._reset(); require('../lib/routes/admin/search')._private.resetPeople(); });
test.afterEach(() => { W.restore(); });

const find = async (q, token = 'tok-a') => {
  const res = await H.call(ROUTE(), { method: 'GET', query: { q }, token });
  assert.equal(res.statusCode, 200, res.raw);
  return res.json;
};
const ids = (out) => out.results.map((r) => `${r.type}:${r.id}`);

async function world(db) {
  await H.seed(db, 'PFA-C-2026-00007', {
    kind: 'PFA-C', kindLabel: 'Cruelty report', receivedAtMs: Date.parse('2026-10-07T05:00:00Z'),
    fields: { what: 'A kite string caught round a pigeon on the water tank. Ambulance needed.', accused: 'Not known', location: 'Lajpat Nagar, New Delhi', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', note: 'कुत्ता घायल है' }
  });
  await db.collection('submissions').doc('PFA-C-2026-00007').collection('messages').doc('n1')
    .set({ id: 'n1', type: 'note', text: 'Called the Lajpat Nagar unit; the volunteer Imran is on his way.', by: 'desk@pfa.test', at: '2026-10-07T06:00:00.000Z', seq: 1 });
  await H.seed(db, 'PFA-Q-2026-00003', {
    kind: 'PFA-Q', receivedAtMs: Date.parse('2026-10-06T05:00:00Z'),
    fields: { question: 'Where can I adopt a puppy?', name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9811122333' }
  });
  await db.collection('transactions').doc('PFA-DON-AB12CD34').set({
    orderId: 'PFA-DON-AB12CD34', type: 'donate', status: 'success', amount: 2500, currency: 'INR',
    customer: { name: 'Meera Shah', email: 'meera@example.com', mobile: '9900112233' },
    ccaVenue: { trackingId: '310000000123', bankReference: 'BRN777' }, metadata: { purpose: 'Cow shelter' },
    createdAt: Timestamp.fromMillis(Date.parse('2026-10-05T05:00:00Z')), updatedAt: Timestamp.fromMillis(Date.parse('2026-10-05T05:01:00Z'))
  });
  await db.collection('caretakerCards').doc('PFA-CCT-4K2M8QRT').set({
    cardId: 'PFA-CCT-4K2M8QRT', name: 'Sunita Devi', mobile: '9123456780', district: 'Udupi', state: 'Karnataka',
    createdAt: Timestamp.fromMillis(Date.parse('2026-10-04T05:00:00Z')), updatedAt: Timestamp.fromMillis(Date.parse('2026-10-04T05:00:00Z'))
  });
  await db.collection('caregiverEmails').doc('submission_forward_x').set({
    template: 'submission_forward', to: 'gandhim@exmpls.sansad.in', status: 'retry', payload: { reference: 'PFA-Q-2026-00003' },
    lastError: 'Invalid login: 535 Authentication Failed',
    createdAt: Timestamp.fromMillis(Date.parse('2026-10-06T05:00:01Z')), updatedAt: Timestamp.fromMillis(Date.parse('2026-10-06T05:00:02Z'))
  });
  await db.collection('adminAudit').doc('001790000000000-abc').set({
    at: '2026-10-07T07:00:00.000Z', atMs: Date.parse('2026-10-07T07:00:00Z'), actor: { email: 'desk@pfa.test', name: 'Desk' },
    module: 'submissions', action: 'status', subject: 'PFA-C-2026-00007', detail: 'new to in-progress', outcome: 'done'
  });
}

test('everything is found: names, part of a name, email, mobile however typed, references, ids', async () => {
  await world(W.db);
  assert.ok(ids(await find('asha')).includes('case:PFA-C-2026-00007'), 'a first name');
  assert.ok(ids(await find('Asha Rao')).includes('case:PFA-C-2026-00007'), 'a full name');
  assert.ok(ids(await find('ash')).includes('case:PFA-C-2026-00007'), 'a name still being typed');
  assert.ok(ids(await find('asha@example.com')).includes('case:PFA-C-2026-00007'), 'an email');
  for (const m of ['9876543210', '+91 98765 43210', '098765-43210', '98765', '43210']) {
    assert.ok(ids(await find(m)).includes('case:PFA-C-2026-00007'), `a mobile typed as ${m}`);
  }
  assert.deepEqual(ids(await find('PFA-C-2026-00007')).slice(0, 1), ['case:PFA-C-2026-00007'], 'a reference, first');
  assert.ok(ids(await find('pfa-c-2026-000')).includes('case:PFA-C-2026-00007'), 'part of a reference');
  assert.ok(ids(await find('00007')).includes('case:PFA-C-2026-00007'), 'its number');
  assert.ok(ids(await find('PFA-DON-AB12CD34')).includes('payment:PFA-DON-AB12CD34'), 'an order');
  assert.ok(ids(await find('BRN777')).includes('payment:PFA-DON-AB12CD34'), 'a bank reference');
  assert.ok(ids(await find('meera')).includes('payment:PFA-DON-AB12CD34'), 'a donor');
  assert.ok(ids(await find('sunita')).includes('card:PFA-CCT-4K2M8QRT'), 'a card holder');
  assert.ok(ids(await find('PFA-CCT-4K2M')).includes('card:PFA-CCT-4K2M8QRT'), 'part of a card number');
  assert.ok(ids(await find('gandhim')).includes('email:submission_forward_x'), 'an email the site sent');
  assert.ok(ids(await find('desk@pfa.test')).includes('audit:001790000000000-abc'), 'the audit log, by who');
});

test('and anything written: the report, a note in the conversation, Hindi', async () => {
  await world(W.db);
  assert.ok(ids(await find('kite')).includes('case:PFA-C-2026-00007'), 'a word in the report');
  assert.ok(ids(await find('pigeon water tank')).includes('case:PFA-C-2026-00007'), 'several words');
  assert.ok(ids(await find('imran')).includes('case:PFA-C-2026-00007'), 'a word in a note');
  assert.ok(ids(await find('Lajpat Nagar')).includes('case:PFA-C-2026-00007'), 'a place');
  assert.ok(ids(await find('कुत्ता')).includes('case:PFA-C-2026-00007'), 'Hindi');
  assert.deepEqual(ids(await find('elephant')), [], 'a word nowhere finds nothing');
  assert.deepEqual(ids(await find('kite puppy')), [], 'every word must match');
});

test('each person sees only what their account opens', async () => {
  await world(W.db);
  const desk = await find('example.com', 'tok-desk');      // overview, submissions, verify
  assert.ok(ids(desk).includes('case:PFA-C-2026-00007'));
  assert.ok(!ids(desk).some((x) => x.startsWith('payment:')), 'no payments without Payments');
  assert.ok(!ids(await find('sunita', 'tok-desk')).length, 'no cards without Colony cards');
  assert.ok(!ids(await find('desk@pfa.test', 'tok-desk')).some((x) => x.startsWith('audit:')), 'no audit log without People');
  assert.ok(ids(await find('meera', 'tok-a')).includes('payment:PFA-DON-AB12CD34'), 'a super administrator sees payments');
  const none = await H.call(ROUTE(), { method: 'GET', query: { q: 'asha' }, token: null });
  assert.equal(none.statusCode, 401, 'and nobody signed out sees anything');
});

test('a case filed a moment ago is found by its number at once, and by name within the minute', async () => {
  await world(W.db);
  await find('asha');   // the index is now fresh
  await H.seed(W.db, 'PFA-Q-2026-00009', { kind: 'PFA-Q', receivedAtMs: Date.now(), fields: { name: 'Zoya Khan', email: 'zoya@example.com', question: 'Stray cat' } });
  assert.ok(ids(await find('PFA-Q-2026-00009')).includes('case:PFA-Q-2026-00009'), 'by number, before the index has it');
  await W.db.collection('adminSearchMeta').doc('state').update({ syncedAt: Date.now() - 61000 });
  assert.ok(ids(await find('zoya')).includes('case:PFA-Q-2026-00009'), 'by name once the index is a minute old');
});

test('a status changed in the panel shows in the search', async () => {
  await world(W.db);
  assert.equal((await find('PFA-Q-2026-00003')).results[0].status, 'Waiting');
  const moved = await H.call(CASE(), { body: { reference: 'PFA-Q-2026-00003', action: 'status', status: 'handled', note: 'Sent the adoption page' } });
  assert.equal(moved.statusCode, 200, moved.raw);
  await W.db.collection('adminSearchMeta').doc('state').update({ syncedAt: 0 });
  const after = (await find('ravi')).results.find((r) => r.id === 'PFA-Q-2026-00003');
  assert.equal(after.status, 'Handled');
});

test('newest first', async () => {
  for (let i = 1; i <= 5; i += 1) {
    await H.seed(W.db, `PFA-Q-2026-0000${i}`, { kind: 'PFA-Q', receivedAtMs: Date.parse(`2026-10-0${i}T05:00:00Z`), fields: { name: 'Asha Rao', question: `question ${i}` } });
  }
  assert.deepEqual((await find('asha')).results.map((r) => r.id), ['PFA-Q-2026-00005', 'PFA-Q-2026-00004', 'PFA-Q-2026-00003', 'PFA-Q-2026-00002', 'PFA-Q-2026-00001']);
});

/* Counts every document a query returns (one for an empty answer), the way
   Firestore bills reads. */
function counting(db) {
  const tally = { reads: 0 };
  const wrap = (obj) => new Proxy(obj, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const out = value.apply(target, args);
        if (prop === 'get' && out && typeof out.then === 'function') {
          return out.then((r) => { tally.reads += r && Array.isArray(r.docs) ? Math.max(1, r.docs.length) : 1; return r; });
        }
        if (out && typeof out === 'object' && typeof out.then !== 'function' && (typeof out.get === 'function' || typeof out.where === 'function')) return wrap(out);
        return out;
      };
    }
  });
  return { db: wrap(db), tally };
}

test('one search costs a handful of reads, however many records there are', async () => {
  for (let i = 1; i <= 300; i += 1) {
    await H.seed(W.db, `PFA-Q-2026-${String(i).padStart(5, '0')}`, { kind: 'PFA-Q', receivedAtMs: Date.parse('2026-10-01T00:00:00Z') + i * 60000, fields: { name: `Person ${i}`, question: 'A dog near the market' } });
  }
  await H.seed(W.db, 'PFA-Q-2026-00999', { kind: 'PFA-Q', receivedAtMs: Date.parse('2026-10-08T00:00:00Z'), fields: { name: 'Farida Begum', question: 'A dog near the market' } });
  await SEARCH.sync(W.db, { budgetMs: 60000 });
  const { db, tally } = counting(W.db);
  const out = await SEARCH.search(db, 'farida', () => true);
  assert.deepEqual(out.results.map((r) => r.id), ['PFA-Q-2026-00999']);
  assert.ok(tally.reads <= 3, `a search read ${tally.reads} documents`);
  const again = counting(W.db);
  await SEARCH.sync(again.db, { budgetMs: 60000 });
  assert.ok(again.tally.reads <= 12, `a sync with nothing new read ${again.tally.reads}`);
  const wrote = await SEARCH.sync(W.db, { budgetMs: 60000 });
  assert.equal(wrote.written, 0, 'and writes nothing');
});

test('a change in how the index is made rebuilds it from the start; a rebuild needs People', async () => {
  await world(W.db);
  await find('asha');
  const staff = await H.call(ROUTE(), { body: { action: 'rebuild' }, token: 'tok-desk' });
  assert.equal(staff.statusCode, 403);
  const boss = await H.call(ROUTE(), { body: { action: 'rebuild' }, token: 'tok-a' });
  assert.equal(boss.statusCode, 200, boss.raw);
  assert.ok(boss.json.written >= 6, 'every record written again');
  assert.ok(ids(await find('asha')).includes('case:PFA-C-2026-00007'));
});

test('staff accounts are found by name or email, by those who may open People', async () => {
  const handler = require('../lib/routes/admin/search')._private.createHandler({
    getAuth: () => ({ async listUsers() { return { users: [{ uid: 'x', email: 'priya@pfa.test', displayName: 'Priya Nair', customClaims: { admin: true, role: 'staff' } }, { uid: 'y', email: 'visitor@example.com', customClaims: {} }] }; } })
  });
  const res = await H.call(handler, { method: 'GET', query: { q: 'priya' } });
  assert.deepEqual(res.json.results.filter((r) => r.type === 'person').map((r) => r.id), ['priya@pfa.test']);
  const desk = await H.call(handler, { method: 'GET', query: { q: 'priya' }, token: 'tok-desk' });
  assert.deepEqual(desk.json.results.filter((r) => r.type === 'person'), []);
  const visitor = await H.call(handler, { method: 'GET', query: { q: 'visitor' } });
  assert.deepEqual(visitor.json.results.filter((r) => r.type === 'person'), [], 'only panel accounts');
});

test('what is typed becomes the index\'s words', () => {
  assert.deepEqual(SEARCH.tokensOf('+91 98765 43210'), ['9876543210']);
  assert.deepEqual(SEARCH.tokensOf('Asha  RAO'), ['asha', 'rao']);
  assert.deepEqual(SEARCH.tokensOf('PFA-Q-2026-00042'), ['pfa-q-2026-00042']);
  assert.deepEqual(SEARCH.tokensOf('Asha.Rao@Example.com'), ['asha.rao@example.com']);
  assert.deepEqual(SEARCH.tokensOf('Café'), ['cafe']);
});

/* One completed donation, one number (owner, 21 Nov 2026: "for 1 completed
   donation - 1 number only", over a search that showed PFA-DON-2026-00088
   under Other cases and PFA-DON-KRH6J6T7 under Payments for one ₹10 gift). */
test('a paid donation is one result: its case, with the amount, never its payment again', async () => {
  const at = (iso) => Timestamp.fromMillis(Date.parse(iso));
  /* filed since: the case is under the payment's own number */
  await H.seed(W.db, 'PFA-DON-QX7M2K9R', {
    kind: 'PFA-DON', kindLabel: 'Donation', receivedAtMs: Date.parse('2026-11-21T05:00:00Z'),
    fields: { name: 'Nitin Tyagi', email: 'nitin@example.com', mobile: '9811100000', amount: 'INR 10' },
    payment: { orderId: 'PFA-DON-QX7M2K9R', amount: 10, currency: 'inr' }
  });
  await W.db.collection('transactions').doc('PFA-DON-QX7M2K9R').set({
    orderId: 'PFA-DON-QX7M2K9R', type: 'donate', status: 'success', amount: 10, currency: 'INR', donationReference: 'PFA-DON-QX7M2K9R',
    customer: { name: 'Nitin Tyagi', email: 'nitin@example.com' }, createdAt: at('2026-11-21T04:59:00Z'), updatedAt: at('2026-11-21T05:00:00Z')
  });
  /* filed before: two numbers on record, still one result */
  await H.seed(W.db, 'PFA-DON-2026-00088', {
    kind: 'PFA-DON', kindLabel: 'Donation', receivedAtMs: Date.parse('2026-11-20T05:00:00Z'),
    fields: { name: 'Nitin Tyagi', email: 'nitin@example.com', amount: 'INR 10', orderId: 'PFA-DON-KRH6J6T7' },
    payment: { orderId: 'PFA-DON-KRH6J6T7', amount: 10, currency: 'inr' }
  });
  await W.db.collection('transactions').doc('PFA-DON-KRH6J6T7').set({
    orderId: 'PFA-DON-KRH6J6T7', type: 'donate', status: 'success', amount: 10, currency: 'INR', donationReference: 'PFA-DON-2026-00088',
    customer: { name: 'Nitin Tyagi', email: 'nitin@example.com' }, createdAt: at('2026-11-20T04:59:00Z'), updatedAt: at('2026-11-20T05:00:00Z')
  });
  /* pressed Pay and left: no case came of it, so the payment is all there is */
  await W.db.collection('transactions').doc('PFA-DON-ABANDN22').set({
    orderId: 'PFA-DON-ABANDN22', type: 'donate', status: 'initiated', amount: 10, currency: 'INR',
    customer: { name: 'Nitin Tyagi', email: 'nitin@example.com' }, createdAt: at('2026-11-19T04:59:00Z'), updatedAt: at('2026-11-19T04:59:00Z')
  });
  const out = await find('nitin');
  assert.deepEqual(ids(out).sort(), ['case:PFA-DON-2026-00088', 'case:PFA-DON-QX7M2K9R', 'payment:PFA-DON-ABANDN22'], JSON.stringify(ids(out)));
  const line = out.results.find((r) => r.id === 'PFA-DON-QX7M2K9R').line;
  assert.equal(line, 'Donation of ₹10 from Nitin Tyagi');
  /* the number typed in full finds the one case, before the index has it too */
  assert.deepEqual(ids(await find('PFA-DON-QX7M2K9R')), ['case:PFA-DON-QX7M2K9R']);
  assert.deepEqual(ids(await find('PFA-DON-KRH6J6T7')), ['case:PFA-DON-2026-00088'], 'the payment number of an earlier donation finds its case');
});
