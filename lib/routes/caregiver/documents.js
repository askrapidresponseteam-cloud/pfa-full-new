/* POST /api/caregiver/documents   { photo, proof }   -> { ok, token }

   The colony caregiver application needs two pictures: the applicant's
   photograph, which prints on the card, and a proof of address, which the
   reviewer checks against the colony given. Neither can travel with the fee -
   the application is a plain form POST that ends on CCAvenue's page, and the
   payment gateway must never see them.

   So they are sent here first, held under a random token, and the token
   rides along with the payment. When the fee clears, response.js moves them
   beside the application record, where the panel reads them through
   /api/admin/attachment like any other photograph. Anything left here for a
   day was never paid for; the email worker's cron drops its bytes. */

'use strict';

const crypto = require('crypto');
const firebase = require('../../firebase');
const S = require('../../submissions');
const FILES = require('../../file-store');

const COLLECTION = 'caregiverDocuments';
const HOLD_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 4 * 1024 * 1024;

const LABELS = { 1: 'Photograph', 2: 'Address proof' };

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return reject(new Error('Invalid body.')); } }
    /* A body already read and parsed to nothing (JSON null, or a bare string
       where an object was expected) has no stream left to wait on: answering
       now, not when the function times out (QA, 3 Nov 2026). */
    if (request.body === null || request.readableEnded) return resolve({});
    /* Past the cap, stop keeping the bytes: rejecting alone left the listener
       attached and `raw` growing for as long as the sender cared to send. */
    let over = false;
    request.on('data', (chunk) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) { over = true; raw = ''; reject(new Error('Those pictures are too large.')); }
    });
    request.on('end', () => {
      if (over) return;
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); }
    });
    request.on('error', reject);
  });
}

function isToken(value) { return /^[a-f0-9]{48}$/.test(String(value || '')); }

function createHandler(deps) {
  const getDb = (deps && deps.getDb) || (() => firebase.getDb());
  return async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { ok: false, error: 'Use POST.' });
  }
  if (S.rateLimited(S.clientIp(request))) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes.' });

  let body;
  try { body = await readBody(request); } catch (error) { return sendJson(response, 400, { ok: false, error: error.message }); }

  const photo = S.parsePhotos([body.photo]);
  if (photo.rejected.length || !photo.accepted.length) return sendJson(response, 422, { ok: false, error: 'Your photograph: ' + (photo.rejected[0] || 'attach a JPEG, PNG or WebP.'), field: 'photo' });
  /* The proof of address was dropped in v1.293: the photograph is the only
     document an applicant is asked for. A proof still arriving from an old
     tab is kept beside the photo rather than refused, so nobody mid-way
     through the old form loses their application. */
  const proof = body.proof ? S.parsePhotos([body.proof]) : { accepted: [], rejected: [] };
  if (body.proof && (proof.rejected.length || !proof.accepted.length)) return sendJson(response, 422, { ok: false, error: 'Address proof: ' + (proof.rejected[0] || 'attach a JPEG, PNG or WebP.'), field: 'proof' });

  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  try {
    const db = getDb();
    const doc = db.collection(COLLECTION).doc(token);
    await doc.create({ createdAt, expiresAt: new Date(Date.now() + HOLD_MS).toISOString(), ip: S.clientIp(request) || '', consumed: false, swept: false });
    const files = proof.accepted.length ? [photo.accepted[0], proof.accepted[0]] : [photo.accepted[0]];
    for (let i = 0; i < files.length; i += 1) {
      const stored = await FILES.put(`caregiver-staging/${token}/${i + 1}`, files[i].bytes, files[i].contentType);
      await doc.collection('attachments').doc(String(i + 1)).create(Object.assign({
        label: LABELS[i + 1], contentType: files[i].contentType, size: files[i].bytes.length, createdAt
      }, stored));
    }
  } catch (error) {
    console.error('caregiver documents failed', error && error.message);
    return sendJson(response, 500, { ok: false, error: 'The pictures could not be kept just now. Try again.' });
  }
  return sendJson(response, 200, { ok: true, token });
  };
}

const handler = createHandler();

/* ---- attaching the pictures to the paid application ------------------------

   Called by response.js once the fee has cleared and the record exists:
   copies the pictures beside the application, then marks the staging copy
   used and empties it. Resolves to how many pictures are beside the record.

   Rules (8 Oct 2026, reviews B4, D4 and D5):
     - All or nothing. Every file is read and written before the staging copy
       is marked used. A file that should have bytes and cannot be read now
       throws, and the staging copy is left exactly as it was, so the next
       callback or the panel's repair action can finish the job. Before, an
       unreadable photo was recorded with no bytes, counted, and the staging
       copy consumed: the photo was then linked to nothing, for good.
     - Idempotent. Running it again for the same record copies nothing twice
       and answers with what is already there; two copies of one callback
       running together end with one set of pictures.
     - A staging copy already moved beside another record (movedTo) is
       followed there, not read again from staging.
   Missing staging (an unknown token) attaches nothing rather than failing. */

function alreadyExists(error) {
  return Boolean(error && (error.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(error.message))));
}

/* Whether an attachment document points at bytes. */
function hasBytes(doc) {
  const d = doc || {};
  if (d.storage === 'gcs' && d.path) return true;
  const b = d.bytes;
  return Boolean(b && (b.length || (typeof b.toUint8Array === 'function' && b.toUint8Array().length)));
}

/* The bytes of one file, or null when it has none on purpose (emptied after
   use, or swept unpaid). Throws when it should have bytes and they cannot be
   read just now. CONTRACT section 5: readStrict when lib/file-store.js has
   it; with the old read, null for a file in the bucket, or one that says it
   has a size, and was never dropped, is a failure, not an empty file. */
