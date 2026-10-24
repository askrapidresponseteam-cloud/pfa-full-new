'use strict';

/* Verification of review A (ticket lifecycle), A1-A12. Each test states the
   CORRECT behaviour, so a failure means the defect is still there. Adapted
   from review-A/repro/r1..r11 (8 Oct 2026). */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');

const CASE = () => require('../lib/routes/admin/case');
const STATUS = () => require('../lib/routes/admin/submission-status');
const TRACK = () => require('../lib/routes/pfa-submissions');
const RECORDS = () => require('../lib/routes/admin/records');
const INB = () => require('../lib/inbound-mail');
const ROUTE_INB = () => require('../lib/routes/inbound-mail');
const { PLACE } = require('./_place');

let W;
test.beforeEach(() => { W = H.fresh(); });
test.afterEach(() => { W.restore(); require('../lib/file-store')._reset(); });

const track = (ref) => H.call(TRACK(), { method: 'GET', token: null, query: { reference: ref, contact: 'asha@example.com' } });
const fileIn = (raw, extra) => INB().file(W.db, Object.assign({ date: new Date() }, raw), Object.assign({ inboxes: [H.INBOX], fieldValue: H.firebase.fieldValue }, extra || {}));

test('A1 a signed-in staff member cannot hand in a forged email; the refusal is audited', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = H.INBOX;
  const REF = 'PFA-CR-2026-00017';
  await H.seed(W.db, REF, { kind: 'PFA-CR' });
  const a = await H.call(ROUTE_INB(), { token: 'tok-desk', body: { message: { from: 'asha@example.com', subject: `Re: ${REF}`, text: 'I withdraw', date: '2026-10-01T08:00:00Z' } } });
  const b = await H.call(ROUTE_INB(), { token: 'tok-desk', body: { message: { from: H.INBOX, subject: `Re: ${REF}`, text: 'Taken up.' } } });
  assert.equal(a.statusCode, 403);
  assert.equal(b.statusCode, 403);
  const r = await H.rec(W.db, REF);
  assert.equal(r.status, 'new');
  assert.equal(H.msgs(W.db, REF).filter((m) => m.direction === 'in').length, 0);
  const audit = Object.entries(W.db.dump()).filter(([k, v]) => k.startsWith('adminAudit/') && v.actor.email === 'desk@pfa.test');
  assert.equal(audit.length, 2);
});

test('A2a a reply in flight does not undo another admin\'s close', async () => {
  const REF = 'PFA-Q-2026-00004';
  await H.seed(W.db, REF);
  let release; const gate = new Promise((r) => { release = r; });
  W.smtp.hold = async (m) => { if (m.to === 'asha@example.com') await gate; };
  const replying = H.call(CASE(), { token: 'tok-a', body: { reference: REF, action: 'reply', text: 'On our way.', requestId: 'r-a2' } });
  await H.sleep(80);
  const close = await H.call(CASE(), { token: 'tok-b', body: { reference: REF, action: 'status', status: 'handled', note: 'Resolved by phone' } });
  assert.equal(close.statusCode, 200);
  release();
  const r = await replying; W.smtp.hold = null;
  assert.equal(r.statusCode, 200);
  const after = await H.rec(W.db, REF);
  assert.equal(after.status, 'handled');
  assert.equal(after.handledBy, 'b@pfa.test');
  assert.equal(after.handledNote, 'Resolved by phone');
});

test('A2b an inbound reply filed while its photo uploads does not undo a spam mark', async () => {
  const FILES = require('../lib/file-store');
  const REF = 'PFA-Q-2026-00005';
  await H.seed(W.db, REF);
  let release; const gate = new Promise((r) => { release = r; });
  FILES._setBucket(() => ({ name: 'b', bucket: { file: () => ({ save: async () => { await gate; } }) } }));
  const filing = fileIn({ messageId: '<madam-1@sansad.in>', from: `Gandhi M <${H.INBOX}>`, to: 'asha@example.com', subject: 'Re: ' + REF,
    inReplyTo: `<${REF}.abcdefabcdef.forward@peopleforanimalsindia.org>`, text: 'Send it to the hospital.',
    attachments: [{ filename: 'map.jpg', contentType: 'image/jpeg', content: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }] });
  await H.sleep(60);
  const spam = await H.call(CASE(), { token: 'tok-b', body: { reference: REF, action: 'status', status: 'spam' } });
  assert.equal(spam.statusCode, 200);
  release(); await filing;
  const after = await H.rec(W.db, REF);
  assert.equal(after.status, 'spam');
  assert.notEqual(after.handledBy, H.INBOX);
});

