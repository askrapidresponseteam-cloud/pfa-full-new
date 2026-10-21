'use strict';

/* Regressions at the seams between the six fixes (8 Oct 2026 merge). Each
   test states the CORRECT behaviour; a failure is a problem in the merged
   tree. */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
let W;
test.beforeEach(() => {
  W = H.fresh();
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AV', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PFA_SUBMISSIONS_INBOX: H.INBOX });
});
test.afterEach(() => { W.restore(); require('../lib/file-store')._reset(); });

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
async function start(form) {
  const r = await H.call(require('../lib/routes/payment/create'), { token: null, body: form, headers: FORM });
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(r.raw);
  assert.ok(enc, r.raw.slice(0, 400));
  return decodeMerchantData(decrypt(enc[1], KEY));
}
async function callback(out) {
  const encResp = encrypt(encodeMerchantData({ order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '310009876543', bank_ref_no: 'BNK1', payment_mode: 'UPI' }), KEY);
  return (await H.call(require('../lib/routes/payment/response'), { token: null, body: { encResp }, headers: FORM, url: '/api/payment/response' })).raw;
}
const PERSON = { name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', district: 'Udupi' };
const Q = { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', state: 'Delhi', city: 'New Delhi', name: 'Asha Rao', mobile: '9876543210', email: 'asha.rao@example.com' };

/* ---- payment/response.js fileOnce + lib/submissions.js allocateReference ---- */
test('SEAM-1 a paid membership whose counter is behind the records gets its OWN record, never someone else\'s', async () => {
  /* another member's record already holds 00001 (a counter reset, a restore) */
  await W.db.collection('submissions').doc('PFA-MEM-2026-00001').set({
    reference: 'PFA-MEM-2026-00001', kind: 'PFA-MEM', status: 'new', threadId: 'aaaaaaaaaaaa', createdAt: '2026-01-02T00:00:00.000Z', receivedAtMs: 1,
    fields: { name: 'Ravi Earlier', email: 'ravi@example.com', mobile: '9811111111', orderId: 'PFA-MEM-OLDOLD01' }
  });
  const out = await start(Object.assign({ type: 'membership', tier: 'silver', terms: 'yes' }, PERSON));
  const page = await callback(out);
  const tx = W.db.dump()[`transactions/${out.order_id}`];
  const rec = W.db.dump()[`submissions/${tx.membershipReference}`];
  assert.ok(rec, 'a record under the number on the payment');
  assert.equal(rec.fields.orderId, out.order_id, `payment ${out.order_id} was filed under ${tx.membershipReference}, whose record is order ${rec.fields.orderId} (${rec.fields.name})`);
  assert.ok(!page.includes('PFA-MEM-2026-00001') || rec.fields.orderId === out.order_id);
});

/* ---- pfa-submissions.js fileOnce: counter behind by more than four ---- */
test('SEAM-2 a counter behind the records by five or more does not refuse every submission of the kind', async () => {
  for (let n = 1; n <= 6; n += 1) {
    const ref = `PFA-Q-2026-${String(n).padStart(5, '0')}`;
    await W.db.collection('submissions').doc(ref).set({ reference: ref, kind: 'PFA-Q', status: 'new', createdAt: '2026-01-02T00:00:00.000Z', receivedAtMs: n, fields: {} });
  }
  const route = require('../lib/routes/pfa-submissions');
  const a = await H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'behind-1' } });
  const b = await H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'behind-2' } });
  assert.equal(a.statusCode, 200, a.raw);
  assert.equal(b.statusCode, 200, b.raw);
});

