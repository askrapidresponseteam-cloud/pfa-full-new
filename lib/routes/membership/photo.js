/* POST /api/membership/photo  { t, action: 'open' }                         -> what the link may do
   POST /api/membership/photo  { t, action: 'send', photo, consent: true }   -> the photograph is filed

   The member's side of the membership card (owner, 26 Oct 2026). A member
   reaches member-photo.html from the private link an administrator emailed
   them (lib/routes/admin/membership.js), and sends their photograph here.
   It is then waiting for PFA's approval in the panel.

   Both calls are POSTs so the link's secret never sits in a URL the server
   or a proxy logs; the page itself carries it in the fragment (#t=), which
   browsers never send. What 'open' returns is only what the page needs to
   greet the member: their first name, their membership and when the link
   expires. Nothing about where they live, how to reach them, or what they
   paid.

   The upload is all or nothing: the bytes go to the private bucket first
   (lib/file-store.js), then one transaction re-reads the link and the
   record, checks the link is still live, files the photograph beside the
   record, moves the membership to "Photo received" and marks the link used.
   If anything changed meanwhile, nothing is filed, the stored copy is
   emptied, and the member is told why. */

'use strict';

const firebase = require('../../firebase');
const S = require('../../submissions');
const FILES = require('../../file-store');
const MC = require('../../membership-card');
const NOTIFY = require('../../membership-notify');
const CASE = require('../admin/case');

const MAX_BODY = 2 * 1024 * 1024;

const SAY = {
  unknown: 'This link is not one we recognise. Check you opened the whole link from the email, or ask PFA for a new one.',
  expired: 'This link has expired. Ask PFA for a new one and it will reach your email.',
  used: 'This link has already been used to send your photograph. PFA is checking it; you will hear by email.',
  replaced: 'A newer link has been sent to your email. Please use the latest email from PFA.',
  closed: 'This link is no longer needed. If you think that is a mistake, write to PFA.'
};

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return reject(new Error('Invalid body.')); } }
    let over = false;
    request.on('data', (chunk) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) { over = true; raw = ''; reject(Object.assign(new Error('That photograph is too large. Try again: the page makes it smaller for you.'), { tooLarge: true })); }
    });
    request.on('end', () => { if (over) return; try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); } });
    request.on('error', reject);
  });
}

function firstName(name) {
  const words = MC.clean(name, 80).split(' ').filter((w) => w && !/\.$/.test(w));
  const word = words[0] || '';
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
}

/* The link and its record, read together. */
async function lookUp(db, token, nowMs, tx) {
  const hash = MC.hashToken(token);
  const linkRef = db.collection(MC.LINKS).doc(hash);
  const linkSnap = tx ? await tx.get(linkRef) : await linkRef.get();
  if (!linkSnap.exists) return { state: 'unknown', hash, linkRef };
  const link = Object.assign({ hash }, linkSnap.data() || {});
  const recordRef = CASE.memberRecord(db, link.reference);
  const recordSnap = tx ? await tx.get(recordRef) : await recordRef.get();
  if (!recordSnap.exists) return { state: 'unknown', hash, linkRef };
  const record = recordSnap.data() || {};
  return { state: MC.linkState(link, record, nowMs), hash, link, linkRef, record, recordRef };
}

