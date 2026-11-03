'use strict';

/* The live register went blank with "Those records could not be read" the
   first time a real submission arrived: Firestore refuses a query that
   filters on one field and orders by another until a composite index has
   been built in the console. This fake database refuses the same way, so the
   register can only pass here if it never asks for one. */

const test = require('node:test');
const assert = require('node:assert/strict');

function indexError() {
  const e = new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/...');
  e.code = 9;
  return e;
}

function strictFirestore(collections) {
  function query(name, filters = [], order = null, after = null, max = null) {
    return {
      where(field, op, value) { return query(name, filters.concat([[field, op, value]]), order, after, max); },
      orderBy(field, dir) { return query(name, filters, { field, dir: dir || 'asc' }, after, max); },
      startAfter(value) { return query(name, filters, order, value, max); },
      limit(n) { return query(name, filters, order, after, n); },
      async get() {
        const fields = new Set(filters.map((f) => f[0]));
        if (order && order.field !== '__name__' && (fields.size > 1 || (fields.size === 1 && !fields.has(order.field)))) throw indexError();
        let docs = Object.entries(collections[name] || {}).map(([id, data]) => ({ id, data: () => data, exists: true }));
        filters.forEach(([field, op, value]) => { docs = docs.filter((d) => op === '==' && d.data()[field] === value); });
        if (order) {
          const key = (d) => (order.field === '__name__' ? d.id : d.data()[order.field]);
          docs.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (order.dir === 'desc' ? -1 : 1));
          if (after !== null) docs = docs.filter((d) => (order.dir === 'desc' ? key(d) < after : key(d) > after));
        }
        if (max) docs = docs.slice(0, max);
        return { docs, empty: docs.length === 0, size: docs.length };
      },
      doc(id) {
        return { async get() { const data = (collections[name] || {})[id]; return { exists: Boolean(data), id, data: () => data }; } };
      }
    };
  }
  return { collection: (name) => query(name) };
}

const submissions = {};
for (let i = 1; i <= 60; i += 1) {
  const kind = i % 3 === 0 ? 'PFA-Q' : 'PFA-C';
  submissions[`${kind}-2026-${String(i).padStart(5, '0')}`] = {
    reference: `${kind}-2026-${String(i).padStart(5, '0')}`, kind, status: i % 4 === 0 ? 'handled' : 'new',
    receivedAtMs: 1_700_000_000_000 + i * 1000, createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), fields: { summary: `Case ${i}` }
  };
}
const db = strictFirestore({ submissions, transactions: { 'PFA-DON-1': { status: 'success', amount: 10, type: 'donate' }, 'PFA-DON-2': { status: 'failed', amount: 5, type: 'donate' } } });

/* Load the route with the fake database in place of Firestore. */
const firebase = require('../lib/firebase');
const realGetDb = firebase.getDb;
let current = db;
firebase.getDb = () => current;
const auth = require('../lib/admin-auth');
const realRequire = auth.requireAdmin;
auth.requireAdmin = async () => ({ uid: 'u', email: 'staff@pfa.org', mode: 'firebase' });
delete require.cache[require.resolve('../lib/routes/admin/records')];
const handler = require('../lib/routes/admin/records');
test.after(() => { firebase.getDb = realGetDb; auth.requireAdmin = realRequire; });

async function get(query) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await handler({ method: 'GET', query, headers: {} }, res);
  return res;
}