test('A3a the same reply pressed twice (no requestId, old panel) sends one email; POST answers carry case', async () => {
  const REF = 'PFA-Q-2026-00001';
  await H.seed(W.db, REF);
  const a = await H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'We are sending a rescuer.' } });
  const b = await H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'We are sending a rescuer.' } });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(b.json.duplicate, true);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'asha@example.com').length, 1);
  assert.equal((await H.rec(W.db, REF)).replyCount, 1);
  assert.ok(a.json.case && a.json.case.reference === REF);
});

test('A3b the same requestId fired twice at once sends one email', async () => {
  const REF = 'PFA-Q-2026-00021';
  await H.seed(W.db, REF);
  const body = { reference: REF, action: 'reply', text: 'Hello', requestId: 'r-same' };
  const [a, b] = await Promise.all([H.call(CASE(), { body }), H.call(CASE(), { body })]);
  assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'asha@example.com').length, 1);
});

test('A3c two different replies at once get different Message-IDs and replyCount 2', async () => {
  const REF = 'PFA-Q-2026-00002';
  await H.seed(W.db, REF);
  const [c, d] = await Promise.all([
    H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'First answer', requestId: 'r1' } }),
    H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'Second answer', requestId: 'r2' } })
  ]);
  assert.deepEqual([c.statusCode, d.statusCode], [200, 200]);
  const ids = W.smtp.sent.map((m) => m.messageId);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.equal((await H.rec(W.db, REF)).replyCount, 2);
});

test('A3d a legacy record (no threadId) answered twice at once gets ONE thread; the person\'s answer to either email is filed', async () => {
  const REF = 'PFA-Q-2026-00003';
  await H.seed(W.db, REF, { threadId: undefined, threadSubject: undefined });
  await Promise.all([
    H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'First answer', requestId: 'x1' } }),
    H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'Second answer', requestId: 'x2' } })
  ]);
  const MT = require('../lib/mail-thread');
  const sent = W.smtp.sent.filter((m) => m.to === 'asha@example.com');
  const stored = (await H.rec(W.db, REF)).threadId;
  assert.equal(sent.length, 2);
  for (const m of sent) assert.equal(MT.parse(m.messageId).threadId, stored);
  const out = await fileIn({ messageId: '<person-1@example.com>', from: 'Asha Rao <asha@example.com>', subject: 'Re: ' + sent[0].subject, inReplyTo: sent[0].messageId, references: sent[0].messageId, text: 'Thank you.' });
  assert.equal(out.filed, true);
});

test('A4 the person writing back to a handled case reopens it; the tracker says they wrote, not that PFA replied', async () => {
  const REF = 'PFA-Q-2026-00006';
  await H.seed(W.db, REF);
  await H.call(CASE(), { body: { reference: REF, action: 'status', status: 'handled' } });
  const out = await fileIn({ messageId: '<asha-2@example.com>', from: 'Asha Rao <asha@example.com>', subject: 'Re: ' + REF,
    inReplyTo: `<${REF}.abcdefabcdef.confirm@peopleforanimalsindia.org>`, text: 'It is NOT resolved.' });
  assert.equal(out.filed, true);
  const r = await H.rec(W.db, REF);
  assert.equal(r.status, 'new');
  const list = await H.call(RECORDS(), { method: 'GET', query: { type: 'submissions', status: 'new' } });
  assert.ok(list.json.rows.map((x) => x.reference).includes(REF), JSON.stringify(list.json).slice(0, 300));
  const t = await track(REF);
  const labels = t.json.timeline.map((x) => x.label);
  assert.ok(labels.includes('You wrote to PFA'), labels.join(' -> '));
  assert.ok(!labels.includes('PFA replied by email'), labels.join(' -> '));
});

test('A5 internal actions never show on the public timeline; spam never leaves the server', async () => {
  const REF = 'PFA-S-2026-00007';
  await H.seed(W.db, REF);
  await H.call(CASE(), { body: { reference: REF, action: 'assign', to: 'karthik@pfa.test' } });
  await H.call(CASE(), { body: { reference: REF, action: 'assign', to: '' } });
  await H.call(CASE(), { body: { reference: REF, action: 'wall', published: true } });
  await H.call(CASE(), { body: { reference: REF, action: 'note', text: 'internal' } });
  let t = await track(REF);
  assert.deepEqual(t.json.timeline.map((x) => x.label), ['Received']);
  await H.call(CASE(), { body: { reference: REF, action: 'status', status: 'spam' } });
  t = await track(REF);
  assert.ok(!/spam/i.test(t.raw), t.raw);
  assert.equal(t.json.status, 'closed');
});

