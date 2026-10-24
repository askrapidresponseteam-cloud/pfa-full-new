'use strict';

/* The server now issues every submission reference and lets the sender follow
   it. These pin the two halves: numbers that cannot collide or be chosen by
   the browser, and a lookup that shows only status, only to the person who
   gave the contact. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const S = require('../lib/submissions');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const mail = require('../lib/caregiver-mail');
const { PLACE } = require('./_place');

/* Just enough of Firestore: collections of documents, get/create/set, and a
   transaction that runs its body against the same store. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) {
      if (store.has(key(c, id))) { const e = new Error('Document already exists'); e.code = 6; throw e; }
      store.set(key(c, id), Object.assign({}, data));
    },
    async set(data, opts) {
      const prev = (opts && opts.merge && store.get(key(c, id))) || {};
      store.set(key(c, id), Object.assign({}, prev, data));
    }
  });
  const db = {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      const tx = { get: (ref) => ref.get(), set: (ref, data, opts) => { ref.set(data, opts); } };
      return fn(tx);
    }
  };
  return db;
}

function request({ method = 'POST', body, query = {}, headers = {} } = {}) {
  const r = new EventEmitter();
  r.method = method; r.query = query; r.headers = headers;
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
function responder() {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  return res;
}
async function run(handler, req) { const res = responder(); await handler(req, res); return res; }

const NOW = Date.UTC(2026, 7, 23, 10, 0);

function handlerWith(db, overrides = {}) {
  return createHandler(Object.assign({
    getDb: () => db, deliver: async () => ({ id: 'm1' }), isConfigured: () => false, now: () => NOW
  }, overrides));
}

test('references are issued by the server, in sequence, per kind and year', async () => {
  const db = fakeDb();
  assert.equal(await S.allocateReference(db, 'PFA-C', NOW), 'PFA-C-2026-00001');
  assert.equal(await S.allocateReference(db, 'PFA-C', NOW), 'PFA-C-2026-00002');
  assert.equal(await S.allocateReference(db, 'PFA-Q', NOW), 'PFA-Q-2026-00001', 'each kind counts on its own');
  assert.equal(await S.allocateReference(db, 'PFA-C', Date.UTC(2027, 0, 1)), 'PFA-C-2027-00001', 'the count restarts each year');
  assert.ok(S.isReference('PFA-C-2026-00042'));
  assert.ok(S.isReference('PFA-C-2026-41873'), 'numbers the browser used to make are still accepted');
  assert.ok(!S.isReference('PFA-C-2026-00042; DROP'));
  assert.ok(!S.isReference('hello'));
});

test('a submission is stored under the issued number and the browser cannot choose or overwrite it', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  const first = await run(handler, request({ body: { kind: 'PFA-C', reference: 'PFA-C-2026-00001', data: { summary: 'Dog chained on a terrace', contact: 'asha@example.com' }, page: '/network.html' } }));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.reference, 'PFA-C-2026-00001');

  /* A second sender who posts the same "reference" gets the next number, and
     the first record is untouched. */
  const second = await run(handler, request({ body: { kind: 'PFA-C', reference: 'PFA-C-2026-00001', data: { summary: 'Something else', contact: '9876543210', email: 'ravi@example.com' } } }));
  assert.equal(second.body.reference, 'PFA-C-2026-00002');
  assert.equal(db.store.get('submissions/PFA-C-2026-00001').fields.summary, 'Dog chained on a terrace');

  const stored = db.store.get('submissions/PFA-C-2026-00001');
  assert.equal(stored.status, 'new');
  assert.deepEqual(stored.history.map((h) => h.status), ['new']);
  assert.equal(stored.contactKeys.length, 1, 'the contact is kept as a key for the follow-up check');
  assert.ok(!stored.contactKeys[0].includes('@'), 'and not as the address itself');
});

test('bad input is refused before any number is spent', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  assert.equal((await run(handler, request({ body: { kind: 'PFA-X', data: {} } }))).statusCode, 400);
  const invalid = await run(handler, request({ body: { kind: 'PFA-Q', data: { question: 'Where do I take a hurt crow?', topic: 'Something else', ...PLACE, name: 'Asha Rao', email: 'asha@example.com', contact: 'not a contact' } } }));
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.body.fields[0].field, 'contact');
  assert.equal(db.store.has('counters/submissions'), false, 'no counter was touched');
});