test('the queue a category opens from the overview reads without a composite index', async () => {
  const res = await get({ type: 'submissions', kind: 'PFA-C', status: 'new', limit: '10' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.rows.length, 10);
  assert.ok(res.body.rows.every((r) => r.kind === 'PFA-C' && r.status === 'new'));
  assert.ok(res.body.rows[0].receivedAtMs > res.body.rows[9].receivedAtMs, 'newest first');
  assert.equal(res.body.done, false);

  /* Paging continues from the cursor and eventually runs out, with every
     matching record seen exactly once. */
  const seen = new Set(res.body.rows.map((r) => r.reference));
  let cursor = res.body.cursor, done = res.body.done;
  while (!done) {
    const next = await get({ type: 'submissions', kind: 'PFA-C', status: 'new', limit: '10', cursor: String(cursor) });
    next.body.rows.forEach((r) => { assert.ok(!seen.has(r.reference), 'no repeats'); seen.add(r.reference); });
    cursor = next.body.cursor; done = next.body.done;
  }
  const expected = Object.values(submissions).filter((s) => s.kind === 'PFA-C' && s.status === 'new').length;
  assert.equal(seen.size, expected);
});

test('status alone, category alone, and no filter all work too', async () => {
  assert.equal((await get({ type: 'submissions', status: 'handled', limit: '50' })).body.rows.length, 15);
  assert.equal((await get({ type: 'submissions', kind: 'PFA-Q', limit: '50' })).body.rows.length, 20);
  const all = await get({ type: 'submissions', limit: '25' });
  assert.equal(all.body.rows.length, 25);
  assert.equal(all.body.done, false);
});

test('a submission is found by its reference, in any case, and a miss says so', async () => {
  const hit = await get({ type: 'submissions', q: ' pfa-c-2026-00001 ' });
  assert.equal(hit.body.rows.length, 1);
  assert.equal(hit.body.rows[0].reference, 'PFA-C-2026-00001');
  const miss = await get({ type: 'submissions', q: 'PFA-C-2026-09999' });
  assert.equal(miss.body.rows.length, 0);
  assert.match(miss.body.message, /No submission carries/);
});

test('a payments filter still orders by document id, which needs no composite index', async () => {
  const res = await get({ type: 'payments', status: 'success', limit: '25' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows.length, 1);
});

test('when Firestore does demand an index elsewhere, the message says where the link is', async () => {
  const broken = strictFirestore({ payments: {} });
  broken.collection = () => ({ where() { return this; }, orderBy() { return this; }, limit() { return this; }, startAfter() { return this; }, async get() { throw indexError(); } });
  current = broken;
  const res = await get({ type: 'members' });
  current = db;
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'INDEX_REQUIRED');
  assert.match(res.body.message, /function logs/);
});

/* ---- payments: every filter at once, no composite index ------------------- */

function ts(ms) { return { toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) }; }
const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 23, 12);
const transactions = {};
const kinds = ['membership', 'donate', 'caregiver', 'send'];
const statuses = ['success', 'success', 'success', 'failed', 'aborted', 'initiated', 'verification_failed'];
for (let i = 0; i < 70; i += 1) {
  transactions[`PFA-T-${String(i).padStart(4, '0')}`] = {
    orderId: `PFA-T-${String(i).padStart(4, '0')}`, type: kinds[i % 4], status: statuses[i % 7], amount: 100 * (i + 1), currency: i % 10 === 9 ? 'USD' : 'INR',
    customer: { name: i % 2 ? 'asha kumar' : 'meena iyer', email: i % 2 ? 'asha@example.com' : 'meena@example.com', mobile: '9876543210' },
    ccaVenue: { trackingId: `TRK${i}`, paymentMode: 'UPI' }, createdAt: ts(NOW - i * DAY), updatedAt: ts(NOW - i * DAY)
  };
}

/* The strict fake compares createdAt via toMillis when a stand-in Timestamp is used. */
function strictWithPayments() {
  const base = strictFirestore({ transactions, submissions: {} });
  const col = base.collection;
  base.collection = (name) => {
    const q = col(name);
    if (name !== 'transactions') return q;
    const wrap = (inner, filters, order, after, max) => ({
      where(field, op, value) { return wrap(inner, filters.concat([[field, op, value]]), order, after, max); },
      orderBy(field, dir) { return wrap(inner, filters, { field, dir: dir || 'asc' }, after, max); },
      startAfter(value) { return wrap(inner, filters, order, value, max); },
      limit(n) { return wrap(inner, filters, order, after, n); },
      async get() {
        const fields = new Set(filters.map((f) => f[0]));
        if (order && fields.size && !(fields.size === 1 && fields.has(order.field))) throw indexError();
        let docs = Object.entries(transactions).map(([id, data]) => ({ id, data: () => data, exists: true }));
        const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : Number(v));
        filters.forEach(([field, op, value]) => {
          docs = docs.filter((d) => { const x = ms(d.data()[field]); const y = ms(value); return op === '>=' ? x >= y : op === '<=' ? x <= y : x === y; });
        });
        if (order) {
          docs.sort((a, b) => (ms(a.data()[order.field]) - ms(b.data()[order.field])) * (order.dir === 'desc' ? -1 : 1));
          if (after !== null && after !== undefined) docs = docs.filter((d) => (order.dir === 'desc' ? ms(d.data()[order.field]) < ms(after) : ms(d.data()[order.field]) > ms(after)));
        }
        if (max) docs = docs.slice(0, max);
        return { docs, empty: !docs.length, size: docs.length };
      }
    });
    return wrap(q, [], null, null, null);
  };
  return base;
}

