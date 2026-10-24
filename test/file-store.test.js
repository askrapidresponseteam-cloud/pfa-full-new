'use strict';

/* Photographs and documents live in the Storage bucket, not in Firestore
   (owner, 8 Oct 2026: "storage consumption minimal ... blob or something
   that will cost minimal"). Firestore keeps only where each file is.

   Driven through the real routes: a report with a photograph, the panel
   opening it, the copy to gandhim carrying it, a caregiver's photograph
   moving from its staging place to the application. The bucket is a stand-in
   with the two calls the code makes (save, download). Without a bucket the
   bytes stay in Firestore as before, which every other test already covers. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const ROOT = path.join(__dirname, '..');
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const FILES = require('../lib/file-store');
const { PLACE } = require('./_place');

const JPEG = fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg'));
const PHOTO = 'data:image/jpeg;base64,' + JPEG.toString('base64');
const INBOX = 'gandhim@exmpls.sansad.in';
const REPORT = {
  what: 'A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly and needs a vet soon.',
  animal: 'Dog', urgency: 'Happening now', ...PLACE, when: 'This morning, around 8',
  accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: 'tester.pfa@example.com'
};

function memoryBucket(name) {
  const files = new Map();
  const bucket = {
    file(p) {
      return {
        async save(bytes, opts) { files.set(p, { bytes: Buffer.from(bytes), contentType: opts && opts.contentType }); },
        async download() { if (!files.has(p)) throw Object.assign(new Error('No such object'), { code: 404 }); return [files.get(p).bytes]; }
      };
    },
    async exists() { return [true]; }
  };
  return { files, where: { bucket, name } };
}

let db;
let box;
let sent;
const realFetch = global.fetch;
const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PUBLIC_SITE_URL', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test' });
  delete process.env.PFA_SUBMISSIONS_INBOX;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  box = memoryBucket('pfa-new-website.firebasestorage.app');
  FILES._setBucket(() => box.where);
  sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

test.afterEach(() => {
  global.fetch = realFetch;
  FILES._reset();
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = Buffer.isBuffer(raw) ? raw : String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test('a report\'s photograph goes to the bucket; Firestore keeps where it is, not the bytes', async () => {
  const res = await call(require('../lib/routes/pfa-submissions'), {
    body: { kind: 'PFA-CR', data: REPORT, page: 'report.html', clientRequestId: 'req-' + Math.random(), photos: [PHOTO] }
  });
  assert.equal(res.statusCode, 200, String(res.raw).slice(0, 300));
  const ref = res.json.reference;
  const doc = db.dump()[`submissions/${ref}/attachments/1`];
  assert.ok(doc, 'the attachment is on record');
  assert.equal(doc.storage, 'gcs');
  assert.equal(doc.path, `submissions/${ref}/1`);
  assert.equal(doc.bucket, 'pfa-new-website.firebasestorage.app');
  assert.equal(doc.bytes, undefined, 'no bytes in Firestore');
  assert.ok(doc.size > 1000 && doc.contentType === 'image/jpeg', 'label, type and size stay beside it');
  const kept = box.files.get(`submissions/${ref}/1`);
  assert.ok(kept && kept.bytes.length === doc.size, 'the photograph is in the bucket, whole');

  /* the panel opens it */
  const shown = await call(require('../lib/routes/admin/attachment'), { method: 'GET', query: { reference: ref, n: '1' }, headers: { authorization: 'Bearer test-admin' } });
  assert.equal(shown.statusCode, 200, String(shown.raw).slice(0, 200));
  assert.equal(Buffer.from(shown.json.data, 'base64').length, doc.size, 'the panel shows the bucket\'s copy');

  /* and the copy to gandhim carries it */
  const copy = sent.find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(INBOX));
  assert.ok(copy, 'the copy went to the inbox');
  assert.equal((copy.attachments || []).length, 1, 'with the photograph attached, read from the bucket');
});

test('with no bucket (Storage not switched on yet), the bytes stay in Firestore and everything still reads', async () => {
  FILES._setBucket(() => null);
  const res = await call(require('../lib/routes/pfa-submissions'), {
    body: { kind: 'PFA-CR', data: REPORT, page: 'report.html', clientRequestId: 'req-' + Math.random(), photos: [PHOTO] }
  });
  const ref = res.json.reference;
  const doc = db.dump()[`submissions/${ref}/attachments/1`];
  assert.ok(Buffer.from(doc.bytes).length > 1000, 'kept in the document, as before');
  assert.equal(doc.storage, undefined);
  const shown = await call(require('../lib/routes/admin/attachment'), { method: 'GET', query: { reference: ref, n: '1' }, headers: { authorization: 'Bearer test-admin' } });
  assert.equal(shown.statusCode, 200);
  assert.equal(Buffer.from(shown.json.data, 'base64').length, doc.size);
});

