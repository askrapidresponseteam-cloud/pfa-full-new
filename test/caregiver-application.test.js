'use strict';

/* The colony caregiver card is applied for, not helped oneself to.
   ₹50 confirms the application through CCAvenue, which mints an application
   number; a named person at PFA issues the card from the panel afterwards. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const payment = require('../lib/payment.js');
const flow = require('../lib/pfa-ccavenue-flow.js');
const S = require('../lib/submissions.js');

const ROOT = path.join(__dirname, '..');
const good = {
  type: 'caregiver-application', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com',
  address: 'Car Street colony, near the temple', city: 'Udupi', animals: '12',
  district: 'Udupi', state: 'Karnataka', pincode: '576101',
  documents: 'a'.repeat(48)   // the token /api/caregiver/documents issued for the photograph
};

test('the fee is fifty rupees and the browser cannot change it', () => {
  assert.equal(payment.CAREGIVER_APPLICATION_FEE, '50.00');
  const parsed = payment.parsePaymentRequest(good);
  assert.equal(parsed.amount, '50.00');
  assert.equal(parsed.currency, 'inr');
  /* The oldest trick: send your own amount. */
  const cheeky = payment.parsePaymentRequest({ ...good, amount: '1.00' });
  assert.equal(cheeky.amount, '50.00', 'the client must not set the fee');
});

test('an application without a colony or a city is refused', () => {
  assert.throws(() => payment.parsePaymentRequest({ ...good, address: '' }), /colony|locality|address/i);
  assert.throws(() => payment.parsePaymentRequest({ ...good, city: '' }), /city|town/i);
  assert.throws(() => payment.parsePaymentRequest({ ...good, mobile: '12345' }));
});

test('the payment carries what a reviewer needs to act on it', () => {
  const parsed = payment.parsePaymentRequest(good);
  assert.equal(parsed.customer.name, 'Asha Rao');
  assert.equal(parsed.metadata.city, 'Udupi');
  /* placeField title-cases, as it does for a donation address, so compare
     case-insensitively rather than assert the raw input came back. */
  assert.match(parsed.metadata.address, /car street colony, near the temple/i);
  /* District and state print on the card, so they must survive the parse. */
  assert.match(parsed.metadata.district, /udupi/i);
  assert.match(parsed.metadata.state, /karnataka/i);
  assert.match(parsed.merchantValues.merchant_param1, /Colony caregiver application/);
});

test('the application gets its own order prefix, and the callback accepts it', () => {
  const id = flow.createPfaOrderId('caregiver-application');
  assert.match(id, /^PFA-CGA-[A-Z0-9]{8}$/);
  const response = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  const guard = response.match(/\/\^PFA-\(\?:([A-Z|]+)\)-\[A-Z0-9\]\{8\}\$\//);
  assert.ok(guard, 'the order-id guard must exist');
  assert.ok(guard[1].split('|').includes('CGA'),
    'a paid application would be rejected as an invalid transaction id');
});

test('a verified payment creates a trackable record, and only one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  assert.match(src, /async function recordCaregiverApplication/);
  /* CCAvenue delivers the same callback more than once. */
  assert.match(src, /const existing = await settledReference\(orderId, transaction, 'applicationReference', firstSuccess\);\s*\n\s*if \(existing\) return existing;/,
    'a repeated callback must not mint a second application number');
  assert.match(src, /applicationReference: reference/, 'the number must be stored back on the transaction');
  assert.match(src, /collection\('submissions'\)\.doc\(reference\)\.create\(/,
    'create, not set: the number was just issued and must not merge into anything');
  assert.match(src, /payment: \{/, 'the panel should see the fee was paid without leaving the record');
});

test('the application number is short enough to read out', () => {
  assert.equal(S.KIND_LABELS['PFA-CG'], 'Colony caregiver application');
  assert.equal(S.formatReference('PFA-CG', 2026, 1), 'PFA-CG-2026-00001');
});

test('no card is issued by paying: instant issuance is retired', async () => {
  const handler = require('../lib/routes/caregiver/apply.js');
  const out = {};
  const res = { setHeader() {}, end(b) { out.body = b; }, set statusCode(v) { out.status = v; }, get statusCode() { return out.status; } };
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(out.status, 410);
  const body = JSON.parse(out.body);
  assert.equal(body.code, 'APPLY_MOVED');
  assert.match(body.where, /get-involved/);
});

test('the form posts to the payment endpoint, not to submissions', () => {
  const page = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  assert.match(page, /id="cgForm"[^>]*action="\/api\/payment\/create"/);
  assert.match(page, /name="type" value="caregiver-application"/);
  /* A real navigation is required - CCAvenue's page has to replace this one. */
  assert.ok(!/PFAForms\.wire\(form, \{\s*kind: 'PFA-CG'/.test(page),
    'the caregiver form must not be sent by fetch');
  for (const field of ['name', 'mobile', 'email', 'address', 'city', 'animals', 'notes']) {
    assert.match(page, new RegExp(`name="${field}"`), `the form must send ${field}`);
  }
});

test('the page says what the fee is and is not', () => {
  const page = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  assert.match(page, /not issued on the spot/i);
  assert.match(page, /not payment for a card/i, 'paying must not read as buying');
});

test('nothing is called a caretaker any more', () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.git|_inline-extracts/.test(e.name)) walk(full); }
      else if (/\.(js|html)$/.test(e.name)) files.push(full);
    }
  }(ROOT));
  /* The Firestore collection names and the PFA-CCT card prefix are deliberate
     survivors: renaming them orphans stored records. Everything else goes. */
  const allowed = /caregiverCards|caregiverPublic|caretakerCards|caretakerPublic|caretakerApplicants|caretakerAddresses|caretakerOrders|caretakerShipments|caretakerAudit|caretakerIds|PFA-CCT/;
  const hits = [];
  for (const file of files) {
    /* This file names the survivors in order to allow them; scanning itself
       reports its own allow-list as violations. */
    if (path.basename(file) === 'caregiver-application.test.js') continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/caretaker/i.test(line)) return;
      if (allowed.test(line)) return;
      hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `still says caretaker: ${hits.join(', ')}`);
});