test('A6a same-state move refused, first close kept; reopen clears the closer and keeps the close', async () => {
  const REF = 'PFA-Q-2026-00008';
  await H.seed(W.db, REF);
  await H.call(CASE(), { token: 'tok-a', body: { reference: REF, action: 'status', status: 'handled', note: 'Rescued' } });
  const again = await H.call(CASE(), { token: 'tok-b', body: { reference: REF, action: 'status', status: 'handled' } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json.code, 'SAME_STATUS');
  let r = await H.rec(W.db, REF);
  assert.equal(r.handledBy, 'a@pfa.test');
  assert.equal(r.handledNote, 'Rescued');
  const back = await H.call(CASE(), { body: { reference: REF, action: 'status', status: 'new' } });
  assert.equal(back.statusCode, 200);
  r = await H.rec(W.db, REF);
  assert.equal(r.handledBy, '');
  assert.ok(!r.handledAt);
  assert.equal(r.closes.length, 1);
  assert.equal(r.closes[0].note, 'Rescued');
  assert.ok(r.history.some((h) => h.event === 'reopen' && h.reason === 'staff'));
});

test('A6b per-kind stages reachable, generic statuses refused, own stage shown; approve on a closed application refused', async () => {
  const REF3 = 'PFA-V-2026-00009';
  await H.seed(W.db, REF3, { kind: 'PFA-V' });
  const shortlist = await H.call(CASE(), { body: { reference: REF3, action: 'status', status: 'shortlisted' } });
  assert.equal(shortlist.statusCode, 200);
  const handled = await H.call(CASE(), { body: { reference: REF3, action: 'status', status: 'handled' } });
  assert.equal(handled.statusCode, 400);
  const approved = await H.call(CASE(), { body: { reference: REF3, action: 'status', status: 'approved' } });
  assert.equal(approved.statusCode, 200);
  const t = await track(REF3);
  assert.equal(t.json.statusLabel, 'Approved');
  const panel = await H.call(CASE(), { method: 'GET', query: { reference: REF3 } });
  assert.equal(panel.json.case.statusLabel, 'Approved');
  const CG = 'PFA-CG-2026-00030';
  await H.seed(W.db, CG, { kind: 'PFA-CG', status: 'rejected', fields: { name: 'Meena Iyer', mobile: '9812345678', email: 'meena@example.com', address: '4 Lake Road, Chennai 600017' } });
  const ap = await H.call(CASE(), { body: { reference: CG, action: 'approve' } });
  assert.equal(ap.statusCode, 409);
  assert.equal(Object.keys(W.db.dump()).filter((k) => /^caretakerCards\/[^/]+$/.test(k)).length, 0);
});

test('A7a every case action has its audit row written before the answer', async () => {
  const REF = 'PFA-Q-2026-00010';
  await H.seed(W.db, REF);
  const realCollection = W.db.collection.bind(W.db);
  let written = 0;
  W.db.collection = (name) => {
    const c = realCollection(name);
    if (name !== 'adminAudit') return c;
    return Object.assign({}, c, { doc: (id) => Object.assign({}, c.doc(id), {
      create: (data) => new Promise((resolve) => setTimeout(() => { written += 1; resolve(c.doc(id).create(data)); }, 150))
    }) });
  };
  let n = 0;
  for (const body of [{ action: 'status', status: 'handled' }, { action: 'assign', to: 'k@pfa.test' }, { action: 'note', text: 'called them' }, { action: 'reply', text: 'done', requestId: 'r7' }]) {
    const res = await H.call(CASE(), { body: Object.assign({ reference: REF }, body) });
    n += 1;
    assert.equal(res.statusCode, 200, `${body.action} ${res.raw}`);
    assert.equal(written, n, `${body.action}: audit rows at answer time`);
  }
});

test('A7b a case taken up by the inbox gets its own status line', async () => {
  const REF = 'PFA-Q-2026-00016';
  await H.seed(W.db, REF);
  await fileIn({ messageId: '<madam-7@sansad.in>', from: `Gandhi M <${H.INBOX}>`, to: 'asha@example.com', subject: 'Re: ' + REF, inReplyTo: `<${REF}.abcdefabcdef.forward@peopleforanimalsindia.org>`, text: 'We will come at 5.' });
  const r = await H.rec(W.db, REF);
  assert.equal(r.status, 'in-progress');
  assert.ok(r.history.some((h) => h.status === 'in-progress' && !h.event), JSON.stringify(r.history));
});

test('A8 the old submission-status route leaves the same trail as the case drawer', async () => {
  const REF = 'PFA-Q-2026-00013';
  await H.seed(W.db, REF);
  await H.call(CASE(), { token: 'tok-a', body: { reference: REF, action: 'status', status: 'handled' } });
  const res = await H.call(STATUS(), { token: 'tok-b', body: { reference: REF, status: 'new', note: 'reopened: caller rang again' } });
  assert.equal(res.statusCode, 200);
  const r = await H.rec(W.db, REF);
  const last = r.history.at(-1);
  assert.equal(last.by, 'b@pfa.test');
  assert.equal(last.event, 'reopen');
  assert.equal(typeof last.at, 'string');
  assert.equal(typeof r.updatedAt, 'string');
  assert.ok(H.msgs(W.db, REF).some((m) => /reopened/.test(m.text || '')));
  assert.ok(Object.entries(W.db.dump()).some(([k, v]) => k.startsWith('adminAudit/') && v.actor.email === 'b@pfa.test'));
});

test('A9 approve needs the Caregivers module', async () => {
  const REF = 'PFA-CG-2026-00011';
  await H.seed(W.db, REF, { kind: 'PFA-CG', fields: { name: 'Meena Iyer', mobile: '9812345678', email: 'meena@example.com', address: '4 Lake Road, Chennai 600017', city: 'Chennai' } });
  const out = await H.call(CASE(), { token: 'tok-desk', body: { reference: REF, action: 'approve' } });
  assert.equal(out.statusCode, 403);
  assert.equal(Object.keys(W.db.dump()).filter((k) => /^caretakerCards\/[^/]+$/.test(k)).length, 0);
});

test('A10 conversation ordered by when PFA recorded it; the newest 200 are shown', async () => {
  const REF = 'PFA-Q-2026-00014';
  await H.seed(W.db, REF);
  await H.call(CASE(), { body: { reference: REF, action: 'reply', text: 'Can you send a photo?', requestId: 'q1' } });
  await H.sleep(5);
  await fileIn({ messageId: '<asha-9@example.com>', from: 'Asha Rao <asha@example.com>', subject: 'Re: ' + REF, inReplyTo: `<${REF}.abcdefabcdef.reply.1@peopleforanimalsindia.org>`, text: 'Here is the photo you asked for.', date: new Date('2026-10-01T09:00:00Z') });
  let c = (await H.call(CASE(), { method: 'GET', query: { reference: REF } })).json.case;
  const order = c.messages.filter((m) => m.type === 'reply').map((m) => m.direction);
  assert.deepEqual(order, ['out', 'in']);

  W.restore(); W = H.fresh({ latency: 0 });
  const REF2 = 'PFA-Q-2026-00015';
  await H.seed(W.db, REF2);
  for (let i = 0; i < 205; i += 1) await H.call(CASE(), { body: { reference: REF2, action: 'note', text: `note ${i}` } });
  c = (await H.call(CASE(), { method: 'GET', query: { reference: REF2 } })).json.case;
  assert.equal(c.messages.length, 200);
  assert.equal(c.messages.at(-1).text, 'note 204');
  assert.equal(c.messages[0].text, 'note 5');
  assert.equal(c.olderNotShown, 5);
});

test('A11 a report filed at 00:30 IST on 1 Jan 2027 is numbered in 2027 (intake and paid allocation)', async () => {
  const S = require('../lib/submissions');
  const at = Date.parse('2026-12-31T19:00:00Z');
  assert.equal(S.referenceYear(at), 2027);
  const ref = await S.allocateReference(W.db, 'PFA-MEM', at);
  assert.match(ref, /^PFA-MEM-2027-/);
  const h = TRACK()._private.createHandler({ getDb: () => W.db, deliver: async () => ({}), isConfigured: () => false, now: () => at });
  const res = await H.call(h, { token: null, body: { kind: 'PFA-Q', data: { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com' }, clientRequestId: 'y1' } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.match(res.json.reference, /^PFA-Q-2027-/);
});

test('A12 a register search that is not a reference is answered, never thrown at Firestore', async () => {
  const realCollection = W.db.collection.bind(W.db);
  W.db.collection = (name) => {
    const c = realCollection(name);
    const doc = c.doc;
    c.doc = (id) => { if (id != null && String(id).includes('/')) throw new Error('Value for argument "documentPath" must point to a document'); return doc(id); };
    return c;
  };
  const res = await H.call(RECORDS(), { method: 'GET', query: { type: 'submissions', q: 'PFA-Q/2026', search: 'PFA-Q/2026', term: 'PFA-Q/2026' } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.deepEqual(res.json.rows, []);
});
