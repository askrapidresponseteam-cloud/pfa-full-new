/* GET  /api/admin/membership                       the queues, with counts
   GET  /api/admin/membership?queue=review          one queue
   GET  /api/admin/membership?reference=PFA-MEM-... one membership, with its photograph and card
   POST /api/admin/membership { action, ... }

     request-photo { references: [...] }              email each member a private photo link
     retake        { reference, reasons: [...], note } the photograph will not do: say why, send a new link
     approve       { reference, printName }            the photograph is approved: the card exists
     printed       { references: [...] }               the cards came off the printer
     dispatched    { reference, courier, trackingNumber } a printed card handed to the courier

   The membership card, from the panel (owner, 26 Oct 2026: "admin should
   have option to send email to the applicant to upload photo. once they
   upload the application should come to pfa for approval and card
   generation"). lib/membership-card.js has the rules and the journey; this
   route checks who is asking, runs each step in a transaction that re-reads
   the record and checks the step is still allowed, writes the step through
   the case module (where every write to a case lives), and then sends the
   letter. Every action is in the audit log.

   A standing rule (owner, 26 Oct 2026): the administrator previews the
   actual card before issuing it, and issuing never sends the member any
   digital copy of the card. Only the physical card is issued, and it goes
   to the member by courier. So the card is drawn only in the panel
   (assets/member-card.js); no letter carries it, its image or a link to
   it; and the last step is the courier, with its tracking number, which is
   all the member is told. Needs the Membership cards section. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const FILES = require('../../file-store');
const FORWARD = require('../../submission-forward');
const S = require('../../submissions');
const MC = require('../../membership-card');
const NOTIFY = require('../../membership-notify');
const CASE = require('./case');
const PRINT = require('../../../assets/card-print.js');

const MODULE = 'membership';
const MAX_SCAN = 1000;
const MAX_PER_POST = 25;
const MAX_BODY = 64 * 1024;
const OPEN_QUEUES = ['request', 'lapsed', 'waiting', 'review', 'approved'];
const ALL_QUEUES = Object.keys(MC.QUEUE_LABELS);

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    let over = false;
    request.on('data', (chunk) => { if (over) return; raw += chunk; if (raw.length > MAX_BODY) { over = true; raw = ''; } });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function referenceOf(value) {
  const r = MC.clean(value, 40).toUpperCase().replace(/\s+/g, '');
  return /^PFA-MEM-\d{4}-\d{4,8}$/.test(r) ? r : '';
}

function referencesOf(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(referenceOf).filter(Boolean))].slice(0, MAX_PER_POST);
}

function whoLabel(who) {
  return (who && (who.email || who.name || who.uid)) || 'staff';
}

function noteId(at, suffix) {
  return `${Date.parse(at) || Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---- reading --------------------------------------------------------------- */

async function listAll(db, nowMs) {
  const snap = await CASE.memberRecords(db, MAX_SCAN);
  const rows = [];
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.status === 'removed' || data.status === 'spam') return;
    rows.push(MC.rowOf(doc.id, data, nowMs));
  });
  rows.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  return { rows, capped: snap.size >= MAX_SCAN };
}

async function photoOf(ref, id) {
  if (!id) return null;
  const snap = await ref.collection('attachments').doc(id).get();
  if (!snap.exists) return { missing: true };
  const data = snap.data() || {};
  try {
    const bytes = await FILES.readStrict(data);
    if (!bytes) return { missing: true };
    return { id, contentType: S.imageType(bytes) || data.contentType || 'image/jpeg', size: bytes.length,
      width: Number(data.width) || 0, height: Number(data.height) || 0, data: bytes.toString('base64') };
  } catch (error) {
    console.error('membership photo not readable', { id, reason: error.reason, message: String(error.message).slice(0, 160) });
    return { unavailable: true };
  }
}

