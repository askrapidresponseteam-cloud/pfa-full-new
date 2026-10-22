/* GET  /api/admin/cards?type=caregiver&filter=unsent|unprinted|current|all&q=
   POST /api/admin/cards   { action: 'email' | 'printed', type, ids: [...] }

   Bulk issuance from the panel. The cards themselves are drawn in the
   administrator's browser by the same two renderers the public site uses
   (assets/caregiver-card.js), so a card
   printed from here is stroke for stroke the card a member or caregiver sees
   on their own screen. This route only supplies the register rows those
   renderers need, sends the emails, and records what was done.

   Photographs are never on the server by design - they stay on the holder's
   device - so nothing here returns one. The panel can match photographs from
   the office's own files to card numbers, in the browser, before printing. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb } = require('../../../lib/firebase');
const store = require('../../../lib/caregiver-store');
const mail = require('../../../lib/caregiver-mail');
const RULES = require('../../../assets/field-rules.js');
const audit = require('../../../lib/admin-audit');
const PLACE = require('../../../lib/caregiver-place');

const MAX_ROWS = 500;
const MAX_PER_POST = 25;
const TYPES = new Set(['caregiver']);
const FILTERS = new Set(['unsent', 'unprinted', 'current', 'all']);

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

function siteUrl(request) {
  const configured = clean(process.env.PUBLIC_SITE_URL, 300);
  try { const u = new URL(configured); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* fall through */ }
  const host = (request.headers || {})['x-forwarded-host'] || (request.headers || {}).host || 'pfa-full-website.vercel.app';
  return `https://${host}`;
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
    emailedAt: c.cardEmailedAt || '',
    printedAt: c.cardPrintedAt || '',
    applicationRef: clean(c.applicationRef, 40)
  };
}

function keep(row, filter) {
  if (filter === 'all') return true;
  if (row.state !== 'valid') return false;
  if (filter === 'unsent') return !row.emailedAt && Boolean(row.email);
  if (filter === 'unprinted') return !row.printedAt && !row.printed;
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

/* ---- sending ---------------------------------------------------------------- */

function dayKey(nowMs) { return new Date(nowMs).toISOString().slice(0, 10); }

async function emailOne(db, type, id, request, nowMs) {
  const collection = 'caretakerCards';
  const ref = db.collection(collection).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { id, ok: false, reason: 'Not on the register.' };
  const record = snapshot.data();
  const to = clean(record.email, 254).toLowerCase();
  if (!to) return { id, ok: false, reason: 'No email address on record.' };
  if (type === 'caregiver' && record.status === 'revoked') return { id, ok: false, reason: 'This card is revoked.' };

  const base = siteUrl(request);
  const template = 'card_issued';
  const payload = { name: RULES.nameCase(record.name || ''), cardId: id, issuedAt: record.issuedAt,
    validUntil: record.validUntil, cardUrl: `${base}/caregiver-card.html?id=${encodeURIComponent(id)}` };

  /* One send per card per day from the panel: a double click cannot send
     twice, but a card can be sent again tomorrow if it has to be. */
  const queued = await store.queueEmail({ template, to, payload, dedupeKey: `${template}:${id}:${dayKey(nowMs)}:admin`, claim: 'panel' });
  if (!queued.created) return { id, ok: false, reason: 'Already sent today.' };

  try {
    const sent = await mail.deliver({ to, template, payload });
    await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
  } catch (error) {
    /* Queued: the email worker retries it with backoff. From the panel's
       point of view it is on its way, and the record says so. */
    await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
    if (error && error.permanent) return { id, ok: false, reason: `The address was refused: ${clean(error.message, 120)}` };
  }
  await ref.set({ cardEmailedAt: new Date(nowMs).toISOString() }, { merge: true });
  return { id, ok: true };
}

async function markPrinted(db, type, ids, nowMs) {
  const at = new Date(nowMs).toISOString();
  const batch = db.batch();
  ids.forEach((id) => {
    {
      batch.set(db.collection('caretakerCards').doc(id), { printed: true, cardPrintedAt: at }, { merge: true });
      batch.set(db.collection('caretakerPublic').doc(id), { printed: true }, { merge: true });
    }
  });
  await batch.commit();
  return ids.map((id) => ({ id, ok: true }));
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
      const filter = FILTERS.has(String(query.filter)) ? String(query.filter) : 'unsent';
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

      if (action === 'printed') {
        const results = await markPrinted(db, type, ids, nowMs);
        audit.record(who, { module: 'cards', action: 'cards-printed', subject: `${ids.length} cards`, detail: `Marked as printed: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}` }, request);
        return sendJson(response, 200, { ok: true, action, results });
      }
      if (action === 'email') {
        if (!mail.isConfigured()) {
          return sendJson(response, 503, { code: 'MAIL_NOT_CONFIGURED', message: 'Email is not set up on the server (PFA_MAIL_API_KEY). Cards can still be downloaded.' });
        }
        const results = [];
        for (const id of ids) results.push(await emailOne(db, type, id, request, nowMs));
        audit.record(who, { module: 'cards', action: 'cards-emailed', subject: `${ids.length} cards`, detail: `Emailed to holders: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}` }, request);
        return sendJson(response, 200, { ok: true, action, results, by: who.email || who.uid });
      }
      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be email or printed.' });
    }

    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    console.error('admin cards failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done right now.' });
  }
};

module.exports._private = { caregiverRow, keep, matches, addressLines, cleanIds, listCaregivers };
