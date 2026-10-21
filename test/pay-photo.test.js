'use strict';

/* A paid colony caregiver application keeps its record and its photograph
   (8 Oct 2026, reviews B4, D4 and D5).

   Before: the photograph was moved beside a freshly minted number and the
   staging copy consumed BEFORE the record was written. A failed record write
   left the photo under a number that never existed, and the redelivered
   callback minted a second number with no photo. A photo that could not be
   read just then (no bucket on that instance, a timeout) was recorded with
   no bytes, still counted, and the staging copy consumed: the photo was
   linked to nothing, for good, and a retry attached nothing.

   Now the number is fixed on the payment first, the record is created
   first, and the photograph is attached all or nothing; a record whose photo
   could not be attached says photoPending: true until a later try finishes
   the job under the same number. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const FILES = require('../lib/file-store');
const caregiverMail = require('../lib/caregiver-mail');
const documents = require('../lib/routes/caregiver/documents');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const YEAR = new Date().getUTCFullYear();
const JPEG = fs.readFileSync(path.join(__dirname, '..', 'media/cinekind-2026/reels/glimpse.jpg'));
const PHOTO = 'data:image/jpeg;base64,' + JPEG.toString('base64');
const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };

/* A Storage bucket held in memory, in the shape lib/file-store.js uses. */
function memoryBucket(name) {
  const files = new Map();
  const bucket = {
    file: (p) => ({
      async save(b) { files.set(p, Buffer.from(b)); },
      async download() { if (!files.has(p)) throw new Error('404 No such object'); return [files.get(p)]; }
    })
  };
  return { files, where: { name, bucket } };
}

let db;
let sent;
const realDeliver = caregiverMail.deliver;
const realConfigured = caregiverMail.isConfigured;

test.beforeEach(() => {
  db = memoryFirestore({ latency: 1 });
  firebase._setDbForTests(db);
  sent = [];
  caregiverMail.deliver = async (m) => { sent.push(m); return { providerId: `p${sent.length}` }; };
  caregiverMail.isConfigured = () => true;
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: KEY, CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://pfa.test' });
});

/* Storage that cannot answer just now (a 503), for the reads that must not
   lose a photograph. */
const UNREADABLE = () => ({
  file: () => ({
    async save() { throw Object.assign(new Error('503 backend error'), { code: 503 }); },
    async download() { throw Object.assign(new Error('503 backend error'), { code: 503 }); }
  })
});
const REAL_STRICT = FILES.readStrict;

test.afterEach(() => {
  FILES._reset();
  FILES.readStrict = REAL_STRICT;
  firebase._setDbForTests(null);
  caregiverMail.deliver = realDeliver;
  caregiverMail.isConfigured = realConfigured;
});

function call(handler, { body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {},
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { /* a page */ } resolve(out); }
    };
    Promise.resolve(handler({ method: 'POST', url: '/api', body, headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '203.0.113.7' }, headers) }, response)).catch(reject);
  });
}

async function stagePhoto() {
  const res = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO }, headers: { 'content-type': 'application/json' } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 200));
  return res.json.token;
}

async function apply(token) {
  const res = await call(require('../lib/routes/payment/create'), { body: { type: 'caregiver-application', documents: token, animals: '12', ...PERSON } });
  return decodeMerchantData(decrypt(/name="encRequest" value="([0-9a-f]+)"/.exec(res.raw)[1], KEY));
}

function callback(out) {
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI' };
  return call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), KEY) } });
}

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const records = () => Object.entries(db.dump()).filter(([k, v]) => /^submissions\/[^/]+$/.test(k) && v.kind === 'PFA-CG').map(([k]) => k.split('/')[1]);
const attachmentDocs = () => Object.keys(db.dump()).filter((k) => /^submissions\/[^/]+\/attachments\//.test(k));

test('a record write that fails once: the redelivery files the same number, with the photograph, and nothing is orphaned', async () => {
  const token = await stagePhoto();
  const out = await apply(token);
  const original = db.collection;
  let failOnce = true;
  db.collection = (name) => {
    const c = original(name);
    if (name !== 'submissions') return c;
    const doc = c.doc;
    c.doc = (id) => {
      const d = doc(id);
      const create = d.create;
      d.create = async (v) => {
        if (failOnce && /^PFA-CG-\d{4}-\d+$/.test(id)) { failOnce = false; throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }); }
        return create(v);
      };
      return d;
    };
    return c;
  };
  await quiet(() => callback(out));
  db.collection = original;
  assert.deepEqual(records(), [], 'the write failed: no record yet');
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, false, 'and the photograph is still waiting in staging');

  const again = await callback(out);
  const ref = `PFA-CG-${YEAR}-00001`;
  assert.deepEqual(records(), [ref], 'the same number, not a second one');
  assert.match(again.raw, new RegExp(ref));
  const record = db.dump()[`submissions/${ref}`];
  assert.equal(record.attachments, 1);
  assert.equal(record.photoPending, false);
  assert.deepEqual(attachmentDocs(), [`submissions/${ref}/attachments/1`], 'the photograph is beside the record it belongs to');
  assert.equal((db.dump()['counters/submissions'] || {})[`PFA-CG-${YEAR}`], 1, 'no number skipped');
});

