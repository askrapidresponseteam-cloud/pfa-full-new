'use strict';

/* Following a submission (8 Oct 2026, review B, findings 6, 9, 10 and 11;
   review A, finding 11).

   - A mobile or email typed under "Who is doing it" became a key that could
     follow the report: the accused could watch the case against them.
   - A wrong number and a number that is not yours were answered differently,
     so the sequential numbers could be walked to learn which exist.
   - "+91-098765-43210" was left at thirteen digits and told its own sender
     that it did not match.
   - The year in a number was the UTC year, so a report filed at 00:30 IST on
     1 January was numbered in the year that had just ended. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const RULES = require('../assets/field-rules.js');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { PLACE } = require('./_place');

function call(handler, { method = 'POST', body, query = {}, headers = {}, ip = '198.51.100.7' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, socket: { remoteAddress: ip }, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function build(db, now = () => Date.now()) {
  return createHandler({ getDb: () => db, deliver: async () => ({ providerId: 'p' }), isConfigured: () => false, now, queue: null });
}

const CR = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping.',
  animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001',
  when: 'This morning, around 8', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'reporter@example.com'
};
/* every form now sends an address (test/_place.js) */
Object.assign(CR, PLACE);
const look = (handler, reference, contact) => call(handler, { method: 'GET', query: contact === undefined ? { reference } : { reference, contact } });

test.beforeEach(() => { S.resetForTests(); process.env.PFA_SUBMISSIONS_INBOX = 'off'; });
test.after(() => { delete process.env.PFA_SUBMISSIONS_INBOX; delete process.env.PFA_AUTH_PEPPER; firebase._setDbForTests(null); });

test('B6: a mobile or email typed under "Who is doing it" cannot follow the report, on either server', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  process.env.PFA_AUTH_PEPPER = 'vercel-pepper';
  const filed = await call(handler, { body: { kind: 'PFA-CR', data: Object.assign({}, CR, { accused: 'Ramesh, dairy owner, 98111 22333' }) } });
  const byEmail = await call(handler, { body: { kind: 'PFA-CR', data: Object.assign({}, CR, { accused: 'ramesh.abuser@example.com' }) } });
  assert.equal(filed.statusCode, 200, filed.raw.slice(0, 300));
  for (const pepper of ['vercel-pepper', 'firebase-pepper']) {
    process.env.PFA_AUTH_PEPPER = pepper;
    assert.equal((await look(handler, filed.json.reference, '9811122333')).statusCode, 404, `${pepper}: the accused's mobile opened the report`);
    assert.equal((await look(handler, byEmail.json.reference, 'ramesh.abuser@example.com')).statusCode, 404, `${pepper}: the accused's email opened the report`);
    assert.equal((await look(handler, filed.json.reference, '98765 43210')).statusCode, 200, `${pepper}: the reporter could not follow it`);
    assert.equal((await look(handler, byEmail.json.reference, 'Reporter@Example.com')).statusCode, 200);
  }
  process.env.PFA_AUTH_PEPPER = 'vercel-pepper';
  assert.equal(S.contactKeysFor(db.dump()[`submissions/${filed.json.reference}`].fields).length, 2, 'the reporter\'s mobile and email, nothing else');
});

test('guard: records filed before this change still open for the contact they were filed with', () => {
  /* keys saved by the old rule, which also took a number from any field */
  const oldKeys = [S.contactKey('reporter@example.com'), S.contactKey('9876543210'), S.contactKey('9811122333')];
  const saved = { fields: { 'what happened': 'call 98111 22333', mobile: '9876543210', email: 'reporter@example.com' }, contactKeys: oldKeys };
  assert.equal(S.contactMatches(saved, 'reporter@example.com').ok, true);
  assert.equal(S.contactMatches(saved, '+91 98765 43210').ok, true);
  /* a record from before keys were saved at all, with its contact under another name */
  const older = { fields: { summary: 'Kittens near the market', 'reach me at': 'asha@example.com' } };
  assert.equal(S.contactMatches(older, 'ASHA@example.com').ok, true);
  assert.equal(S.contactMatches(older, 'someone@else.com').ok, false);
});

test('B9: a number that does not exist and a number that is not yours get one answer', async () => {
  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  const filed = await call(handler, { body: { kind: 'PFA-CR', data: CR } });
  const notYours = await look(handler, filed.json.reference, 'stranger@example.com');
  const noSuch = await look(handler, 'PFA-CR-2026-00099', 'stranger@example.com');
  assert.equal(notYours.statusCode, noSuch.statusCode);
  assert.deepEqual(notYours.json, noSuch.json, 'the answer tells an existing number from a missing one');
  assert.equal(noSuch.json.ok, false);

  /* and without a contact, the same again */
  const bareYours = await look(handler, filed.json.reference);
  const bareNone = await look(handler, 'PFA-CR-2026-00099');
  assert.equal(bareYours.statusCode, bareNone.statusCode);
  assert.deepEqual(bareYours.json, bareNone.json);
  assert.equal(bareNone.json.code, 'CONTACT_NEEDED');

  const track = fs.readFileSync(path.join(__dirname, '..', 'track.html'), 'utf8');
  assert.match(track, /One wording for a wrong number and for a number that is not yours/, 'the page shows the server\'s one wording');
});

test('B11: a mobile written with both +91 and a leading 0 is the same ten digits, here and in the browser', async () => {
  const forms = ['+91-098765-43210', '+91 0 98765 43210', '0091 098765 43210', '0091-9876543210', '+91 98765 43210', '098765 43210', '9876543210'];
  for (const value of forms) assert.equal(RULES.normaliseField('mobile', value), '9876543210', value);
  assert.equal(RULES.normaliseField('mobile', '9198765432'), '9198765432', 'a ten-digit mobile that starts 91 is kept whole');

  /* the same file, as the page loads it: a plain script that sets PFA_RULES */
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'field-rules.js'), 'utf8'), sandbox);
  assert.equal(sandbox.self.PFA_RULES.normaliseField('mobile', '+91-098765-43210'), '9876543210');

  const db = memoryFirestore(); firebase._setDbForTests(db);
  const handler = build(db);
  const filed = await call(handler, { body: { kind: 'PFA-CR', data: CR } });
  for (const value of forms) {
    assert.equal((await look(handler, filed.json.reference, value)).statusCode, 200, `${value} did not match the mobile it is`);
  }
});

test('B10: a number issued after midnight on 1 January in India carries the new year', async () => {
  const db = memoryFirestore();
  assert.equal(await S.allocateReference(db, 'PFA-Q', Date.UTC(2026, 11, 31, 18, 29)), 'PFA-Q-2026-00001', '23:59 IST is still 2026');
  assert.equal(await S.allocateReference(db, 'PFA-Q', Date.UTC(2026, 11, 31, 18, 30)), 'PFA-Q-2027-00001', '00:00 IST is 2027');
  assert.equal(S.referenceYear(Date.UTC(2027, 0, 1, 0, 0)), 2027);

  const intake = memoryFirestore(); firebase._setDbForTests(intake);
  const res = await call(build(intake, () => Date.UTC(2026, 11, 31, 19, 0)), { body: { kind: 'PFA-CR', data: CR } });
  assert.equal(res.json.reference, 'PFA-CR-2027-00001', 'filed at 00:30 IST on 1 Jan 2027');
});