async function readFile(data, what) {
  const strict = typeof FILES.readStrict === 'function';
  const bytes = await (strict ? FILES.readStrict(data) : FILES.read(data));
  if (bytes && bytes.length) return bytes;
  if (!data.droppedAt && (data.storage === 'gcs' || Number(data.size) > 0)) {
    throw new Error(`${what} could not be read just now.`);
  }
  return null;
}

/* How many pictures sit beside a record, with bytes behind them. */
async function countAttached(submissionRef) {
  let count = 0;
  for (let n = 1; n <= 2; n += 1) {
    const snap = await submissionRef.collection('attachments').doc(String(n)).get();
    if (snap.exists && hasBytes(snap.data())) count += 1;
  }
  return count;
}

/* One picture beside the record. create(), so a copy a twin callback has
   just written is kept as it is; a copy written with no bytes before 8 Oct
   2026 is mended in place rather than left pointing at nothing. */
async function placeCopy(submissionRef, n, data, bytes, createdAt) {
  const target = submissionRef.collection('attachments').doc(String(n));
  const stored = await FILES.put(`submissions/${submissionRef.id}/${n}`, bytes, data.contentType);
  try {
    await target.create(Object.assign({
      label: data.label || LABELS[n], contentType: data.contentType, size: data.size || bytes.length, createdAt
    }, stored));
  } catch (error) {
    if (!alreadyExists(error)) throw error;
    const kept = await target.get();
    if (kept.exists && !hasBytes(kept.data())) await target.update(Object.assign({ repairedAt: createdAt }, stored));
  }
}

/* The staging copy's bytes, emptied once they are beside the record.
   Nothing is deleted (test/admin-master-record); best effort, because the
   record is complete whether or not this works. */
async function emptyStaging(staging, at) {
  for (let n = 1; n <= 2; n += 1) {
    try {
      const used = staging.collection('attachments').doc(String(n));
      const snap = await used.get();
      if (!snap.exists || (snap.data() || {}).droppedAt) continue;
      await used.set(await FILES.drop(snap.data(), at), { merge: true });
    } catch (error) {
      console.warn('caregiver staging copy not emptied', { n, message: error && error.message });
    }
  }
}

/* The pictures were moved beside a record before. The same record: nothing
   to copy. Another record (a payment filed under a second number before
   8 Oct 2026, or a second paid application on the same pictures): copied
   from there, never from the emptied staging copy. */
async function follow(state, staging, submissionRef, createdAt) {
  if (!state.movedTo) return 0;
  if (state.movedTo === submissionRef.id) {
    await emptyStaging(staging, createdAt);
    return countAttached(submissionRef);
  }
  const source = submissionRef.parent.doc(state.movedTo);
  for (let n = 1; n <= 2; n += 1) {
    const snap = await source.collection('attachments').doc(String(n)).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const bytes = await readFile(data, `${LABELS[n] || 'File'} ${n} of ${state.movedTo}`);
    if (bytes) await placeCopy(submissionRef, n, data, bytes, createdAt);
  }
  return countAttached(submissionRef);
}

async function attachTo(db, token, submissionRef, createdAt) {
  if (!isToken(token)) return 0;
  const staging = db.collection(COLLECTION).doc(token);
  const head = await staging.get();
  if (!head.exists) return 0;
  const state = head.data() || {};
  if (state.consumed) return follow(state, staging, submissionRef, createdAt);

  for (let n = 1; n <= 2; n += 1) {
    const snap = await staging.collection('attachments').doc(String(n)).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    let bytes;
    try {
      bytes = await readFile(data, `${LABELS[n] || 'File'} ${n}`);
    } catch (error) {
      /* A twin callback may have finished a moment ago and emptied the
         staging copy under this one: then the pictures are already there. */
      const again = await staging.get();
      const now = again.exists ? again.data() || {} : {};
      if (now.consumed && now.movedTo === submissionRef.id) return countAttached(submissionRef);
      throw error;
    }
    if (bytes) await placeCopy(submissionRef, n, data, bytes, createdAt);
  }
  /* Every file was read and written: only now is the staging copy used up. */
  await staging.set({ consumed: true, movedTo: submissionRef.id, consumedAt: createdAt }, { merge: true });
  await emptyStaging(staging, createdAt);
  return countAttached(submissionRef);
}

/* Pictures uploaded but never paid for. Run from the daily cron; anything past
   its hold is deleted, attachments first. Best effort: a failure here is
   logged, never surfaced, because nothing depends on it. */
async function sweep(db, nowIso) {
  const now = nowIso || new Date().toISOString();
  let swept = 0;
  try {
    const stale = await db.collection(COLLECTION).where('expiresAt', '<', now).where('swept', '==', false).limit(50).get();
    for (const snap of stale.docs) {
      if ((snap.data() || {}).consumed) { await snap.ref.set({ swept: true }, { merge: true }); continue; }
      for (let n = 1; n <= 2; n += 1) {
        const left = snap.ref.collection('attachments').doc(String(n));
        const got = await left.get();
        if (got.exists) await left.set(await FILES.drop(got.data(), now), { merge: true });
      }
      await snap.ref.set({ swept: true, sweptAt: now }, { merge: true });
      swept += 1;
    }
  } catch (error) {
    console.error('caregiver documents sweep failed', error && error.message);
  }
  return swept;
}

module.exports = handler;
module.exports.sweep = sweep;
module.exports._private = { createHandler };
module.exports.attachTo = attachTo;
module.exports.isToken = isToken;
module.exports.LABELS = LABELS;
module.exports.COLLECTION = COLLECTION;