test('a photograph that cannot be read when the fee clears: the record is filed, flagged, and the next callback attaches it', async () => {
  const box = memoryBucket('pfa-new-website.firebasestorage.app');
  FILES._setBucket(() => box.where);
  const token = await stagePhoto();
  assert.ok(box.files.get(`caregiver-staging/${token}/1`), 'staged in the bucket');
  const out = await apply(token);

  FILES._setBucket(() => null);   // the callback lands on an instance that has no bucket just now
  FILES._setStorage(UNREADABLE);  // and Storage cannot answer its read either
  const first = await quiet(() => callback(out));
  const ref = `PFA-CG-${YEAR}-00001`;
  assert.match(first.raw, /successful/, 'the fee is taken: the page says so');
  assert.match(first.raw, new RegExp(ref), 'and gives the number');
  let record = db.dump()[`submissions/${ref}`];
  assert.ok(record, 'a paid application has its record even without the photograph');
  assert.equal(record.photoPending, true, 'flagged for the panel');
  assert.equal(record.attachments, 0, 'and not counted as attached');
  assert.deepEqual(attachmentDocs(), [], 'no attachment pointing at nothing');
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, false, 'the staging copy is not used up');
  assert.equal(box.files.get(`caregiver-staging/${token}/1`).length, JPEG.length, 'and its bytes are intact');
  assert.equal(db.dump()[`transactions/${out.order_id}`].applicationReference, undefined, 'the payment is not marked filed');

  FILES._setStorage(null);
  FILES._setBucket(() => box.where);   // Storage is back; CCAvenue redelivers
  const second = await callback(out);
  assert.match(second.raw, new RegExp(ref), 'the same number');
  assert.deepEqual(records(), [ref]);
  record = db.dump()[`submissions/${ref}`];
  assert.equal(record.photoPending, false);
  assert.equal(record.attachments, 1);
  const attached = db.dump()[`submissions/${ref}/attachments/1`];
  assert.equal(attached.storage, 'gcs');
  assert.equal((await FILES.read(attached)).length, JPEG.length, 'the panel can read it');
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, true);
  assert.equal(db.dump()[`transactions/${out.order_id}`].applicationReference, ref, 'now the payment is filed');
});

test('attachTo aborts without consuming when a file cannot be read, with readStrict or the old read', async () => {
  const box = memoryBucket('pfa-new-website.firebasestorage.app');
  FILES._setBucket(() => box.where);
  const token = await stagePhoto();
  const ref = db.collection('submissions').doc(`PFA-CG-${YEAR}-00009`);
  const at = new Date().toISOString();

  /* the reader lib/file-store.js gains (CONTRACT section 5): throws when bytes should exist */
  FILES.readStrict = async () => { throw new Error('503 backend error'); };
  await assert.rejects(() => documents.attachTo(db, token, ref, at), /could not|503/);
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, false);
  assert.deepEqual(attachmentDocs(), []);
  FILES.readStrict = undefined;

  /* the old reader answers null for a file that is in the bucket: a failure, not an empty file */
  FILES._setStorage(UNREADABLE);
  await assert.rejects(() => documents.attachTo(db, token, ref, at), /could not be read/);
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, false);
  assert.deepEqual(attachmentDocs(), []);

  FILES.readStrict = REAL_STRICT;
  FILES._setStorage(UNREADABLE);
  await assert.rejects(() => documents.attachTo(db, token, ref, at), /could not|503|FILE_UNAVAILABLE/i);
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, false, 'the real strict reader aborts too');

  FILES._setStorage(null);
  FILES._setBucket(() => box.where);
  assert.equal(await documents.attachTo(db, token, ref, at), 1, 'a later try finishes the job');
  assert.equal(db.dump()[`caregiverDocuments/${token}`].consumed, true);
});

test('attachTo follows an earlier movedTo instead of attaching from the emptied staging copy', async () => {
  const token = await stagePhoto();
  const at = new Date().toISOString();
  const first = db.collection('submissions').doc(`PFA-CG-${YEAR}-00001`);
  assert.equal(await documents.attachTo(db, token, first, at), 1);
  assert.equal(db.dump()[`caregiverDocuments/${token}/attachments/1`].bytes, null, 'the staging copy is emptied once used');

  /* the same record again: nothing is copied twice */
  assert.equal(await documents.attachTo(db, token, first, at), 1);
  assert.deepEqual(attachmentDocs(), [`submissions/PFA-CG-${YEAR}-00001/attachments/1`]);

  /* another record on the same pictures (one filed under a second number
     before 8 Oct 2026): copied from where they went, not lost */
  const second = db.collection('submissions').doc(`PFA-CG-${YEAR}-00002`);
  assert.equal(await documents.attachTo(db, token, second, at), 1);
  const copy = db.dump()[`submissions/PFA-CG-${YEAR}-00002/attachments/1`];
  assert.equal((await FILES.read(copy)).length, JPEG.length);
  assert.ok(db.dump()[`submissions/PFA-CG-${YEAR}-00001/attachments/1`], 'the first copy is left where it is');
});
