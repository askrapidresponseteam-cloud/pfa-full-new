/* POST /api/payment/tax-id   { photo, type }   -> { ok, token }

   The photo of the PAN or Aadhaar card a contribution of 5,000 rupees or
   more carries for its 80G receipt (lib/tax-id.js). Like the caregiver's
   photograph (../caregiver/documents.js), it cannot travel with the payment:
   the form ends on CCAvenue's page, and the payment gateway must never see
   it. So it is sent here first, kept under a random token, and the token
   rides with the payment. When the payment clears, response.js moves it
   beside the donation or membership record as its "tax-id" file, which the
   panel opens through /api/admin/attachment?n=tax-id. A photo left here for
   a day was never paid for; the daily cron empties it. */

'use strict';

const crypto = require('crypto');
const firebase = require('../../firebase');
const S = require('../../submissions');
const FILES = require('../../file-store');
const TAXID = require('../../tax-id');
const CARD = require('../../card-read');

const COLLECTION = 'taxIdDocuments';
const FILE_ID = 'tax-id';
const HOLD_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 3 * 1024 * 1024;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    const raw0 = typeof request.body === 'string' ? request.body : '';
    if (raw0) { try { return resolve(JSON.parse(raw0)); } catch (_) { return reject(new Error('Invalid body.')); } }
    if (request.body === null || request.readableEnded) return resolve({});
    let raw = '';
    let over = false;
    request.on('data', (chunk) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) { over = true; raw = ''; reject(new Error('That photo is too large. Try a smaller one.')); }
    });
    request.on('end', () => {
      if (over) return;
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); }
    });
    request.on('error', reject);
  });
}

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

    const type = String(body.type || '').toLowerCase();
    if (!TAXID.TYPES[type]) return sendJson(response, 422, { ok: false, error: 'Choose PAN or Aadhaar.', field: 'idType' });
    const photo = S.parsePhotos([body.photo]);
    if (photo.rejected.length || !photo.accepted.length) {
      return sendJson(response, 422, { ok: false, error: `Your ${TAXID.TYPES[type]}: ${String(photo.rejected[0] || 'attach a JPEG, PNG or WebP photo.').replace(/^Photo 1 /, 'the photo ')}`, field: 'taxIdDoc' });
    }
    const file = photo.accepted[0];
    /* An Aadhaar card's QR code says which Aadhaar it is (lib/aadhaar-qr.js):
       read here, kept with the photo, and answered to the form, so a number
       typed that is not this card's is caught before anyone pays, and the
       payment is refused if it still differs (confirm, below). */
    const read = type === 'aadhaar' ? CARD.readAadhaar(file.bytes, file.contentType) : null;
    const token = crypto.randomBytes(24).toString('hex');
    const createdAt = new Date().toISOString();
    try {
      const doc = getDb().collection(COLLECTION).doc(token);
      await doc.create(Object.assign({ type, createdAt, expiresAt: new Date(Date.now() + HOLD_MS).toISOString(), ip: S.clientIp(request) || '', consumed: false, swept: false }, read ? { read } : {}));
      const stored = await FILES.put(`tax-id-staging/${token}`, file.bytes, file.contentType);
      await doc.collection('attachments').doc(FILE_ID).create(Object.assign({
        label: TAXID.TYPES[type], contentType: file.contentType, size: file.bytes.length, createdAt
      }, stored));
    } catch (error) {
      console.error('tax id photo not kept', error && error.message);
      return sendJson(response, 500, { ok: false, error: 'The photo could not be kept just now. Try again.' });
    }
    /* to the form: what the card says, by its last four digits and name */
    return sendJson(response, 200, { ok: true, token, read: read ? { kind: read.kind, last4: read.last4, name: read.name } : null });
  };
}

/* Before the payment starts (lib/routes/payment/create.js): the photo is
   still kept, is of the kind of card chosen, and, where its QR code was
   read, is the card of the number typed. Throws in plain words when not;
   answers what was read otherwise. */
async function confirm(db, taxId, number) {
  if (!taxId || !TAXID.isToken(taxId.token)) throw new Error('Attach a photo of your PAN or Aadhaar card.');
  const snap = await db.collection(COLLECTION).doc(taxId.token).get();
  const kept = snap.exists ? snap.data() || {} : null;
  if (!kept || kept.swept || Date.parse(kept.expiresAt) < Date.now()) throw new Error('The photo of your card was sent too long ago. Attach it again and pay.');
  if (kept.type !== taxId.type) throw new Error(`The photo attached is of a ${TAXID.TYPES[kept.type] || 'card'}, and the number is ${taxId.type === 'pan' ? 'a PAN' : 'an Aadhaar number'}. Attach the photo of the same card.`);
  const read = kept.read || null;
  if (read && taxId.type === 'aadhaar') {
    const n = String(number || '');
    if ((read.uid && read.uid !== n) || (read.last4 && n.slice(-4) !== read.last4)) {
      throw new Error(`The Aadhaar number does not match the card in the photo: the QR code on that card is for an Aadhaar ending ${read.last4}. Check the number, or attach the right card.`);
    }
  }
  return read;
}