/* ---- payment/response.js photoPending + submission-forward.js dedupe key ---- */
test('SEAM-3 a caregiver photo attached on a later callback still reaches the payments inbox', async () => {
  const FILES = require('../lib/file-store');
  let readable = true;
  const box = H.memoryBucket('pfa-new-website.firebasestorage.app', { failRead: (p) => !readable && p.startsWith('caregiver-staging/') });
  FILES._setBucket(() => box.where);
  const r = await H.call(require('../lib/routes/caregiver/documents'), { token: null, body: { photo: 'data:image/jpeg;base64,' + H.jpeg(5000).toString('base64') } });
  const out = await start(Object.assign({ type: 'caregiver-application', documents: r.json.token }, PERSON));
  readable = false;            // Storage does not answer during the first callback
  const orig = console.error; console.error = () => {};
  try { await callback(out); } finally { console.error = orig; }
  readable = true;
  await callback(out);         // the redelivery (or the panel's repair) attaches it
  const rec = W.db.dump()['submissions/PFA-CG-2026-00001'];
  assert.equal(rec.attachments, 1);
  /* a caregiver application is a record of money: its copies, the late
     photograph's included, go to the payments inboxes, never gandhim */
  assert.equal(W.smtp.sent.filter((m) => m.to === H.INBOX).length, 0);
  const toInbox = W.smtp.sent.filter((m) => m.to === 'pfadcmho@gmail.com');
  assert.ok(toInbox.some((m) => (m.attachments || []).length > 0),
    `copies to the inbox: ${toInbox.length}, with the photo: ${toInbox.filter((m) => (m.attachments || []).length).length}`);
});

/* ---- lib/submissions.js clientIp on Firebase behind Firebase Hosting ---- */
test('SEAM-4 (assumes Hosting appends its own hop) two different people behind the same Firebase Hosting hop do not share one brake', async () => {
  process.env.K_SERVICE = 'api';
  const route = require('../lib/routes/pfa-submissions');
  const HOP = '35.191.10.20';
  for (let i = 0; i < 30; i += 1) await H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'a' + i }, headers: { 'x-forwarded-for': `198.51.100.7, ${HOP}` } });
  const other = await H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'b0' }, headers: { 'x-forwarded-for': `203.0.113.55, ${HOP}` } });
  assert.notEqual(other.statusCode, 429, 'a stranger is braked by someone else\'s thirty submissions');
});

/* ---- intake transaction + email queue: a resumed request while the first still sends ---- */
test('SEAM-5 a double submit while the first is still emailing sends one confirmation and one forward', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  W.smtp.hold = async () => { await gate; };
  const route = require('../lib/routes/pfa-submissions');
  const body = { kind: 'PFA-Q', data: Q, clientRequestId: 'dbl' };
  const first = H.call(route, { token: null, body });
  await H.sleep(120);
  const second = H.call(route, { token: null, body });
  await H.sleep(120);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.json.reference, b.json.reference);
  assert.equal(W.smtp.sent.filter((m) => m.to === 'asha.rao@example.com').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === H.INBOX).length, 1);
});

/* ---- case.js reply + inbound-mail.js take-up/reopen, all at once ---- */
test('SEAM-6 a staff close, a staff reply and the person writing back, all at once, leave a consistent case', async () => {
  const REF = 'PFA-Q-2026-00040';
  await H.seed(W.db, REF, { status: 'in-progress', handledBy: 'a@pfa.test' });
  const INB = require('../lib/inbound-mail');
  const CASE = require('../lib/routes/admin/case');
  const [close, reply, filed] = await Promise.all([
    H.call(CASE, { token: 'tok-b', body: { reference: REF, action: 'status', status: 'handled', note: 'Done' } }),
    H.call(CASE, { token: 'tok-a', body: { reference: REF, action: 'reply', text: 'On it', requestId: 's6' } }),
    INB.file(W.db, { messageId: '<p-s6@example.com>', from: 'Asha Rao <asha@example.com>', subject: 'Re: ' + REF, inReplyTo: `<${REF}.abcdefabcdef.confirm@peopleforanimalsindia.org>`, text: 'Still bleeding', date: new Date() }, { inboxes: [H.INBOX], fieldValue: H.firebase.fieldValue })
  ]);
  assert.equal(close.statusCode, 200); assert.equal(reply.statusCode, 200); assert.equal(filed.filed, true);
  const r = await H.rec(W.db, REF);
  assert.equal(r.replyCount, 2);
  /* whichever order they landed in, the status matches the last status row in history */
  const lastStatusRow = r.history.filter((h) => !h.event || h.event === 'reopen').at(-1);
  assert.equal(r.status, lastStatusRow.status, JSON.stringify(r.history));
  if (r.status === 'handled') assert.equal(r.handledNote, 'Done');
  if (r.status === 'new') assert.equal(r.handledBy, '');
});

