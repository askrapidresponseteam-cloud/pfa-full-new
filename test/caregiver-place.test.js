'use strict';

/* The district and the state on the back of the colony caregiver card.

   Owner, 22 Oct 2026, with the drawer's preview of Dr Gurmeet Mangat's card
   showing "-" under DISTRICT and STATE: "why no address is being printed
   properly". The form asks for both and the payment kept them, but the
   record filed after payment left them out, and neither the drawer's
   preview nor Issue cards handed them to the renderer. These hold every
   link of that chain. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const PLACE = require('../lib/caregiver-place');

const ROOT = path.join(__dirname, '..');
const NOW = Date.UTC(2026, 9, 22, 12);

const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL', 'PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_IMAP_USER', 'PFA_MAIL_FROM'];
const saved = {};
test.beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => {
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const PAID = (over) => Object.assign({
  type: 'caregiver-application', status: 'success', amount: 50, currency: 'inr',
  customer: { name: 'Gurmeet Mangat', mobile: '9876543210', email: 'gurmeet@example.com' },
  metadata: { address: 'Sector 15, near the park', city: 'Chandigarh', district: 'Chandigarh', state: 'Chandigarh', pin: '160015', animals: '12', notes: '', documents: '' },
  ccaVenue: { responseStatus: 'Success', trackingId: 't1', bankReference: 'b1', paymentMode: 'UPI' },
  createdAt: new Date(NOW).toISOString()
}, over || {});

test('a paid application is filed with the district and state the applicant picked', async () => {
  const db = memoryFirestore();
  firebase._setDbForTests(db);
  await db.collection('transactions').doc('PFA-CGA-1').set(PAID());
  const { refile } = require('../lib/routes/payment/response.js');
  const out = await refile({ orderId: 'PFA-CGA-1', baseUrl: 'https://pfa.test' });
  assert.equal(out.ok, true, JSON.stringify(out));
  const record = (await db.collection('submissions').doc(out.reference).get()).data();
  assert.equal(record.kind, 'PFA-CG');
  assert.equal(record.fields.district, 'Chandigarh');
  assert.equal(record.fields.state, 'Chandigarh');
  assert.equal(record.fields.city, 'Chandigarh', 'the city is kept as given');
});

test('an older record is read back from its payment, then from its city, never guessed', async () => {
  const db = memoryFirestore();
  await db.collection('transactions').doc('PFA-CGA-2').set(PAID());
  const old = { kind: 'PFA-CG', fields: { name: 'Gurmeet Mangat', city: 'Chandigarh' }, payment: { orderId: 'PFA-CGA-2' } };
  assert.deepEqual(await PLACE.placeOf(db, old), { district: 'Chandigarh', state: 'Chandigarh' }, 'from the payment');
  /* its own fields come first */
  assert.deepEqual(await PLACE.placeOf(db, { fields: { district: 'Udupi', state: 'Karnataka' }, payment: { orderId: 'PFA-CGA-2' } }), { district: 'Udupi', state: 'Karnataka' });
  /* no payment to read: a city that is one district's name */
  assert.deepEqual(await PLACE.placeOf(db, { fields: { city: 'udupi' } }), { district: 'Udupi', state: 'Karnataka' });
  /* two districts share the name: nothing rather than the wrong state */
  assert.deepEqual(await PLACE.placeOf(db, { fields: { city: 'Aurangabad' } }), { district: '', state: '' });
  assert.deepEqual(await PLACE.placeOf(db, { fields: { city: 'Car Street' } }), { district: '', state: '' });
  /* withPlace touches only caregiver applications, and writes nothing */
  const filled = await PLACE.withPlace(db, old);
  assert.equal(filled.fields.district, 'Chandigarh');
  assert.equal(filled.fields.name, 'Gurmeet Mangat');
  assert.equal(old.fields.district, undefined, 'the record as filed is left alone');
  const other = { kind: 'PFA-C', fields: { city: 'Udupi' } };
  assert.equal(await PLACE.withPlace(db, other), other);
});

/* ---- the drawer and the approval -------------------------------------------- */

function request({ method = 'POST', body, query = {} } = {}) {
  const r = new EventEmitter(); r.method = method; r.query = query; r.headers = {};
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
function run(handler, req) {
  return new Promise((resolve) => {
    const out = { statusCode: 200, headers: {} };
    const res = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[n.toLowerCase()] = v; }, getHeader(n) { return out.headers[n.toLowerCase()]; },
      end(b) { out.body = b ? JSON.parse(b) : null; resolve(out); }
    };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ statusCode: 500, body: { message: e.message } }));
  });
}

