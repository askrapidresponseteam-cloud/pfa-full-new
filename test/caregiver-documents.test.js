'use strict';
/* A colony caregiver application carries two pictures: the applicant's
   photograph (it prints on the card) and a proof of address (the reviewer
   checks the colony against it). They go to /api/caregiver/documents before
   the fee, ride along as a token, and are moved beside the application when
   the fee clears - where the panel shows them, labelled. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const payment = require('../lib/payment.js');
const documents = require('../lib/routes/caregiver/documents.js');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 5)]);
const url = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;

function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) { if (store.has(key(c, id))) throw new Error('exists'); store.set(key(c, id), Object.assign({}, data)); },
    async set(data, opts) { const prev = (opts && opts.merge && store.get(key(c, id))) || {}; store.set(key(c, id), Object.assign({}, prev, data)); },
  });
  return { store, collection: (c) => ({ doc: (id) => docRef(c, id) }) };
}
function request(body) {
  const r = new EventEmitter(); r.method = 'POST'; r.headers = {}; r.query = {};
  process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
async function run(handler, req) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(req, res); return res;
}


test('the fee cannot be started without the photograph', () => {
  /* The proof of address was dropped in v1.293; the photograph, which prints
     on the card, is the one document the fee still cannot start without. */
  const good = { type: 'caregiver-application', name: 'Asha Rao', mobile: '9876543210', email: 'a@b.in', house: '12', street: 'Car Street', colony: 'Car Street colony', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pincode: '576101' };
  assert.throws(() => payment.parsePaymentRequest(good), /photograph/i);
  assert.throws(() => payment.parsePaymentRequest({ ...good, documents: 'not-a-token' }), /photograph/i);
  const parsed = payment.parsePaymentRequest({ ...good, documents: 'b'.repeat(48) });
  assert.equal(parsed.metadata.documents, 'b'.repeat(48), 'the token travels with the transaction');
});

test('the photograph is checked by its bytes and held under a token; the token is moved beside the paid application, labelled', async () => {
  const db = fakeDb();
  const route = documents._private.createHandler({ getDb: () => db });
  {
    /* Since v1.293 the photograph is the only document asked for. A proof
       still arriving from an old tab is kept beside it rather than refused. */
    const alone = await run(route, request({ photo: url('image/jpeg', JPEG) }));
    assert.equal(alone.body.ok, true, 'the photograph alone is enough: ' + JSON.stringify(alone.body));
    assert.ok(documents.isToken(alone.body.token));
    const junk = await run(route, request({ photo: url('image/jpeg', Buffer.from('<html>')) }));
    assert.equal(junk.body.ok, false); assert.equal(junk.body.field, 'photo');
    const badProof = await run(route, request({ photo: url('image/jpeg', JPEG), proof: url('image/png', Buffer.from('<html>')) }));
    assert.equal(badProof.body.ok, false, 'a proof that is sent is still checked by its bytes'); assert.equal(badProof.body.field, 'proof');

    const ok = await run(route, request({ photo: url('image/jpeg', JPEG), proof: url('image/png', PNG) }));
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
    assert.ok(documents.isToken(ok.body.token));
    assert.ok(db.store.get(`caregiverDocuments/${ok.body.token}/attachments/1`), 'held until the fee clears');

    /* the fee clears: response.js calls attachTo */
    const ref = db.collection('submissions').doc('PFA-CG-2026-00001');
    const attached = await documents.attachTo(db, ok.body.token, ref, new Date().toISOString());
    assert.equal(attached, 2);
    const face = db.store.get('submissions/PFA-CG-2026-00001/attachments/1');
    const proof = db.store.get('submissions/PFA-CG-2026-00001/attachments/2');
    assert.equal(face.label, 'Photograph'); assert.equal(face.contentType, 'image/jpeg');
    assert.equal(proof.label, 'Address proof'); assert.equal(proof.contentType, 'image/png');
    const staged = db.store.get(`caregiverDocuments/${ok.body.token}`);
    assert.equal(staged.consumed, true, 'the staging copy is marked used, not deleted');
    assert.equal(db.store.get(`caregiverDocuments/${ok.body.token}/attachments/1`).bytes, null, 'and its bytes are dropped');

    /* A replayed callback copies nothing a second time, and says how many
       pictures are already beside the record, so the record it updates keeps
       the right count (8 Oct 2026: it used to answer 0, and a record written
       from that answer would have claimed no pictures). */
    const before = [...db.store.keys()].filter((k) => k.startsWith('submissions/')).length;
    assert.equal(await documents.attachTo(db, ok.body.token, ref, new Date().toISOString()), 2);
    assert.equal([...db.store.keys()].filter((k) => k.startsWith('submissions/')).length, before, 'nothing copied twice');
  }
});

test('the record, the route and the panel agree', () => {
  const response = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  assert.match(response, /documents\.attachTo\(db, meta\.documents/, 'the pictures are attached when the fee clears');
  assert.match(response, /attachments: attached,/, 'and the record says how many, written once');
  const attachment = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'attachment.js'), 'utf8');
  assert.match(attachment, /label: data\.label/, 'the label reaches the panel');
  const panel = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(panel, /figcaption/, 'and is shown under the picture');
  assert.match(panel, /Photograph and address proof/);
  const api = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  assert.match(api, /'caregiver\/documents'/, 'the route is mounted');
});

test('the form asks for the photograph on the About-you step and sends it before the fee', () => {
  /* The proof of address went in v1.293: the photograph prints on the card
     and is the only document the form asks for. If a proof input returns,
     the removal has been undone without being reviewed. */
  const page = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  const form = page.slice(page.indexOf('id="cgForm"'), page.indexOf('</form>', page.indexOf('id="cgForm"')));
  assert.match(form, /name="documents" id="cgDocuments"/);
  assert.match(form, /data-doc="photo"[\s\S]*id="cgPhoto" type="file" accept="image\/\*"/);
  assert.ok(!/cgProof|data-doc="proof"/.test(form), 'no proof of address is asked for');
  const aboutYou = form.slice(form.indexOf('data-step="About you"'), form.indexOf('data-step="Your colony"'));
  assert.ok(aboutYou.includes('cgPhoto'), 'the photograph sits on the About-you step');
  assert.ok(form.includes('id="cgState"') && form.includes('id="cgDistrict"'), 'district and state print on the card, so the form asks for them');
  assert.match(page, /fetch\('\/api\/caregiver\/documents'/);
  assert.match(page, /PFA_CG_DOCS/, 'the stepper refuses Continue without them');
});
