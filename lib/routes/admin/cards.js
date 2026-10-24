/* GET  /api/admin/cards?type=caregiver&filter=unprinted|unposted|current|all&q=
   POST /api/admin/cards   { action: 'printed' | 'posted', type, ids: [...] }

   Print and post, from the panel. Only a physical card goes to the holder
   (owner, 24 Oct 2026: "only physical card will go to the applicant. card
   print/preview/edit option should be for admin only."): the card is drawn
   in the administrator's browser (assets/caregiver-card.js) and nowhere
   else, printed, and posted. Nothing here emails a card or a link to one.
   This route supplies the register rows the renderer needs, records each
   card as printed and then as posted, and when it is posted tells the
   holder it is on its way (lib/caregiver-mail.js card_posted). Each step
   is also written on the application the card came from, so the applicant
   sees "Card printed" and "Card posted" when they follow it.

   Photographs are never on the server by design - they stay on the holder's
   device - so nothing here returns one. The panel can match photographs from
   the office's own files to card numbers, in the browser, before printing. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb, fieldValue } = require('../../../lib/firebase');
const CAREGIVER = require('../../../lib/caregiver');
const CASE = require('./case');
const store = require('../../../lib/caregiver-store');
const mail = require('../../../lib/caregiver-mail');
const RULES = require('../../../assets/field-rules.js');
const audit = require('../../../lib/admin-audit');
const PLACE = require('../../../lib/caregiver-place');

const MAX_ROWS = 500;
const MAX_PER_POST = 25;
const TYPES = new Set(['caregiver']);
const FILTERS = new Set(['unprinted', 'unposted', 'current', 'all']);

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
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function expired(iso, nowMs) {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms < nowMs : false;
}

function addressLines(address, district, state, pin) {
  const lines = [];
  if (address) lines.push(address);
  const district_pin = [district, pin].filter(Boolean).join(' ');
  if (district_pin) lines.push(district_pin);
  if (state) lines.push(state);
  return lines.slice(0, 3).map((l) => clean(l, 60));
}


function caregiverRow(id, c, nowMs) {
  return {
    id,
    type: 'caregiver',
    name: RULES.nameCase(c.name || ''),
    printName: clean(c.printName, 80),
    email: clean(c.email, 254).toLowerCase(),
    mobile: clean(c.mobile, 20),
    address: clean(c.address, 240),
    pin: clean(c.pin, 10),
    /* printed on the back under DISTRICT and STATE. Not "state": that word
       is already this row's standing (valid, expired, revoked). */
    district: clean(c.district, 60),
    placeState: clean(c.state, 40),
    issuedAt: c.issuedAt || '',
    valid: c.validUntil || '',
    state: c.status === 'revoked' ? 'revoked' : (expired(c.validUntil, nowMs) ? 'expired' : 'valid'),
    printed: Boolean(c.printed),
    printedAt: c.cardPrintedAt || '',
    postedAt: c.cardPostedAt || '',
    /* the envelope: where the printed card goes */
    postTo: CAREGIVER.postalLines(c),
    postable: CAREGIVER.postable(c),
    applicationRef: clean(c.applicationRef, 40)
  };
}

function keep(row, filter) {
  if (filter === 'all') return true;
  if (row.state !== 'valid') return false;
  const printed = Boolean(row.printedAt || row.printed);
  if (filter === 'unprinted') return !printed;
  if (filter === 'unposted') return printed && !row.postedAt;
  return true;
}