test('the drawer shows an older application with its place, and the card is issued with it', async () => {
  const db = memoryFirestore();
  await db.collection('transactions').doc('PFA-CGA-3').set(PAID());
  await db.collection('submissions').doc('PFA-CG-2026-00007').set({
    reference: 'PFA-CG-2026-00007', kind: 'PFA-CG', status: 'new', attachments: 1,
    fields: { name: 'Gurmeet Mangat', mobile: '9876543210', email: 'gurmeet@example.com', address: 'Sector 15, near the park', city: 'Chandigarh', pin: '160015' },
    payment: { orderId: 'PFA-CGA-3' }, createdAt: new Date(NOW).toISOString(), history: [{ status: 'new', at: new Date(NOW).toISOString() }]
  });
  const issued = [];
  const { createHandler } = require('../lib/routes/admin/case')._private;
  const handler = createHandler({
    getDb: () => db, fieldValue: () => firebase.fieldValue ? firebase.fieldValue() : {}, now: () => NOW,
    requireAdmin: async () => ({ email: 'admin@pfa.test', role: 'super' }),
    deliver: async () => ({ providerId: 'p' }), isConfigured: () => false,
    issueCard: async ({ application }) => { issued.push(application); return { card: { cardId: 'PFA-CCT-GM000001', name: application.name, issuedAt: 'i', validUntil: 'v' }, reissued: false, sameRequest: false }; },
    queueEmail: async () => ({ emailId: 'e', created: true }), recordEmailResult: async () => {}
  });
  const seen = await run(handler, request({ method: 'GET', query: { reference: 'PFA-CG-2026-00007' } }));
  assert.equal(seen.statusCode, 200, JSON.stringify(seen.body));
  assert.equal(seen.body.case.fields.district, 'Chandigarh', 'the preview has a district to print');
  assert.equal(seen.body.case.fields.state, 'Chandigarh');
  const approved = await run(handler, request({ body: { reference: 'PFA-CG-2026-00007', action: 'approve' } }));
  assert.equal(approved.body && approved.body.ok, true, JSON.stringify(approved.body));
  assert.equal(issued[0].district, 'Chandigarh', 'the card is issued with its district');
  assert.equal(issued[0].state, 'Chandigarh', 'and its state');
});

test('a card already issued without its place gets it from its application, once', async () => {
  const db = memoryFirestore();
  await db.collection('transactions').doc('PFA-CGA-4').set(PAID());
  await db.collection('submissions').doc('PFA-CG-2026-00008').set({ kind: 'PFA-CG', fields: { name: 'Gurmeet Mangat', city: 'Chandigarh' }, payment: { orderId: 'PFA-CGA-4' } });
  await db.collection('caretakerCards').doc('PFA-CCT-GM000002').set({ name: 'Gurmeet Mangat', status: 'active', validUntil: '2029-01-01T00:00:00.000Z', applicationRef: 'PFA-CG-2026-00008', address: 'Sector 15', pin: '160015' });
  await db.collection('caretakerPublic').doc('PFA-CCT-GM000002').set({ cardId: 'PFA-CCT-GM000002', name: 'Gurmeet Mangat' });
  /* and one with no public record, which must not gain one made of a place */
  await db.collection('caretakerCards').doc('PFA-CCT-GM000003').set({ name: 'Second', status: 'active', validUntil: '2029-01-01T00:00:00.000Z', applicationRef: 'PFA-CG-2026-00008' });
  const { listCaregivers } = require('../lib/routes/admin/cards.js')._private;
  /* the memory store does not order by document name; the register's read is all this needs */
  const byName = { collection: (c) => {
    const col = db.collection(c);
    return { doc: (id) => col.doc(id), orderBy: () => ({ limit: () => ({ get: () => col.get() }) }) };
  } };
  const listed = await listCaregivers(byName, NOW);
  const row = listed.rows.find((r) => r.id === 'PFA-CCT-GM000002');
  assert.equal(row.district, 'Chandigarh');
  assert.equal(row.placeState, 'Chandigarh');
  assert.equal(row.state, 'valid', 'the row keeps its standing under "state"');
  assert.equal((await db.collection('caretakerCards').doc('PFA-CCT-GM000002').get()).data().district, 'Chandigarh', 'written onto the card');
  assert.equal((await db.collection('caretakerPublic').doc('PFA-CCT-GM000002').get()).data().state, 'Chandigarh', 'and its public record');
  assert.equal((await db.collection('caretakerPublic').doc('PFA-CCT-GM000003').get()).exists, false);
});

test('the drawer preview and the print sheet hand the district and state to the renderer', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  /* the drawer's card data (caseCardData), drawn by previewCard and the card studio */
  const preview = html.slice(html.indexOf('function caseCardData('), html.indexOf('function previewCard('));
  assert.match(preview, /district: f\.district \|\| ''/);
  assert.match(preview, /state: f\.state \|\| ''/);
  const sheet = html.slice(html.indexOf('function cardData('), html.indexOf('function cardsPane('));
  assert.match(sheet, /district: row\.district \|\| ''/);
  assert.match(sheet, /state: row\.placeState \|\| ''/);
  /* and the renderer prints what it is handed, in the card's print form
     (assets/card-print.js, 24 Oct 2026) */
  const card = fs.readFileSync(path.join(ROOT, 'assets', 'caregiver-card.js'), 'utf8');
  assert.match(card, /if \(key === 'district' \|\| key === 'state'\) \{[\s\S]{0,200}var place = String\(data\[key\] \|\| ''\);[\s\S]{0,80}PR\.placeName\(place\)/);
});