async function detailOf(db, reference, nowMs) {
  const ref = CASE.memberRecord(db, reference);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.kind !== MC.KIND) return { notMembership: true };
  const row = MC.rowOf(reference, data, nowMs);
  const f = data.fields || {};
  const photo = await photoOf(ref, data.memberPhoto && data.memberPhoto.current);
  const cardSnap = await db.collection(MC.CARDS).doc(reference).get();
  const card = cardSnap.exists ? cardSnap.data() : null;
  const tier = MC.tierOf(f);
  const validity = MC.validityOf(data, tier);
  /* what the card would print, before it exists: the reviewer sees the card
     they are approving */
  const draft = card || {
    cardId: reference, printName: require('../../../assets/field-rules.js').nameCase(MC.clean(f.name, 80)),
    tierLabel: tier.label, tierWord: MC.tierWord(tier),
    district: PRINT.placeName(MC.clean(f.district, 60)), state: PRINT.placeName(MC.clean(f.state, 40)),
    validUntil: validity.validUntil, lifetime: validity.lifetime
  };
  return {
    row,
    address: [MC.clean(f.address, 200), MC.clean(f.city, 80), MC.clean(f.district, 60), MC.clean(f.state, 40), MC.clean(f.pin, 10)].filter(Boolean).join(', '),
    photo,
    superseded: Array.isArray(data.memberPhoto && data.memberPhoto.superseded) ? data.memberPhoto.superseded.length : 0,
    card: Object.assign({}, draft, { draft: !card }),
    reasons: Object.entries(MC.RETAKE_REASONS).map(([key, text]) => ({ key, text }))
  };
}

/* ---- the steps ------------------------------------------------------------- */

/* Sends a member a fresh photo link: the first, a resend, or a retake with
   reasons. The old link, if any, is retired in the same transaction. */
async function requestPhoto(db, reference, { by, at, nowMs, reasons, note, retake }) {
  const fieldValue = firebase.fieldValue;
  const { token, hash } = MC.newToken();
  const expiresAt = new Date(nowMs + MC.LINK_MS).toISOString();
  const ref = CASE.memberRecord(db, reference);
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'No membership carries that number.' };
    const data = snap.data() || {};
    const can = MC.requestable(data);
    if (!can.ok) return can;
    if (retake && data.status !== MC.STAGE.received) return { ok: false, code: 'BAD_STAGE', message: 'There is no photograph waiting for approval to ask again about.' };
    const prev = data.memberPhoto || {};
    tx.create(db.collection(MC.LINKS).doc(hash), { hash, reference, createdAt: at, expiresAt, by, retake: Boolean(retake) });
    if (prev.linkHash && prev.linkHash !== hash) {
      tx.set(db.collection(MC.LINKS).doc(prev.linkHash), { retiredAt: at, retiredBy: by }, { merge: true });
    }
    const photo = {
      linkHash: hash, linkExpiresAt: expiresAt, requestedAt: at, requestedBy: by,
      requests: (Number(prev.requests) || 0) + 1,
      reasons: reasons || [], retakeReason: (reasons || []).join(' ')
    };
    if (prev.current && data.status === MC.STAGE.received) {
      photo.current = '';
      photo.superseded = fieldValue().arrayUnion(prev.current);
    }
    const words = retake
      ? `Photograph not approved; a new link was emailed. ${(reasons || []).join(' ')}${note ? ` ${note}` : ''}`
      : (Number(prev.requests) || 0) ? 'A new photo link was emailed to the member.' : 'Photo link emailed to the member.';
    CASE.memberStep(tx, ref, fieldValue, { step: MC.STAGE.requested, at, by, photo, note: words.trim(), noteId: noteId(at, 'photo') });
    const f = data.fields || {};
    return { ok: true, email: can.email, name: MC.clean(f.name, 80), threadId: data.threadId || '' };
  });
  if (!done.ok) return done;
  const site = NOTIFY.publicSite();
  const payload = {
    name: done.name, memberId: reference, siteUrl: site, uploadUrl: NOTIFY.photoLink(token), expiresAt,
    reasons: retake ? [...(reasons || []), ...(note ? [note] : [])] : []
  };
  const mailed = await NOTIFY.send({ template: 'member_photo_request', to: done.email, payload,
    dedupeKey: `${reference}:${hash.slice(0, 24)}`, claimBy: 'membership', scrub: true });
  return { ok: true, reference, to: done.email, expiresAt, emailed: mailed.sent, mailNote: mailed.reason };
}