test('payments: purpose, status, period, amount and search combine, with honest totals for the whole set', async () => {
  current = strictWithPayments();
  const res = await get({ type: 'payments', purpose: 'donate,send', status: 'paid', from: '2026-07-01', to: '2026-08-23', min: '500', limit: '5' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.rows.every((r) => ['donate', 'send'].includes(r.type) && r.status === 'success' && r.amount >= 500));
  assert.ok(res.body.rows[0].createdAt > res.body.rows[4].createdAt, 'newest first');
  const expected = Object.values(transactions).filter((t) => ['donate', 'send'].includes(t.type) && t.status === 'success' && t.amount >= 500 && t.createdAt.toMillis() >= Date.UTC(2026, 6, 1));
  assert.equal(res.body.summary.count, expected.length);
  assert.equal(res.body.summary.paidInr, expected.filter((t) => t.currency !== 'USD').reduce((s, t) => s + t.amount, 0));
  assert.equal(res.body.rows.length, 5);
  assert.equal(res.body.done, false);
  /* the next page continues from the cursor and never repeats */
  const seen = new Set(res.body.rows.map((r) => r.orderId));
  const next = await get({ type: 'payments', purpose: 'donate,send', status: 'paid', from: '2026-07-01', to: '2026-08-23', min: '500', limit: '5', cursor: String(res.body.cursor) });
  next.body.rows.forEach((r) => assert.ok(!seen.has(r.orderId)));
  assert.equal(next.body.summary, null, 'the summary is computed once, on the first page');

  const search = await get({ type: 'payments', q: 'TRK7', period: 'all' });
  assert.ok(search.body.rows.length >= 1 && search.body.rows.every((r) => r.trackingId.includes('TRK7')));
  const status = await get({ type: 'payments', status: 'abandoned,failed', limit: '50' });
  assert.ok(status.body.rows.length > 0 && status.body.rows.every((r) => ['aborted', 'cancelled', 'failed'].includes(r.status)));
  const usd = await get({ type: 'payments', currency: 'USD', limit: '50' });
  assert.ok(usd.body.rows.length > 0 && usd.body.rows.every((r) => r.currency === 'USD'));
});

test('payments: sorting by amount pages by offset and a CSV export carries the filtered set', async () => {
  current = strictWithPayments();
  const byAmount = await get({ type: 'payments', sort: 'amount-desc', limit: '10' });
  assert.ok(byAmount.body.rows[0].amount >= byAmount.body.rows[9].amount);
  assert.equal(byAmount.body.offset, 10);
  const page2 = await get({ type: 'payments', sort: 'amount-desc', limit: '10', offset: '10' });
  assert.ok(page2.body.rows[0].amount <= byAmount.body.rows[9].amount);

  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: 'GET', query: { type: 'payments', format: 'csv', purpose: 'membership', status: 'paid' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.headers['Content-Disposition'], /pfa-payments-\d{4}-\d{2}-\d{2}\.csv/);
  const lines = res.body.replace(/^\ufeff/, '').trim().split('\n');
  assert.equal(lines[0], 'orderId,createdAt,type,status,amount,currency,name,email,mobile,paymentMode,trackingId,bankReference,memberId,cardId,failureMessage');
  const want = Object.values(transactions).filter((t) => t.type === 'membership' && t.status === 'success').length;
  assert.equal(lines.length - 1, want);
  assert.ok(lines[1].includes(',membership,success,'));
  current = db;
});

/* owner, 3 Nov 2026: "this needs to have filter by month, and date range".
   A month and a day are India's: midnight IST, not UTC. */
test('payments: by month and by a date range, India time; the dates the wrong way round still mean the range', async () => {
  current = strictWithPayments();
  const late = 'PFA-T-IST1';
  /* 00:30 on 1 August in India is 19:00 on 31 July in UTC */
  transactions[late] = Object.assign({}, transactions['PFA-T-0000'], { orderId: late, createdAt: ts(Date.UTC(2026, 6, 31, 19)), updatedAt: ts(Date.UTC(2026, 6, 31, 19)) });
  try {
    const aug = await get({ type: 'payments', month: '2026-08', limit: '100' });
    assert.equal(aug.statusCode, 200, JSON.stringify(aug.body));
    const augIds = aug.body.rows.map((r) => r.orderId);
    assert.ok(augIds.includes(late), 'a payment at 00:30 IST on 1 August is in August');
    assert.equal(aug.body.summary.count, 23 + 1, 'every day of August to the 23rd, and the one just after midnight');
    const jul = await get({ type: 'payments', month: '2026-07', limit: '100' });
    assert.ok(!jul.body.rows.some((r) => r.orderId === late), 'and not in July');
    assert.equal(jul.body.summary.count, 31);
    const range = await get({ type: 'payments', from: '2026-08-01', to: '2026-08-05', limit: '100' });
    assert.equal(range.body.summary.count, 5 + 1);
    const back = await get({ type: 'payments', from: '2026-08-05', to: '2026-08-01', limit: '100' });
    assert.equal(back.body.summary.count, range.body.summary.count, 'from and to swapped: the same range');
    const one = await get({ type: 'payments', from: '2026-08-10', to: '2026-08-10', limit: '100' });
    assert.equal(one.body.summary.count, 1, 'one day');
    assert.equal((await get({ type: 'payments', month: '2026-13', limit: '100' })).body.summary.count, Object.keys(transactions).length, 'a month that is not one is no filter');
  } finally { delete transactions[late]; }
});

test('the panel: Any time, the last twelve months, or Choose dates, which shows the two dates only when chosen', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /<select id="payWhen" aria-label="When"><option value="">Any time<\/option><\/select>/);
  assert.match(html, /<span id="payRange" hidden><input type="date" id="payFrom" aria-label="From"> <input type="date" id="payTo" aria-label="To"><\/span>/);
  assert.match(html, /if \(\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(when\)\) url \+= '&month=' \+ when;/);
  assert.match(html, /for \(var i = 0; i < 12; i \+= 1\)/);
  assert.match(html, /a\.download = 'pfa-payments' \+ \(payWhenLabel\(\) \? '-' \+ payWhenLabel\(\) : ''\) \+ '\.csv';/, 'the file says which period');
});
