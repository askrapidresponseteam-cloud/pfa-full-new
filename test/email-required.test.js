'use strict';

/* No submission and no payment without an email (owner, 16 Sep 2026): it is
   how PFA keeps track of who sent what, and where every confirmation goes.
   Held on the page, which asks for it, and on the server, which refuses a
   request without it however the request was made. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const S = require('../lib/submissions');
const payment = require('../lib/payment');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { FORMS } = require('../scripts/check-emails.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every public form asks for an email, required, and never calls it optional', () => {
  const fields = [['report.html', 'email'], ['ask.html', 'email'], ['careers.html', 'email'], ['wall.html', 'wallEmail'],
    ['events.html', 'evEmail'], ['cinekind.html', 'ckEmail'], ['get-involved.html', 'volEmail'], ['get-involved.html', 'memEmail'],
    ['get-involved.html', 'cgEmail'], ['donate.html', 'gEmail']];
  for (const [page, id] of fields) {
    const html = read(page);
    const input = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html);
    assert.ok(input, `${page} has no #${id}`);
    assert.match(input[0], /type="email"/, `${page}#${id} is not an email field`);
    assert.match(input[0], /\srequired[\s>]/, `${page}#${id} is not required`);
    const label = new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
    assert.ok(label, `${page}#${id} has no label`);
    assert.doesNotMatch(label[1], /optional|\(or /i, `${page}#${id}: the label still says the email is optional`);
  }
});

function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(key(c, id))) { const e = new Error('exists'); e.code = 6; throw e; } store.set(key(c, id), Object.assign({}, data)); },
    async set(data, opts) { store.set(key(c, id), Object.assign({}, (opts && opts.merge && store.get(key(c, id))) || {}, data)); },
    async update(data) { store.set(key(c, id), Object.assign({}, store.get(key(c, id)), data)); }
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), create: (r, d) => r.create(d), update: (r, d) => r.update(d) }); }
  };
}
function post(handler, body) {
  const req = new EventEmitter();
  req.method = 'POST'; req.query = {}; req.headers = { host: 'peopleforanimalsindia.org' };
  process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  const res = { statusCode: 200, setHeader() {}, end(b) { this.body = JSON.parse(b || '{}'); } };
  return handler(req, res).then(() => res);
}

test('every kind of submission the server knows is refused without an email, and nothing is filed', async () => {
  const perKind = Object.fromEntries(FORMS.map(([, , kind, fields]) => [kind, fields]));
  for (const kind of Object.keys(S.KIND_LABELS)) {
    S.resetForTests();
    if (S.PAID_KINDS.has(kind)) {
      /* only a settled payment files these; the public intake refuses them outright */
      const db = fakeDb();
      const handler = createHandler({ getDb: () => db, deliver: async () => ({}), isConfigured: () => false, now: () => Date.UTC(2026, 8, 16) });
      const refused = await post(handler, { kind, data: { name: 'Asha Rao', email: 'asha@example.com' } });
      assert.equal(refused.statusCode, 400, `${kind} must not be filed from the public API`);
      assert.equal([...db.store.keys()].filter((k) => k.startsWith('submissions/')).length, 0);
      continue;
    }
    const db = fakeDb();
    const handler = createHandler({ getDb: () => db, deliver: async () => ({}), isConfigured: () => false, now: () => Date.UTC(2026, 8, 16) });
    const fields = Object.assign({ name: 'Asha Rao', mobile: '9876543210', summary: 'A dog needs help' }, perKind[kind] || {});
    const refused = await post(handler, { kind, data: fields });
    assert.ok(refused.statusCode === 422 || refused.statusCode === 400, `${kind} was filed without an email (${refused.statusCode})`);
    assert.ok((refused.body.fields || []).some((f) => f.field === 'email'), `${kind} was refused, but not for the missing email: ${JSON.stringify(refused.body)}`);
    assert.equal([...db.store.keys()].filter((k) => k.startsWith('submissions/')).length, 0, `${kind}: a record was filed anyway`);
    const filed = await post(handler, { kind, data: Object.assign({ email: 'asha@example.com' }, fields) });
    assert.equal(filed.statusCode, 200, `${kind} with an email was refused: ${JSON.stringify(filed.body)}`);
  }
});

test('no donation, membership or caregiver application reaches the payment gateway without a valid email', () => {
  const bodies = {
    donate: { type: 'donate', currency: 'inr', amount: '1500', terms: 'yes', name: 'Asha Kumar', mobile: '9876543210', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', cause: 'Where it is needed most' },
    membership: { type: 'membership', tier: 'golden', amount: '1', name: 'Asha Rao', mobile: '9876543210', address: '12 Lake Road', city: 'Pune', state: 'Maharashtra', district: 'Pune', pincode: '411004', terms: 'yes' },
    'caregiver-application': { type: 'caregiver-application', name: 'Asha Rao', mobile: '9876543210', address: 'Car Street colony, near the temple', city: 'Udupi', animals: '12', district: 'Udupi', state: 'Karnataka', pincode: '576101', documents: 'a'.repeat(48) }
  };
  for (const [type, body] of Object.entries(bodies)) {
    assert.throws(() => payment.parsePaymentRequest(body), /Enter your email/, `${type} went through with no email`);
    assert.throws(() => payment.parsePaymentRequest(Object.assign({}, body, { email: 'asha@' })), /valid email/, `${type} went through with a broken email`);
    assert.doesNotThrow(() => payment.parsePaymentRequest(Object.assign({}, body, { email: 'asha@example.com' })), `${type} with a good email was refused`);
  }
});