async function approve(db, reference, { by, at, printName }) {
  const fieldValue = firebase.fieldValue;
  const ref = CASE.memberRecord(db, reference);
  const cardRef = db.collection(MC.CARDS).doc(reference);
  let done;
  try {
    done = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cardSnap = await tx.get(cardRef);
      if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'No membership carries that number.' };
      const data = snap.data() || {};
      const can = MC.approvable(data);
      if (!can.ok) return can;
      if (cardSnap.exists) return { ok: false, code: 'ALREADY_ISSUED', message: `The card is already on the register (${reference}).` };
      const f = data.fields || {};
      const name = MC.printNameOf(printName, f.name);
      const problem = MC.printNameProblem(name);
      if (problem) return { ok: false, code: 'PRINT_NAME_BAD', message: problem };
      const card = MC.cardOf(reference, data, { printName: name, at, by });
      tx.create(cardRef, card);
      CASE.memberStep(tx, ref, fieldValue, {
        step: MC.STAGE.approved, at, by,
        card: { cardId: reference, printName: name, tierLabel: card.tierLabel, validUntil: card.validUntil, lifetime: card.lifetime, photo: card.photo, approvedAt: at, approvedBy: by, printedAt: '' },
        note: `Photograph approved. Membership card ${reference} issued${name !== MC.clean(f.name, 80) ? `, printed as ${name}` : ''}.`,
        noteId: noteId(at, 'card')
      });
      return { ok: true, card, email: MC.clean(f.email, 254).toLowerCase(), name: MC.clean(f.name, 80) };
    });
  } catch (error) {
    if (error && (error.code === 6 || /ALREADY_EXISTS/i.test(String(error.message)))) {
      return { ok: false, code: 'ALREADY_ISSUED', message: `The card is already on the register (${reference}).` };
    }
    throw error;
  }
  if (!done.ok) return done;
  let mailed = { sent: false, reason: 'No email on the membership.' };
  if (done.email) {
    mailed = await NOTIFY.send({ template: 'member_card_approved', to: done.email, dedupeKey: reference, claimBy: 'membership',
      payload: { name: done.name, memberId: reference, siteUrl: NOTIFY.publicSite(), tierLabel: done.card.tierLabel, validUntil: done.card.validUntil, lifetime: done.card.lifetime } });
  }
  return { ok: true, reference, card: done.card, emailed: mailed.sent, mailNote: mailed.reason };
}

async function markPrinted(db, reference, { by, at }) {
  const fieldValue = firebase.fieldValue;
  const ref = CASE.memberRecord(db, reference);
  const cardRef = db.collection(MC.CARDS).doc(reference);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cardSnap = await tx.get(cardRef);
    if (!snap.exists || !cardSnap.exists) return { ok: false, reference, reason: 'No approved card for this membership.' };
    const card = cardSnap.data() || {};
    if (card.status === 'revoked') return { ok: false, reference, reason: 'This card is revoked.' };
    if (card.cardPrintedAt) return { ok: true, reference, again: true };
    tx.set(cardRef, { printed: true, cardPrintedAt: at, printedBy: by }, { merge: true });
    CASE.memberStep(tx, ref, fieldValue, { step: 'card-printed', at, by, card: { printedAt: at } });
    return { ok: true, reference };
  });
}

/* Handed to the courier: only a printed card, once, with the courier's name
   and tracking number, both required. The member is told the courier and
   the number to follow it by, and nothing else: no card, no image of it. */