function createHandler(deps) {
  const getDb = (deps && deps.getDb) || (() => firebase.getDb());
  const now = (deps && deps.now) || (() => Date.now());
  const tellOffice = (deps && deps.tellOffice) || ((args) => require('../admin/membership').tellOffice(args));

  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { ok: false, error: 'Use POST.' });
    }
    const ip = S.clientIp(request) || '';
    if (S.rateLimited(ip)) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });

    let body;
    try { body = await readBody(request); } catch (error) {
      return sendJson(response, error.tooLarge ? 413 : 400, { ok: false, error: error.message });
    }
    const token = String(body.t || '');
    if (!MC.isToken(token)) return sendJson(response, 404, { ok: false, state: 'unknown', error: SAY.unknown });
    const action = MC.clean(body.action, 10);
    const nowMs = now();
    const at = new Date(nowMs).toISOString();

    try {
      const db = getDb();

      if (action === 'open') {
        const found = await lookUp(db, token, nowMs);
        if (found.state !== 'live') return sendJson(response, found.state === 'unknown' ? 404 : 410, { ok: false, state: found.state, error: SAY[found.state] || SAY.unknown });
        const f = found.record.fields || {};
        const p = found.record.memberPhoto || {};
        return sendJson(response, 200, {
          ok: true, state: 'live',
          firstName: firstName(f.name),
          membership: MC.tierOf(f).label,
          reference: found.link.reference,
          expiresAt: found.link.expiresAt,
          retake: Boolean(found.link.retake),
          reasons: found.link.retake ? (Array.isArray(p.reasons) ? p.reasons.slice(0, 6) : []) : []
        });
      }

      if (action !== 'send') return sendJson(response, 400, { ok: false, error: 'Unknown action.' });
      if (S.writeLimited(ip)) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });
      if (body.consent !== true) return sendJson(response, 422, { ok: false, field: 'consent', error: 'Tick the box to confirm the photograph is of you and may be printed on your card.' });
      const photo = MC.checkPhoto(body.photo);
      if (!photo.ok) return sendJson(response, 422, { ok: false, field: 'photo', error: photo.message });

      /* a quick look first, so a dead link does not store a file */
      const first = await lookUp(db, token, nowMs);
      if (first.state !== 'live') return sendJson(response, first.state === 'unknown' ? 404 : 410, { ok: false, state: first.state, error: SAY[first.state] || SAY.unknown });

      const reference = first.link.reference;
      const attachmentId = `member-photo-${first.hash.slice(0, 12)}`;
      const stored = await FILES.put(`submissions/${reference}/${attachmentId}`, photo.bytes, photo.contentType);

      const done = await db.runTransaction(async (tx) => {
        const found = await lookUp(db, token, nowMs, tx);
        if (found.state !== 'live') return { ok: false, state: found.state };
        const fieldValue = firebase.fieldValue;
        tx.set(found.linkRef, { usedAt: at, usedFrom: ip ? MC.hashToken(`ip:${ip}`).slice(0, 16) : '' }, { merge: true });
        CASE.memberStep(tx, found.recordRef, fieldValue, {
          step: MC.STAGE.received, at, by: 'member',
          photo: { current: attachmentId, receivedAt: at, linkUsedAt: at },
          attachment: { id: attachmentId, data: Object.assign({ label: 'Membership card photograph', contentType: photo.contentType, size: photo.bytes.length, width: photo.width, height: photo.height, createdAt: at, consentAt: at }, stored) },
          note: 'The member sent their photograph for the card. It is waiting for approval in Membership cards.',
          noteId: `${nowMs}-member-photo`
        });
        const f = found.record.fields || {};
        return { ok: true, name: MC.clean(f.name, 80), email: MC.clean(f.email, 254).toLowerCase(), tierLabel: MC.tierOf(f).label };
      });

      if (!done.ok) {
        try { await FILES.drop(stored, at); } catch (_) { /* best effort; the file is unreferenced */ }
        return sendJson(response, 410, { ok: false, state: done.state, error: SAY[done.state] || SAY.unknown });
      }

      /* Then the letters: the member's receipt, and the office's notice. The
         photograph is already filed whatever happens to them. */
      const site = NOTIFY.publicSite();
      if (done.email) {
        await NOTIFY.send({ template: 'member_photo_received', to: done.email, dedupeKey: `${reference}:${attachmentId}`, claimBy: 'member-photo',
          payload: { name: done.name, memberId: reference, receivedAt: at, siteUrl: site } });
      }
      try { await tellOffice({ reference, name: done.name, tierLabel: done.tierLabel, receivedAt: at }); } catch (error) {
        console.error('member photo: office not told', error && error.message);
      }
      return sendJson(response, 200, { ok: true, state: 'sent', reference, firstName: firstName(done.name) });
    } catch (error) {
      console.error('member photo failed', error && error.message);
      return sendJson(response, 500, { ok: false, error: 'Your photograph could not be sent just now. Please try again in a minute.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { lookUp, firstName, SAY };