function matches(row, q) {
  if (!q) return true;
  const hay = [row.id, row.name, row.email, row.mobile].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

async function listCaregivers(db, nowMs) {
  const snapshot = await db.collection('caretakerCards').orderBy('__name__').limit(MAX_ROWS).get();
  const rows = snapshot.docs.map((d) => caregiverRow(d.id, d.data(), nowMs));
  await Promise.all(rows.map((row) => placeFromApplication(db, row)));
  return { rows, capped: snapshot.size >= MAX_ROWS };
}

/* A card issued before v1.450 was issued without its district and state
   (lib/caregiver-place.js says why), so its back printed "-" under both.
   Read them back from the application it was approved from, once: they are
   written onto the card, and onto its public record, so the next list finds
   them there. A card with neither an application nor a place stays as it is. */
async function placeFromApplication(db, row) {
  if ((row.district && row.placeState) || !row.applicationRef) return;
  try {
    const place = await PLACE.placeOfApplication(db, row.applicationRef);
    const district = row.district || place.district;
    const state = row.placeState || place.state;
    if (district === row.district && state === row.placeState) return;
    row.district = district;
    row.placeState = state;
    await db.collection('caretakerCards').doc(row.id).set({ district, state }, { merge: true });
    /* only onto a public record that is there: never one made of a place alone */
    const pub = db.collection('caretakerPublic').doc(row.id);
    if ((await pub.get()).exists) await pub.set({ district, state }, { merge: true });
  } catch (_) { /* the card still lists, with "-" where the place would be */ }
}

/* ---- printing and posting ------------------------------------------------ */

/* "Card printed" and "Card posted" on the application, which is where the
   applicant follows it (lib/submissions.js publicRow). Written through the
   case route, where every write to an application lives. A card from before
   applications existed has no application, and nothing is written. */
function onApplication(db, batch, card, event, at, by) {
  const reference = clean(card && card.applicationRef, 40);
  if (!reference) return;
  CASE.cardStepOnApplication(db, batch, fieldValue, { reference, cardId: clean(card.cardId, 40), event, at, by });
}

async function readCards(db, ids) {
  return Promise.all(ids.map(async (id) => {
    const snap = await db.collection('caretakerCards').doc(id).get();
    return { id, card: snap.exists ? { cardId: id, ...snap.data() } : null };
  }));
}

async function markPrinted(db, type, ids, nowMs, by) {
  const at = new Date(nowMs).toISOString();
  const read = await readCards(db, ids);
  const batch = db.batch();
  const results = read.map(({ id, card }) => {
    if (!card) return { id, ok: false, reason: 'Not on the register.' };
    if (card.status === 'revoked') return { id, ok: false, reason: 'This card is revoked.' };
    /* printed again (a misprint, a jam): the first date stands, and the
       application is not told twice */
    if (card.cardPrintedAt) return { id, ok: true, again: true };
    batch.set(db.collection('caretakerCards').doc(id), { printed: true, cardPrintedAt: at }, { merge: true });
    batch.set(db.collection('caretakerPublic').doc(id), { printed: true }, { merge: true });
    onApplication(db, batch, card, 'card-printed', at, by);
    return { id, ok: true };
  });
  await batch.commit();
  return results;
}

/* Posted: the card is in the post to the address it was issued with. Only
   a printed card can be posted, and each card is posted once. The holder is
   told by email when there is an address to tell; the email carries no card
   number and no link to a card (the card is in the envelope). */
async function markPosted(db, type, ids, nowMs, by) {
  const at = new Date(nowMs).toISOString();
  const read = await readCards(db, ids);
  const batch = db.batch();
  const posted = [];
  const results = read.map(({ id, card }) => {
    if (!card) return { id, ok: false, reason: 'Not on the register.' };
    if (card.status === 'revoked') return { id, ok: false, reason: 'This card is revoked.' };
    if (!card.printed && !card.cardPrintedAt) return { id, ok: false, reason: 'Not printed yet.' };
    if (card.cardPostedAt) return { id, ok: false, reason: 'Already posted.' };
    if (!CAREGIVER.postable(card)) return { id, ok: false, reason: 'No postal address on the card.' };
    batch.set(db.collection('caretakerCards').doc(id), { cardPostedAt: at, postedBy: by }, { merge: true });
    onApplication(db, batch, card, 'card-posted', at, by);
    posted.push(card);
    return { id, ok: true };
  });
  await batch.commit();
  for (const card of posted) {
    const row = results.find((r) => r.id === card.cardId);
    row.emailed = await tellPosted(db, card, at);
  }
  return results;
}

async function tellPosted(db, card, at) {
  const to = clean(card.email, 254).toLowerCase();
  if (!to) return false;
  const template = 'card_posted';
  const payload = { name: RULES.nameCase(card.name || ''), applicationRef: clean(card.applicationRef, 40),
    postedAt: at, postTo: CAREGIVER.postalLines(card) };
  try {
    const queued = await store.queueEmail({ template, to, payload, dedupeKey: `${template}:${card.cardId}`, claim: mail.isConfigured() ? 'panel' : undefined });
    if (!queued.created || !mail.isConfigured()) return queued.status === 'sent';
    try {
      const sent = await mail.deliver({ to, template, payload });
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
      return true;
    } catch (error) {
      /* queued: the email worker retries it with backoff */
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
      return false;
    }
  } catch (error) {
    console.error('card posted: email not queued', error && error.message);
    return false;
  }
}

function cleanIds(type, value) {
  const pattern = /^PFA-CCT-[A-Z0-9]{8}$/;
  return [...new Set((Array.isArray(value) ? value : []).map((v) => clean(v, 40).toUpperCase()).filter((v) => pattern.test(v)))].slice(0, MAX_PER_POST);
}

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, 'cards');
  if (!who) return;
  const nowMs = Date.now();

  try {
    const db = getDb();

    if (request.method === 'GET') {
      const query = request.query || {};
      const type = String(query.type || 'caregiver');
      const filter = FILTERS.has(String(query.filter)) ? String(query.filter) : 'unprinted';
      const q = clean(query.q, 80);
      if (!TYPES.has(type)) return sendJson(response, 400, { code: 'BAD_TYPE', message: 'type must be caregiver.' });
      const listed = await listCaregivers(db, nowMs);
      const rows = listed.rows.filter((r) => keep(r, filter) && matches(r, q));
      return sendJson(response, 200, {
        ok: true, type, filter, rows, total: rows.length, registerTotal: listed.rows.length, capped: listed.capped,
        mailConfigured: mail.isConfigured()
      });
    }

    if (request.method === 'POST') {
      const body = await readBody(request);
      const type = String(body.type || '');
      const action = String(body.action || '');
      if (!TYPES.has(type)) return sendJson(response, 400, { code: 'BAD_TYPE', message: 'type must be caregiver.' });
      const ids = cleanIds(type, body.ids);
      if (!ids.length) return sendJson(response, 400, { code: 'NO_IDS', message: 'Which cards?' });

      const by = who.email || who.uid || '';
      const listOf = (results) => results.filter((r) => r.ok).map((r) => r.id);
      if (action === 'printed') {
        const results = await markPrinted(db, type, ids, nowMs, by);
        const done = listOf(results);
        if (done.length) audit.record(who, { module: 'cards', action: 'cards-printed', subject: `${done.length} cards`, detail: `Marked as printed: ${done.slice(0, 5).join(', ')}${done.length > 5 ? '…' : ''}` }, request);
        return sendJson(response, 200, { ok: true, action, results });
      }
      if (action === 'posted') {
        const results = await markPosted(db, type, ids, nowMs, by);
        const done = listOf(results);
        if (done.length) audit.record(who, { module: 'cards', action: 'cards-posted', subject: `${done.length} cards`, detail: `Marked as posted: ${done.slice(0, 5).join(', ')}${done.length > 5 ? '…' : ''}` }, request);
        return sendJson(response, 200, { ok: true, action, results, mailConfigured: mail.isConfigured() });
      }
      /* 'email' sent the holder a link to a downloadable card. Retired: the
         printed card is the only copy. */
      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be printed or posted. Cards are not emailed: the printed card is posted.' });
    }

    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    console.error('admin cards failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done right now.' });
  }
};

module.exports._private = { caregiverRow, keep, matches, addressLines, cleanIds, listCaregivers, markPrinted, markPosted };