test('a write the bucket refuses falls back to Firestore rather than losing the photograph', async () => {
  const failing = memoryBucket('x');
  failing.where.bucket.file = () => ({ async save() { throw new Error('403 forbidden'); }, async download() { throw new Error('no'); } });
  FILES._setBucket(() => failing.where);
  const out = await FILES.put('submissions/PFA-CR-2026-00001/1', JPEG, 'image/jpeg');
  assert.ok(Buffer.isBuffer(out.bytes) && out.bytes.length === JPEG.length);
  assert.equal(await FILES.read(out).then((b) => b.length), JPEG.length);
});

test('records written before the change, with their bytes in the document, still read', async () => {
  assert.equal((await FILES.read({ bytes: JPEG })).length, JPEG.length);
  assert.equal((await FILES.read({ bytes: JPEG.toString('base64') })).length, JPEG.length);
  assert.equal(await FILES.read({ bytes: null, droppedAt: 'x' }), null);
});

test("a caregiver's photograph moves from staging to the application in the bucket, and the staging copy is emptied, not deleted", async () => {
  const documents = require('../lib/routes/caregiver/documents');
  const staged = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO } });
  assert.equal(staged.statusCode, 200, String(staged.raw).slice(0, 200));
  const token = staged.json.token;
  const stagingPath = `caregiver-staging/${token}/1`;
  assert.ok(box.files.get(stagingPath).bytes.length > 1000, 'staged in the bucket');

  const ref = db.collection('submissions').doc('PFA-CG-2026-00001');
  await ref.set({ kind: 'PFA-CG' });
  assert.equal(await documents.attachTo(db, token, ref, new Date().toISOString()), 1);
  const moved = db.dump()['submissions/PFA-CG-2026-00001/attachments/1'];
  assert.equal(moved.storage, 'gcs');
  assert.equal(moved.path, 'submissions/PFA-CG-2026-00001/1');
  assert.ok(box.files.get(moved.path).bytes.length > 1000, 'beside the application');
  assert.equal(box.files.get(stagingPath).bytes.length, 0, 'the staging copy is emptied (nothing is deleted)');
  const left = db.dump()[`caregiverDocuments/${token}/attachments/1`];
  assert.equal(left.bytes, null);
  assert.ok(left.droppedAt);
});

test("a caregiver's photograph still moves when the fee clears on an instance whose probe failed", async () => {
  /* Review D4, 8 Oct 2026: the photograph was staged in the bucket by one
     instance; the payment callback landed on another whose probe had been
     refused (or that runs with PFA_FILE_STORE=off). read() depended on the
     probe, answered null, and the application was filed with bytes:null
     while the staging copy was marked used: the photo was unlinked for good.
     Reads now open the bucket the record names. */
  const documents = require('../lib/routes/caregiver/documents');
  const staged = await call(documents, { body: { photo: PHOTO } });
  const token = staged.json.token;
  assert.ok(box.files.get(`caregiver-staging/${token}/1`).bytes.length > 1000, 'staged in the bucket');

  FILES._setBucket(() => null);   // this instance has no bucket to write to just now
  const ref = db.collection('submissions').doc('PFA-CG-2026-00002');
  await ref.set({ kind: 'PFA-CG' });
  assert.equal(await documents.attachTo(db, token, ref, new Date().toISOString()), 1);
  const moved = db.dump()['submissions/PFA-CG-2026-00002/attachments/1'];
  const bytes = await FILES.readStrict(moved);
  assert.ok(bytes && bytes.length > 1000, 'the application carries the photograph (in Firestore, as there was nowhere else to write it)');
  assert.equal(bytes.length, moved.size);
});

test('the file store offers both readers the contract names', () => {
  assert.equal(typeof FILES.read, 'function');
  assert.equal(typeof FILES.readStrict, 'function');
});

test('nothing in the file store deletes anything', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/file-store.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /\.delete\(|deleteFiles|\.remove\(/);
});