test('following needs the number and the contact that was given with it, and returns status only', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  S.resetForTests();
  await run(handler, request({ body: { kind: 'PFA-C', data: { summary: 'Kittens abandoned near the market', details: 'Very private details', contact: ' Asha@Example.com ' } } }));

  const missing = await run(handler, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001' } }));
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.body.code, 'CONTACT_NEEDED');

  /* A number that is not yours is answered exactly as a number that does not
     exist (8 Oct 2026), so the lookup cannot be used to find which exist. */
  const wrong = await run(handler, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001', contact: 'someone@else.com' } }));
  assert.equal(wrong.statusCode, 404);
  assert.equal(wrong.body.code, 'NO_MATCH');

  const right = await run(handler, request({ method: 'GET', query: { reference: ' pfa-c-2026-00001 ', contact: 'ASHA@example.com' } }));
  assert.equal(right.statusCode, 200);
  assert.equal(right.body.statusLabel, 'Received');
  assert.equal(right.body.kindLabel, 'Case follow request');
  assert.equal(right.body.timeline.length, 1);
  const text = JSON.stringify(right.body);
  assert.ok(!text.includes('Kittens') && !text.includes('private') && !text.includes('asha@'), 'nothing from the report leaks');

  const unknown = await run(handler, request({ method: 'GET', query: { reference: 'PFA-C-2026-00099', contact: 'a@b.com' } }));
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(unknown.body, wrong.body, 'one answer for both');
  const junk = await run(handler, request({ method: 'GET', query: { reference: 'abc' } }));
  assert.equal(junk.statusCode, 400);
});

test('a mobile given with spaces or a country code still matches', () => {
  const keys = S.contactKeysFor({ name: 'Asha', mobile: '+91 98765 43210' });
  assert.equal(keys.length, 1);
  assert.equal(S.contactKey('9876543210'), keys[0]);
  assert.equal(S.contactKey('098765-43210'), keys[0]);
  assert.notEqual(S.contactKey('9876543211'), keys[0]);
  /* Only fields the form names as the sender's contact make a key (8 Oct
     2026): an address under any other name may be someone else's. */
  assert.equal(S.contactKeysFor({ 'where to reach you': 'x@y.in' }).length, 0);
  /* Old records have no keys stored; they are derived from the fields, by the
     old rule, so a number issued then still opens for its sender. */
  assert.equal(S.contactMatches({ fields: { email: 'x@y.in' } }, 'X@Y.IN').ok, true);
  assert.equal(S.contactMatches({ fields: { 'where to reach you': 'x@y.in' } }, 'X@Y.IN').ok, true);
  assert.deepEqual(S.contactMatches({ fields: { summary: 'no contact given' } }, ''), { required: false, ok: true });
});

test('the public view turns staff statuses into plain words and keeps the history in order', () => {
  const view = S.publicView({
    reference: 'PFA-Q-2026-00007', kind: 'PFA-Q', status: 'spam', createdAt: '2026-08-01T10:00:00.000Z',
    handledBy: 'staff@pfa.org', fields: { question: 'secret' },
    history: [{ status: 'new', at: '2026-08-01T10:00:00.000Z' }, { status: 'in-progress', at: '2026-08-02T09:00:00.000Z' }, { status: 'spam', at: '2026-08-03T09:00:00.000Z' }]
  });
  assert.equal(view.statusLabel, 'Closed', 'spam is never shown as spam');
  assert.deepEqual(view.timeline.map((t) => t.label), ['Received', 'Being handled', 'Closed']);
  assert.equal(view.updatedAt, '2026-08-03T09:00:00.000Z');
  assert.equal(view.fields, undefined);
  assert.equal(view.handledBy, undefined);

  /* Records from before the history existed still produce a timeline. */
  const legacy = S.publicView({ reference: 'PFA-C-2026-41873', kind: 'PFA-C', status: 'handled', createdAt: '2026-07-01T00:00:00.000Z', handledAt: '2026-07-05T00:00:00.000Z' });
  assert.deepEqual(legacy.timeline.map((t) => t.label), ['Received', 'Closed']);
});

test('repeated lookups from one connection are slowed down', async () => {
  S.resetForTests();
  for (let i = 0; i < 40; i += 1) assert.equal(S.rateLimited('203.0.113.9', NOW + i), false);
  assert.equal(S.rateLimited('203.0.113.9', NOW + 41), true);
  assert.equal(S.rateLimited('203.0.113.10', NOW + 41), false, 'another connection is unaffected');
  assert.equal(S.rateLimited('203.0.113.9', NOW + 16 * 60 * 1000), false, 'and the window passes');
  S.resetForTests();
});

