'use strict';

/* Further adversarial checks on fixed items (8 Oct 2026 verification). */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');
const S = require('../lib/submissions');
const { PLACE } = require('./_place');

let W;
test.beforeEach(() => { W = H.fresh(); process.env.PFA_SUBMISSIONS_INBOX = H.INBOX; });
test.afterEach(() => { W.restore(); });

const CR = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping.',
  animal: 'Dog', urgency: 'Happening now', location: 'New Delhi, Delhi', pincode: '110001',
  when: 'This morning, around 8', accused: 'Ramesh, dairy owner, 98111 22333', name: 'Asha Rao', mobile: '9876543210', email: 'reporter@example.com'
};
/* every form now sends an address (test/_place.js) */
Object.assign(CR, PLACE);

test('B6-legacy a report filed BEFORE the fix (keys saved by the old rule) still opens for the accused', async () => {
  /* what the old contactKeysFor saved: every field holding an @ or ten digits */
  const fields = Object.assign({}, CR);
  const oldKeys = new Set();
  for (const v of Object.values(fields)) { const k = S.contactKey(v); if (k && (/@/.test(v) || /\d{10}/.test(String(v).replace(/\D/g, '')))) oldKeys.add(k); }
  await W.db.collection('submissions').doc('PFA-CR-2026-00003').set({ reference: 'PFA-CR-2026-00003', kind: 'PFA-CR', status: 'new', fields, contactKeys: [...oldKeys], createdAt: '2026-10-01T00:00:00.000Z', receivedAtMs: 1, history: [{ status: 'new', at: '2026-10-01T00:00:00.000Z' }] });
  const look = await H.call(require('../lib/routes/pfa-submissions'), { token: null, method: 'GET', query: { reference: 'PFA-CR-2026-00003', contact: '9811122333' } });
  assert.notEqual(look.statusCode, 200, 'the accused follows a report filed before 8 Oct 2026');
});

test('B2-resume a request that died after the record was committed is finished by its retry, under the same number', async () => {
  const route = require('../lib/routes/pfa-submissions');
  const firebase = require('../lib/firebase');
  const key = firebase.hashKey('PFA-CR:died-1');
  /* the state a crash right after the transaction leaves behind */
  const r = await H.call(route, { token: null, body: { kind: 'PFA-CR', data: CR, clientRequestId: 'seed-only' } });
  const rec = W.db.dump()[`submissions/${r.json.reference}`];
  await W.db.collection('submissions').doc('PFA-CR-2026-00002').set(Object.assign({}, rec, { reference: 'PFA-CR-2026-00002', threadId: 'bbbbbbbbbbbb' }));
  await W.db.collection('counters').doc('submissions').set({ 'PFA-CR-2026': 2 }, { merge: true });
  await W.db.collection('submissionIdempotency').doc(key).set({ reference: 'PFA-CR-2026-00002', kind: 'PFA-CR', createdAt: rec.createdAt, state: 'filing', attachments: 0 });
  W.smtp.sent.length = 0;
  const retry = await H.call(route, { token: null, body: { kind: 'PFA-CR', data: CR, clientRequestId: 'died-1' } });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json.reference, 'PFA-CR-2026-00002');
  assert.ok(W.smtp.sent.some((m) => m.to === 'reporter@example.com'), 'confirmation finally sent');
  assert.ok(W.smtp.sent.some((m) => m.to === H.INBOX), 'forward finally sent');
  assert.equal(W.db.dump()[`submissionIdempotency/${key}`].state, 'filed');
});

test('A4b the person writing twice to a handled case reopens it once; spam is never reopened by the sender', async () => {
  const INB = require('../lib/inbound-mail');
  const o = { inboxes: [H.INBOX], fieldValue: H.firebase.fieldValue };
  const REF = 'PFA-Q-2026-00050';
  await H.seed(W.db, REF, { status: 'handled', handledBy: 'a@pfa.test', handledNote: 'done' });
  for (const n of [1, 2]) {
    await INB.file(W.db, { messageId: `<p${n}@example.com>`, from: 'asha@example.com', subject: 'Re', inReplyTo: `<${REF}.abcdefabcdef.confirm@peopleforanimalsindia.org>`, text: 'again ' + n, date: new Date() }, o);
  }
  const r = await H.rec(W.db, REF);
  assert.equal(r.status, 'new');
  assert.equal(r.history.filter((h) => h.event === 'reopen').length, 1);
  assert.equal(r.closes.length, 1);
  const SP = 'PFA-Q-2026-00051';
  await H.seed(W.db, SP, { status: 'spam' });
  await INB.file(W.db, { messageId: '<p9@example.com>', from: 'asha@example.com', subject: 'Re', inReplyTo: `<${SP}.abcdefabcdef.confirm@peopleforanimalsindia.org>`, text: 'hello', date: new Date() }, o);
  assert.equal((await H.rec(W.db, SP)).status, 'spam');
});

test('A6c a staged kind is never taken up into a generic status by an inbox reply', async () => {
  const INB = require('../lib/inbound-mail');
  const o = { inboxes: [H.INBOX], fieldValue: H.firebase.fieldValue };
  for (const [ref, kind, want] of [['PFA-V-2026-00060', 'PFA-V', 'under-review'], ['PFA-MEM-2026-00061', 'PFA-MEM', 'new'], ['PFA-CG-2026-00062', 'PFA-CG', 'under-review']]) {
    await H.seed(W.db, ref, { kind });
    await INB.file(W.db, { messageId: `<g-${ref}@sansad.in>`, from: H.INBOX, subject: 'Re', inReplyTo: `<${ref}.abcdefabcdef.forward@peopleforanimalsindia.org>`, text: 'ok', date: new Date() }, o);
    assert.equal((await H.rec(W.db, ref)).status, want, ref);
  }
});