function alreadyExists(error) {
  return Boolean(error && (error.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(error.message))));
}

/* The bytes of a kept photo, or null when it was emptied on purpose. Throws
   when it should have bytes and they cannot be read just now. */
async function readFile(data) {
  const bytes = await (typeof FILES.readStrict === 'function' ? FILES.readStrict(data) : FILES.read(data));
  if (bytes && bytes.length) return bytes;
  if (!data.droppedAt && (data.storage === 'gcs' || Number(data.size) > 0)) throw new Error('The card photo could not be read just now.');
  return null;
}

/* Called by response.js once the payment has cleared and its record exists.
   Copies the photo beside the record, then marks the kept copy used and
   empties it. Resolves to { type, label } when the photo is beside the
   record, or null when there is nothing to attach (an unknown token, or one
   swept unpaid). Throws, leaving the kept copy as it was, when the photo
   cannot be read or written just now, so the next callback can finish.
   Safe to run twice: the second run finds the copy already there. */
async function attachTo(db, token, recordRef, createdAt) {
  if (!TAXID.isToken(token)) return null;
  const kept = db.collection(COLLECTION).doc(token);
  const head = await kept.get();
  if (!head.exists) return null;
  const state = head.data() || {};
  const type = TAXID.TYPES[state.type] ? state.type : 'pan';
  const target = recordRef.collection('attachments').doc(FILE_ID);
  const already = await target.get();
  const read = state.read || null;
  if (already.exists) return { type, label: TAXID.TYPES[type], read };
  if (state.consumed && state.movedTo && state.movedTo !== recordRef.id) {
    /* the same photo already beside another record of the same payment */
    const there = await recordRef.parent.doc(state.movedTo).collection('attachments').doc(FILE_ID).get();
    if (!there.exists) return null;
    const bytes = await readFile(there.data() || {});
    if (!bytes) return null;
    await place(target, recordRef.id, there.data() || {}, bytes, createdAt);
    return { type, label: TAXID.TYPES[type], read };
  }
  const snap = await kept.collection('attachments').doc(FILE_ID).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const bytes = await readFile(data);
  if (!bytes) return null;
  await place(target, recordRef.id, data, bytes, createdAt);
  await kept.set({ consumed: true, movedTo: recordRef.id, consumedAt: createdAt }, { merge: true });
  try { await kept.collection('attachments').doc(FILE_ID).set(await FILES.drop(data, createdAt), { merge: true }); } catch (error) {
    console.warn('tax id kept copy not emptied', error && error.message);
  }
  return { type, label: TAXID.TYPES[type], read };
}

async function place(target, reference, data, bytes, createdAt) {
  const stored = await FILES.put(`submissions/${reference}/${FILE_ID}`, bytes, data.contentType);
  try {
    await target.create(Object.assign({ label: data.label || 'PAN or Aadhaar card', contentType: data.contentType, size: data.size || bytes.length, createdAt }, stored));
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
}

/* Photos sent but never paid for, emptied once their day is up. Run from
   the daily cron; best effort. */
async function sweep(db, nowIso) {
  const now = nowIso || new Date().toISOString();
  let swept = 0;
  try {
    const stale = await db.collection(COLLECTION).where('expiresAt', '<', now).where('swept', '==', false).limit(50).get();
    for (const snap of stale.docs) {
      if ((snap.data() || {}).consumed) { await snap.ref.set({ swept: true }, { merge: true }); continue; }
      const left = snap.ref.collection('attachments').doc(FILE_ID);
      const got = await left.get();
      if (got.exists) await left.set(await FILES.drop(got.data(), now), { merge: true });
      await snap.ref.set({ swept: true, sweptAt: now }, { merge: true });
      swept += 1;
    }
  } catch (error) {
    console.error('tax id photos sweep failed', error && error.message);
  }
  return swept;
}

const handler = createHandler();
module.exports = handler;
module.exports._private = { createHandler };
module.exports.attachTo = attachTo;
module.exports.confirm = confirm;
module.exports.sweep = sweep;
module.exports.COLLECTION = COLLECTION;
module.exports.FILE_ID = FILE_ID;