test('sending is braked too, on its own counter', async () => {
  S.resetForTests();
  /* Looking a reference up and sending a form must not share a counter: a
     person refreshing the status of the report they just filed would then find
     that the refreshing had used up their ability to file another. */
  for (let i = 0; i < 40; i += 1) S.rateLimited('203.0.113.11', NOW + i);
  assert.equal(S.writeLimited('203.0.113.11', NOW + 41), false, 'lookups must not close the sending path');

  for (let i = 0; i < S.WRITE_LIMIT; i += 1) {
    assert.equal(S.writeLimited('203.0.113.12', NOW + i), false, `send ${i + 1} was refused`);
  }
  assert.equal(S.writeLimited('203.0.113.12', NOW + 99), true, 'a flood is not braked');
  assert.equal(S.writeLimited('203.0.113.13', NOW + 99), false, 'another connection is unaffected');
  assert.equal(S.writeLimited('203.0.113.12', NOW + 16 * 60 * 1000), false, 'and the window passes');

  /* And the route actually applies it, rather than merely exporting it. */
  const db = fakeDb();
  const handler = handlerWith(db);
  const body = { kind: 'PFA-C', data: { summary: 'Kittens abandoned near the market', contact: 'asha@example.com' } };
  let refused = null;
  for (let i = 0; i < S.WRITE_LIMIT + 2 && !refused; i += 1) {
    const res = await run(handler, request({ body, headers: { 'x-forwarded-for': '203.0.113.14' } }));
    if (res.statusCode === 429) refused = res;
  }
  assert.ok(refused, 'the endpoint took every request without ever braking');
  assert.match(refused.body.error, /call 112/, 'a person in a hurry is told what to do instead');
  S.resetForTests();
});

test('an acknowledgement goes to the email given, and never delays or fails the submission', async () => {
  const sent = [];
  const db = fakeDb();
  const handler = handlerWith(db, { isConfigured: () => true, deliver: async (m) => { sent.push(m); return { id: 'ok' }; } });
  const res = await run(handler, request({ body: { kind: 'PFA-Q', data: { question: 'Do you take in birds?', topic: 'An animal I found or feed', ...PLACE, name: 'meena iyer', email: 'meena@example.com' } }, headers: { host: 'peopleforanimalsindia.org' } }));
  assert.equal(res.body.acknowledged, true);
  assert.equal(sent[0].to, 'meena@example.com');
  assert.equal(sent[0].template, 'submission_received');
  assert.equal(sent[0].payload.name, 'Meena Iyer');
  assert.match(sent[0].payload.followUrl, /^https:\/\/peopleforanimalsindia\.org\/track\.html#ref=PFA-Q-2026-00001$/);

  const slow = handlerWith(fakeDb(), { isConfigured: () => true, deliver: () => new Promise(() => {}) });
  const started = Date.now();
  const res2 = await run(slow, request({ body: { kind: 'PFA-Q', data: { email: 'meena@example.com', question: 'Do you take in injured birds at the Delhi unit?', topic: 'Something else', ...PLACE, name: 'Meena Iyer', contact: 'x@y.in' } } }));
  assert.equal(res2.statusCode, 200, 'the number is issued even if mail hangs');
  assert.equal(res2.body.acknowledged, false);
  assert.ok(Date.now() - started < 4000);

  const rendered = mail.render('submission_received', sent[0].payload);
  assert.match(rendered.subject, /PFA-Q-2026-00001/);
  assert.ok(rendered.html.includes('Track your question') && rendered.text.includes('Reference: PFA-Q-2026-00001'));
});

/* The test that stood here checked assets/site.js, assets/network.js and
   network.html. None of the three is in this tree: site.js is loaded by no
   page, and the other two were removed with the old network page. The rule
   it protected - the browser never invents a reference - is covered above by
   'a submission is stored under the issued number and the browser cannot
   choose or overwrite it', which tests the server that actually enforces it. */

/* ---- photographs ----------------------------------------------------------- */

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(1200, 1)]);
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;