async function markDispatched(db, reference, { by, at, courier, trackingNumber }) {
  const fieldValue = firebase.fieldValue;
  const ref = CASE.memberRecord(db, reference);
  const cardRef = db.collection(MC.CARDS).doc(reference);
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cardSnap = await tx.get(cardRef);
    if (!snap.exists || !cardSnap.exists) return { ok: false, code: 'NO_CARD', message: 'No approved card for this membership.' };
    const card = cardSnap.data() || {};
    if (card.status === 'revoked') return { ok: false, code: 'REVOKED', message: 'This card is revoked.' };
    if (!card.cardPrintedAt) return { ok: false, code: 'NOT_PRINTED', message: 'Print the card and mark it printed before it is dispatched.' };
    if (card.dispatchedAt) return { ok: false, code: 'ALREADY_DISPATCHED', message: `Already dispatched by ${card.courier || 'courier'} (${card.trackingNumber || 'no number'}).` };
    tx.set(cardRef, { dispatchedAt: at, dispatchedBy: by, courier, trackingNumber }, { merge: true });
    CASE.memberStep(tx, ref, fieldValue, { step: 'card-dispatched', at, by, card: { dispatchedAt: at, courier, trackingNumber },
      note: `Membership card dispatched by courier: ${courier}, tracking number ${trackingNumber}.`, noteId: noteId(at, 'courier') });
    const f = (snap.data() || {}).fields || {};
    return { ok: true, email: MC.clean(f.email, 254).toLowerCase(), name: MC.clean(f.name, 80) };
  });
  if (!done.ok) return Object.assign({ reference }, done);
  let mailed = { sent: false, reason: 'No email on the membership.' };
  if (done.email) {
    mailed = await NOTIFY.send({ template: 'member_card_dispatched', to: done.email, dedupeKey: reference, claimBy: 'membership',
      payload: { name: done.name, memberId: reference, siteUrl: NOTIFY.publicSite(), courier, trackingNumber, dispatchedAt: at } });
  }
  return { ok: true, reference, emailed: mailed.sent, mailNote: mailed.reason };
}

/* The office's notice for the forms inbox: sent by the public route when a
   photograph arrives. Exported for it. */
async function tellOffice({ reference, name, tierLabel, receivedAt }) {
  const inboxes = FORWARD.formInboxes();
  const results = [];
  for (const to of inboxes) {
    results.push(await NOTIFY.send({ template: 'member_photo_staff', to, dedupeKey: `${reference}:${receivedAt}`, claimBy: 'membership',
      payload: { name, memberId: reference, tierLabel, receivedAt, panelUrl: NOTIFY.panelUrl(), siteUrl: NOTIFY.publicSite() } }));
  }
  return results;
}

