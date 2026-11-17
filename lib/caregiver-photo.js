'use strict';

/* Asking a colony caregiver for their photograph (owner, 17 Nov 2026:
   "option to ask for photo should be there. for each and for all at once").

   The same private, one-time link a member is sent for theirs
   (lib/membership-card.js tokens, the photoLinks collection, the page
   member-photo.html and /api/membership/photo), marked kind 'caregiver'.
   The request and the photograph are written on the application by
   lib/routes/admin/case.js caregiverPhotoStep; a card already issued is
   brought up to date with the photograph online at once. */

const firebase = require('./firebase');
const MC = require('./membership-card');
const NOTIFY = require('./membership-notify');
const FLOW = require('./case-flow');

const KIND = 'PFA-CG';
const CLOSED = new Set(['rejected', 'removed', 'spam', 'withdrawn']);
const clean = MC.clean;

function emailOf(data) {
  const email = clean(data && data.fields && data.fields.email, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}

function askable(data) {
  const d = data || {};
  if (d.kind !== KIND) return { ok: false, code: 'NOT_AN_APPLICATION', message: 'Only a colony caregiver application is sent a photo link.' };
  if (CLOSED.has(String(d.status || ''))) return { ok: false, code: 'CLOSED', message: 'This application is closed.' };
  const email = emailOf(d);
  if (!email) return { ok: false, code: 'NO_EMAIL', message: 'There is no email on this application to send the link to.' };
  return { ok: true, email };
}

function linkState(link, record, nowMs) {
  if (!link) return 'unknown';
  if (link.usedAt) return 'used';
  if (link.retiredAt) return 'replaced';
  const d = record || {};
  const current = d.caregiverPhoto && d.caregiverPhoto.linkHash;
  if (current && current !== link.hash) return 'replaced';
  if (d.kind !== KIND || CLOSED.has(String(d.status || ''))) return 'closed';
  const expires = Date.parse(link.expiresAt || '');
  if (!Number.isFinite(expires) || expires <= nowMs) return 'expired';
  return 'live';
}

/* One application: a new link, the old one retired, the caregiver emailed. */
async function request(db, reference, { by, at, nowMs }) {
  const CASE = require('./routes/admin/case');
  const { token, hash } = MC.newToken();
  const expiresAt = new Date(nowMs + MC.LINK_MS).toISOString();
  /* the application, through case.js, where every write to a case lives */
  const ref = CASE.memberRecord(db, reference);
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'No application carries that number.' };
    const data = snap.data() || {};
    const can = askable(data);
    if (!can.ok) return can;
    const prev = data.caregiverPhoto || {};
    tx.create(db.collection(MC.LINKS).doc(hash), { hash, reference, kind: 'caregiver', createdAt: at, expiresAt, by });
    if (prev.linkHash && prev.linkHash !== hash) tx.set(db.collection(MC.LINKS).doc(prev.linkHash), { retiredAt: at, retiredBy: by }, { merge: true });
    const requests = (Number(prev.requests) || 0) + 1;
    CASE.caregiverPhotoStep(tx, ref, firebase.fieldValue, {
      step: 'photo-requested', at, by, status: FLOW.currentOf(data),
      photo: Object.assign({}, prev, { linkHash: hash, linkExpiresAt: expiresAt, requestedAt: at, requestedBy: by, requests }),
      note: requests > 1 ? 'A new photo link was emailed to the caregiver.' : 'Photo link emailed to the caregiver.'
    });
    return { ok: true, email: can.email, name: clean((data.fields || {}).name, 80), cardId: clean(data.cardId, 40) };
  });
  if (!done.ok) return done;
  const mailed = await NOTIFY.send({ template: 'caregiver_photo_request', to: done.email,
    payload: { name: done.name, reference, cardId: done.cardId, siteUrl: NOTIFY.publicSite(), uploadUrl: NOTIFY.photoLink(token), expiresAt },
    dedupeKey: `${reference}:${hash.slice(0, 24)}`, claimBy: 'caregiver-photo', scrub: true });
  return { ok: true, reference, to: done.email, expiresAt, emailed: mailed.sent, mailNote: mailed.reason };
}

/* The photograph sent from the link: filed on the application, the link
   used; then the card online brought up to date, and a receipt emailed.
   found is /api/membership/photo's lookUp; stored the file already put. */
async function received(db, { found, token, nowMs, at, ip, photo, stored, attachmentId, lookUp }) {
  const CASE = require('./routes/admin/case');
  const done = await db.runTransaction(async (tx) => {
    const again = await lookUp(db, token, nowMs, tx);
    if (again.state !== 'live') return { ok: false, state: again.state };
    const oldRef = again.recordRef.collection('attachments').doc('1');
    const old = await tx.get(oldRef);
    const data = again.record;
    tx.set(again.linkRef, { usedAt: at, usedFrom: ip ? MC.hashToken(`ip:${ip}`).slice(0, 16) : '' }, { merge: true });
    CASE.caregiverPhotoStep(tx, again.recordRef, firebase.fieldValue, {
      step: 'photo-received', at, by: 'caregiver', status: FLOW.currentOf(data),
      photo: Object.assign({}, data.caregiverPhoto || {}, { receivedAt: at, linkUsedAt: at }),
      attachment: Object.assign({ label: 'Colony caregiver card photograph', contentType: photo.contentType, size: photo.bytes.length, width: photo.width, height: photo.height, receivedAt: at }, stored),
      previous: old.exists ? { id: `before-${attachmentId}`, data: old.data() } : null,
      count: Number(data.attachments) || 0,
      note: 'The caregiver sent their photograph for the card.',
      noteId: `${nowMs}-caregiver-photo`
    });
    const f = data.fields || {};
    return { ok: true, reference: found.link.reference, name: clean(f.name, 80), email: emailOf(data), cardId: clean(data.cardId, 40) };
  });
  if (!done.ok) return done;
  /* a card already issued: its photograph online at once */
  if (done.cardId) {
    try {
      const DC = require('./digital-cards');
      const on = await DC.statusOf(db, 'caregiver', done.cardId);
      if (on && on.standing === 'withdrawn') return done;   // a revoked card stays revoked
      const type = /^image\/(jpeg|png)$/.test(photo.contentType) ? photo.contentType : '';
      if (type) await DC.issue(db, { kind: 'caregiver', ref: done.cardId, photoFile: { bytes: photo.bytes, type }, who: { email: 'caregiver' }, nowMs });
    } catch (error) { console.error('caregiver photo: card online not updated', error && error.message); }
  }
  if (done.email) {
    await NOTIFY.send({ template: 'caregiver_photo_received', to: done.email, dedupeKey: `${done.reference}:${attachmentId}`, claimBy: 'caregiver-photo',
      payload: { name: done.name, reference: done.reference, cardId: done.cardId, receivedAt: at, siteUrl: NOTIFY.publicSite() } });
  }
  return done;
}

module.exports = { KIND, askable, linkState, request, received };