test('photos are judged by their bytes, capped in number and size, and stored beside the report', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  const res = await run(handler, request({ body: {
    kind: 'PFA-C',
    data: { summary: 'Dog chained on a terrace with no water', contact: 'asha@example.com' },
    photos: [dataUrl('image/jpeg', JPEG), dataUrl('image/jpeg', PNG)] // the second is really a PNG
  } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.attachments, 2);
  assert.equal(db.store.get('submissions/PFA-C-2026-00001').attachments, 2);
  const one = db.store.get('submissions/PFA-C-2026-00001/attachments/1');
  const two = db.store.get('submissions/PFA-C-2026-00001/attachments/2');
  assert.equal(one.contentType, 'image/jpeg');
  assert.equal(two.contentType, 'image/png', 'the label said JPEG; the bytes say PNG');
  assert.ok(Buffer.isBuffer(one.bytes) && one.bytes.equals(JPEG));
  /* Photos never reach the fields, the public view or the contact keys. */
  const stored = db.store.get('submissions/PFA-C-2026-00001');
  assert.equal(JSON.stringify(stored.fields).includes('base64'), false);
  assert.equal(S.publicView(stored).photos, undefined);

  const junk = await run(handler, request({ body: { kind: 'PFA-C', data: { summary: 'A real summary of the problem', contact: 'a@b.in' }, photos: ['data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64')] } }));
  assert.equal(junk.statusCode, 422);
  assert.match(junk.body.error, /not a JPEG, PNG or WebP/);
  assert.equal(db.store.has('submissions/PFA-C-2026-00002'), false, 'nothing is stored when a photo is refused');

  const many = S.parsePhotos([1, 2, 3, 4].map(() => dataUrl('image/jpeg', JPEG)));
  assert.match(many.rejected[0], /Up to 3/);
  const huge = S.parsePhotos([dataUrl('image/jpeg', Buffer.concat([JPEG, Buffer.alloc(1000 * 1024)]))]);
  assert.match(huge.rejected[0], /too large/);
  assert.equal(S.parsePhotos(undefined).accepted.length, 0);
});