/* ---- the route --------------------------------------------------------------- */

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, MODULE);
  if (!who) return undefined;
  const nowMs = Date.now();
  const at = new Date(nowMs).toISOString();
  const by = whoLabel(who);

  try {
    const db = firebase.getDb();

    if (request.method === 'GET') {
      const query = request.query || {};
      if (query.reference !== undefined) {
        const reference = referenceOf(query.reference);
        if (!reference) return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'A member number looks like PFA-MEM-2026-00012.' });
        const detail = await detailOf(db, reference, nowMs);
        if (!detail) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'No membership carries that number.' });
        if (detail.notMembership) return sendJson(response, 400, { code: 'NOT_A_MEMBERSHIP', message: 'That number is not a membership.' });
        return sendJson(response, 200, Object.assign({ ok: true }, detail));
      }
      const listed = await listAll(db, nowMs);
      const counts = {};
      ALL_QUEUES.forEach((q) => { counts[q] = 0; });
      listed.rows.forEach((r) => { counts[r.queue] = (counts[r.queue] || 0) + 1; });
      const queue = ALL_QUEUES.includes(String(query.queue)) ? String(query.queue) : (query.queue === 'all' ? 'all' : 'open');
      const q = MC.clean(query.q, 80).toLowerCase();
      const rows = listed.rows.filter((r) => (queue === 'all' || (queue === 'open' ? OPEN_QUEUES.includes(r.queue) : r.queue === queue))
        && (!q || [r.reference, r.name, r.email, r.mobile].join(' ').toLowerCase().includes(q)));
      return sendJson(response, 200, { ok: true, queue, rows, total: rows.length, counts, labels: MC.QUEUE_LABELS,
        capped: listed.capped, linkDays: MC.LINK_DAYS, mailConfigured: require('../../caregiver-mail').isConfigured() });
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }

    const body = await readBody(request);
    const action = MC.clean(body.action, 30);

    if (action === 'request-photo') {
      const references = referencesOf(body.references);
      if (!references.length) return sendJson(response, 400, { code: 'NO_REFERENCES', message: 'Which memberships?' });
      const results = [];
      for (const reference of references) {
        results.push(Object.assign({ reference }, await requestPhoto(db, reference, { by, at, nowMs })));
      }
      const sent = results.filter((r) => r.ok).map((r) => r.reference);
      if (sent.length) await audit.record(who, { module: MODULE, action: 'member-photo-request', subject: sent.length === 1 ? sent[0] : `${sent.length} memberships`, detail: `Photo link emailed: ${sent.slice(0, 5).join(', ')}${sent.length > 5 ? '...' : ''}` }, request);
      return sendJson(response, 200, { ok: true, action, results });
    }

    if (action === 'retake') {
      const reference = referenceOf(body.reference);
      if (!reference) return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'Which membership?' });
      const reasons = [...new Set((Array.isArray(body.reasons) ? body.reasons : []).map((k) => MC.RETAKE_REASONS[MC.clean(k, 20)]).filter(Boolean))];
      const note = MC.clean(body.note, MC.REASON_MAX);
      if (!reasons.length && !note) return sendJson(response, 400, { code: 'NO_REASON', message: 'Tick what is wrong with the photograph, or write it.' });
      const result = await requestPhoto(db, reference, { by, at, nowMs, reasons, note, retake: true });
      if (!result.ok) return sendJson(response, result.code === 'NOT_FOUND' ? 404 : 409, result);
      await audit.record(who, { module: MODULE, action: 'member-photo-retake', subject: reference, detail: `New photograph asked for: ${reasons.concat(note ? [note] : []).join(' ').slice(0, 200)}` }, request);
      return sendJson(response, 200, Object.assign({ action }, result));
    }

    if (action === 'approve') {
      const reference = referenceOf(body.reference);
      if (!reference) return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'Which membership?' });
      const result = await approve(db, reference, { by, at, printName: body.printName });
      if (!result.ok) {
        await audit.record(who, { module: MODULE, action: 'member-card-approve', subject: reference, detail: result.message, outcome: 'refused' }, request);
        return sendJson(response, result.code === 'NOT_FOUND' ? 404 : result.code === 'PRINT_NAME_BAD' ? 422 : 409, result);
      }
      await audit.record(who, { module: MODULE, action: 'member-card-approve', subject: reference, detail: `Photograph approved; membership card issued, printed as ${result.card.printName}` }, request);
      return sendJson(response, 200, Object.assign({ action }, result));
    }

    if (action === 'printed') {
      const references = referencesOf(body.references);
      if (!references.length) return sendJson(response, 400, { code: 'NO_REFERENCES', message: 'Which cards?' });
      const results = [];
      for (const reference of references) results.push(await markPrinted(db, reference, { by, at }));
      const done = results.filter((r) => r.ok && !r.again).map((r) => r.reference);
      if (done.length) await audit.record(who, { module: MODULE, action: 'member-cards-printed', subject: done.length === 1 ? done[0] : `${done.length} cards`, detail: `Marked as printed: ${done.slice(0, 5).join(', ')}${done.length > 5 ? '...' : ''}` }, request);
      return sendJson(response, 200, { ok: true, action, results });
    }

    if (action === 'dispatched') {
      const reference = referenceOf(body.reference);
      if (!reference) return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'Which card?' });
      const courier = MC.courierOf(body.courier);
      const trackingNumber = MC.trackingOf(body.trackingNumber);
      if (!courier) return sendJson(response, 422, { code: 'NO_COURIER', message: 'Name the courier the card was handed to.' });
      if (!trackingNumber) return sendJson(response, 422, { code: 'NO_TRACKING', message: 'Type the courier\'s tracking number (letters and digits).' });
      const result = await markDispatched(db, reference, { by, at, courier, trackingNumber });
      if (!result.ok) return sendJson(response, result.code === 'NO_CARD' ? 404 : 409, result);
      await audit.record(who, { module: MODULE, action: 'member-card-dispatched', subject: reference, detail: `Dispatched by courier: ${courier}, ${trackingNumber}` }, request);
      return sendJson(response, 200, Object.assign({ action }, result));
    }

    return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be request-photo, retake, approve, printed or dispatched.' });
  } catch (error) {
    console.error('admin membership failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done right now. Refresh to see what is on file, then try again.' });
  }
};

module.exports._private = { listAll, detailOf, requestPhoto, approve, markPrinted, markDispatched, tellOffice, referenceOf, referencesOf };
module.exports.tellOffice = tellOffice;