/* ---- inbound relay + queue lease: two readings of the mailbox at once ---- */
test('SEAM-7 two mailbox readings at once file and relay the person\'s email once', async () => {
  const REF = 'PFA-Q-2026-00041';
  await H.seed(W.db, REF);
  const INB = require('../lib/inbound-mail');
  const msg = { uid: 9, from: 'asha@example.com', fromName: 'Asha Rao', to: [H.SITE_MAILBOX], cc: [], subject: 'Re: ' + REF, messageId: '<p-s7@example.com>', inReplyTo: [`<${REF}.abcdefabcdef.confirm@peopleforanimalsindia.org>`], references: [], text: 'More detail', newText: 'More detail', date: new Date(), attachments: [], reportParts: [], autoReply: '', bounce: false };
  const read = async () => ({ messages: [Object.assign({}, msg)], uids: [9], failed: [], lastUid: 9, uidValidity: '1', host: 'imap.test' });
  const o = { read, mail: H.mailer, queue: require('../lib/caregiver-store'), inboxes: [H.INBOX], fieldValue: H.firebase.fieldValue };
  await Promise.all([INB.check(W.db, o), INB.check(W.db, o)]);
  assert.equal(H.msgs(W.db, REF).filter((m) => m.direction === 'in').length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === H.INBOX).length, 1);
  assert.equal((await H.rec(W.db, REF)).replyCount, 1);
});

/* ---- claimRecordReference + allocateReference: different kinds, same counter doc ---- */
test('SEAM-8 a donation, a membership and an intake report filed at the same moment all get numbers (one counter document)', async () => {
  const don = await start(Object.assign({ type: 'donate', currency: 'inr', amount: '1500', terms: 'yes' }, PERSON));
  const mem = await start(Object.assign({ type: 'membership', tier: 'silver', terms: 'yes' }, PERSON));
  const route = require('../lib/routes/pfa-submissions');
  const [, , q1, q2] = await Promise.all([callback(don), callback(mem),
    H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'm1' } }),
    H.call(route, { token: null, body: { kind: 'PFA-Q', data: Q, clientRequestId: 'm2' } })]);
  assert.equal(q1.statusCode, 200); assert.equal(q2.statusCode, 200);
  assert.notEqual(q1.json.reference, q2.json.reference);
  const d = W.db.dump();
  assert.ok(d[`transactions/${don.order_id}`].donationReference);
  assert.ok(d[`transactions/${mem.order_id}`].membershipReference);
});

/* ---- documents.attachTo + file-store readStrict: an inline (Firestore) staging copy ---- */
test('SEAM-9 a staging photo kept inline in Firestore (no bucket) is attached and read back', async () => {
  require('../lib/file-store')._setBucket(() => null);
  const r = await H.call(require('../lib/routes/caregiver/documents'), { token: null, body: { photo: 'data:image/jpeg;base64,' + H.jpeg(4000).toString('base64') } });
  const out = await start(Object.assign({ type: 'caregiver-application', documents: r.json.token }, PERSON));
  await callback(out);
  const d = W.db.dump();
  assert.equal(d['submissions/PFA-CG-2026-00001'].attachments, 1);
  const bytes = await require('../lib/file-store').readStrict(d['submissions/PFA-CG-2026-00001/attachments/1']);
  assert.equal(bytes.length, 4000);
  assert.equal(d[`transactions/${out.order_id}`].applicationReference, 'PFA-CG-2026-00001');
});