test('the admin can fetch a report\u2019s photo by number; nobody else can', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  await run(handler, request({ body: { kind: 'PFA-C', data: { summary: 'Kittens abandoned near the market', contact: 'a@b.in' }, photos: [dataUrl('image/jpeg', JPEG)] } }));

  const firebase = require('../lib/firebase');
  const auth = require('../lib/admin-auth');
  const realGetDb = firebase.getDb, realRequire = auth.requireAdmin;
  firebase.getDb = () => db;
  let admitted = true;
  auth.requireAdmin = async (req, res) => { if (admitted) return { uid: 'u', email: 'staff@pfa.org' }; res.statusCode = 401; res.end(JSON.stringify({ code: 'UNAUTHORISED' })); return null; };
  delete require.cache[require.resolve('../lib/routes/admin/attachment')];
  const attachment = require('../lib/routes/admin/attachment');
  try {
    const ok = await run(attachment, request({ method: 'GET', query: { reference: 'pfa-c-2026-00001', n: '1' } }));
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.contentType, 'image/jpeg');
    assert.ok(Buffer.from(ok.body.data, 'base64').equals(JPEG));
    assert.equal((await run(attachment, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001', n: '2' } }))).statusCode, 404);
    assert.equal((await run(attachment, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001', n: '9' } }))).statusCode, 400);
    admitted = false;
    assert.equal((await run(attachment, request({ method: 'GET', query: { reference: 'PFA-C-2026-00001', n: '1' } }))).statusCode, 401);
  } finally {
    firebase.getDb = realGetDb; auth.requireAdmin = realRequire;
  }
});

/* ---- nothing deletes a submission --------------------------------------- */

test('a submission cannot be deleted or altered from the public site, the panel, or the browser', async () => {
  const handler = handlerWith(fakeDb());
  for (const method of ['DELETE', 'PUT', 'PATCH']) {
    const res = await run(handler, request({ method, query: { reference: 'PFA-C-2026-00001' } }));
    assert.equal(res.statusCode, 405, `${method} is refused`);
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/submissions\/\{id\}\s*\{\s*allow read: if isAdmin\(\); allow write: if false; \}/,
    'the browser cannot write a submission even with the public API key');
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/, 'photo subcollections fall under the closed catch-all');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  walk(path.join(root, 'lib')).concat(walk(path.join(root, 'api'))).filter((f) => f.endsWith('.js')).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes("collection('submissions')")) return;
    assert.ok(!/\.delete\(/.test(source), `${path.relative(root, file)} must not delete submissions`);
    /* Only the two admin routes that work a case may update one, and they
       only ever touch status, handling and the conversation - never what
       the sender wrote. */
    const admin = file.endsWith(path.join('admin', 'submission-status.js')) || file.endsWith(path.join('admin', 'case.js'));
    assert.ok(!/\{\s*merge:\s*true\s*\}/.test(source) || admin, `${path.relative(root, file)} must not merge over a submission`);
    if (admin) {
      /* Reading the fields back for the panel is fine; writing them is not:
         no set() or update() payload in these files may carry a `fields` key. */
      const writes = [...source.matchAll(/\.(?:set|update|create)\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)].map((m) => m[1]);
      writes.forEach((w) => assert.ok(!/\bfields\s*:/.test(w), `${path.relative(root, file)} must not rewrite the sender's fields`));
    }
  });
  const status = fs.readFileSync(path.join(root, 'lib', 'routes', 'admin', 'submission-status.js'), 'utf8');
  assert.match(status, /const ALLOWED = new Set\(\['new', 'in-progress', 'handled', 'spam'\]\)/, 'the panel can only change status');
});

/* ---- one submission, sent twice, is one record ---- */
test('a double press or a retry after a lost answer is one submission with one number', async () => {
  const db = fakeDb();
  const handler = handlerWith(db);
  const body = { kind: 'PFA-Q', data: { question: 'Where do I take a hurt crow?', topic: 'Something else', ...PLACE, name: 'Asha Rao', email: 'asha@example.com', message: 'Where do I take a hurt crow?' }, clientRequestId: 'k-1' };

  const first = await run(handler, request({ body }));
  assert.equal(first.body.ok, true, JSON.stringify(first.body));
  const second = await run(handler, request({ body }));
  assert.equal(second.body.ok, true);
  assert.equal(second.body.reference, first.body.reference, 'the replay is answered with the same number');
  assert.equal(second.body.duplicate, true);
  assert.equal(db.store.has(`submissions/${first.body.reference}`), true);
  assert.equal([...db.store.keys()].filter((k) => /^submissions\/[^/]+$/.test(k)).length, 1, 'one record, not two');

  /* A different key is a different submission, even with the same words. */
  const third = await run(handler, request({ body: Object.assign({}, body, { clientRequestId: 'k-2' }) }));
  assert.notEqual(third.body.reference, first.body.reference);

  /* Without a key there is no guard, and nothing breaks. */
  const bare = await run(handler, request({ body: { kind: 'PFA-Q', data: body.data } }));
  assert.equal(bare.body.ok, true);
  assert.equal(bare.body.duplicate, undefined);
});

test('the browser helper sends a key that is stable for the same data and changes when the data changes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pfa-forms.js'), 'utf8');
  assert.match(src, /body: requestBody\(kind, data, opts\)/, 'every submit carries a key');
  const w = { crypto: { randomUUID: () => 'nonce' }, location: { pathname: '/ask.html' } };
  new Function('window', 'crypto', 'location', src)(w, w.crypto, w.location);
  const key = (kind, data) => JSON.parse(w.PFAForms._requestBody(kind, data)).clientRequestId;
  assert.equal(key('PFA-Q', { a: 1 }), key('PFA-Q', { a: 1 }));
  assert.notEqual(key('PFA-Q', { a: 1 }), key('PFA-Q', { a: 2 }));
  assert.notEqual(key('PFA-Q', { a: 1 }), key('PFA-C', { a: 1 }));
  assert.match(key('PFA-Q', { a: 1 }), /^nonce-/);
});

test('following a submission works whichever server wrote it (a different PFA_AUTH_PEPPER on each)', () => {
  /* 8 Oct 2026: PFA-Q-2026-00002 was written on one server and looked up on
     the other; its sender, typing their own email, was told it did not match. */
  const saved = process.env.PFA_AUTH_PEPPER;
  try {
    process.env.PFA_AUTH_PEPPER = 'pepper-on-vercel';
    const fields = { name: 'Karthik', email: 'karthik@example.in', mobile: '9876543210', giftEmail: 'friend@example.in', question: 'call 9123456789 please' };
    const record = { fields, contactKeys: S.contactKeysFor({ email: fields.email, mobile: fields.mobile }) };
    process.env.PFA_AUTH_PEPPER = 'pepper-on-firebase';
    assert.equal(S.contactMatches(record, 'Karthik@Example.in').ok, true, 'the email on the record');
    assert.equal(S.contactMatches(record, '+91 98765 43210').ok, true, 'the mobile on the record');
    assert.equal(S.contactMatches(record, 'friend@example.in').ok, false, "a gift recipient's email is not the sender's");
    assert.equal(S.contactMatches(record, '9123456789').ok, false, 'nor a number inside the text');
    assert.equal(S.contactMatches(record, 'someone@else.in').ok, false, 'and a stranger still cannot');
  } finally {
    if (saved === undefined) delete process.env.PFA_AUTH_PEPPER; else process.env.PFA_AUTH_PEPPER = saved;
  }
});
