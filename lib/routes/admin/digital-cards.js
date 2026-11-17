'use strict';

/* GET  /api/admin/digital-cards?kind=caregiver|member&ref=...   the card's digital card, if it has one
   GET  /api/admin/digital-cards?kind=...&ref=...&preview=1       the card as it would be online, with its photograph
   POST /api/admin/digital-cards { action: 'issue', kind, ref, photo, email }
   POST /api/admin/digital-cards { action: 'withdraw', kind, id }
   POST /api/admin/digital-cards { action: 'correct', kind, ref, name, district, state }

   Issuing a card online, from its card studio (owner, 15 Nov 2026: "Add an
   option to issue digital caregiver and membership cards"). ref is the
   colony caregiver card's number, or the membership's reference; photo is
   the photograph as the studio drew it on the card. Issuing gives the card
   its address (lib/digital-cards.js) and, with email, sends the holder the
   link. Issuing again brings the online card up to date. A caregiver card
   by whoever has Caregivers, a membership card by whoever has Members;
   every issue and withdrawal is in the audit log. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const DC = require('../../digital-cards');

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
    request.on('data', (c) => { raw += c; if (raw.length > 2 * 1024 * 1024) raw = raw.slice(0, 2 * 1024 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}
function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}
const kindOf = (v) => (v === 'member' ? 'member' : v === 'caregiver' ? 'caregiver' : '');

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  const notify = d.notify || ((m) => require('../../membership-notify').send(m));
  return async function handler(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const body = request.method === 'POST' ? await readBody(request) : queryOf(request);
    const kind = kindOf(body.kind);
    if (!kind) return sendJson(response, 400, { code: 'BAD_KIND', message: 'Say which card: a colony caregiver card or a membership card.' });
    const who = await requireAdmin(request, response, DC.KINDS[kind].module);
    if (!who) return undefined;
    try {
      const db = getDb();
      if (request.method === 'GET' && body.preview === '1') {
        const p = await DC.preview(db, kind, body.ref, now());
        if (!p.ok) return sendJson(response, p.status, { code: 'NO_CARD', message: p.message });
        return sendJson(response, 200, p);
      }
      /* the address a card will have, for the QR code on a preview before it is issued */
      if (request.method === 'GET' && body.address === '1') return sendJson(response, 200, { ok: true, url: await DC.addressOf(db, kind, body.ref) });
      if (request.method === 'GET') return sendJson(response, 200, { ok: true, digital: await DC.statusOf(db, kind, body.ref) });
      /* the name, district and state on the card, corrected (17 Nov 2026) */
      if (body.action === 'correct') {
        const r = await DC.correct(db, { kind, ref: body.ref, name: body.name, district: body.district, state: body.state, who, nowMs: now() });
        if (!r.ok) return sendJson(response, r.status, { code: 'NOT_CORRECTED', message: r.message });
        if (r.changed) await audit.record(who, { module: DC.KINDS[kind].module, action: 'card-corrected', subject: String(body.ref || '').toUpperCase().slice(0, 40), detail: `${DC.KINDS[kind].label}: ${Object.entries(r.changes).map(([k, v]) => `${k === 'printName' ? 'name' : k} now ${v}`).join(', ')}${r.online ? ', online card brought up to date' : ''}` }, request);
        return sendJson(response, 200, { ok: true, changed: r.changed, online: r.online || null, note: r.note || '' });
      }
      if (body.action === 'issue') {
        /* from a register, with no card studio on screen: the photograph kept on the server */
        const photoFile = body.photo ? null : await DC.storedPhoto(db, kind, body.ref);
        if (kind === 'caregiver' && !body.photo && !photoFile) {
          const was = await DC.statusOf(db, kind, body.ref);
          if (!was) return sendJson(response, 422, { code: 'NOT_ISSUED', message: 'No photograph was found with the application, so the card is not issued online. Open it in the Card studio and add the photograph there.' });
        }
        const r = await DC.issue(db, { kind, ref: body.ref, photo: body.photo, photoFile, who, nowMs: now(), makeId: d.makeId });
        if (!r.ok) return sendJson(response, r.status, { code: 'NOT_ISSUED', message: r.message });
        await audit.record(who, { module: DC.KINDS[kind].module, action: 'digital-card-issued', subject: r.id, detail: `${DC.KINDS[kind].label} for ${r.card.name}${r.again ? ', brought up to date' : ''}: ${r.url}` }, request);
        let mail = { sent: false, reason: '' };
        if (body.email !== false && r.email) {
          mail = await notify({ template: 'digital_card', to: r.email, claimBy: DC.KINDS[kind].module,
            dedupeKey: `${r.id}:${String(r.card.issuedOn)}:${r.again ? now() : 'first'}`,
            payload: { name: r.firstName, kind, kindLabel: r.card.kindLabel, number: r.card.number, url: r.url, siteUrl: require('../../public-site').publicSite() } });
        } else if (!r.email) mail.reason = 'There is no email on the card, so the link was not sent.';
        return sendJson(response, 200, { ok: true, digital: r.card, to: r.email || '', emailed: Boolean(mail.sent), mailNote: mail.reason || '' });
      }
      /* Ask for a photograph, one or many at once (owner, 17 Nov 2026: "option
         to ask for photo should be there. for each and for all at once"): a
         member by the membership's own photo link, a colony caregiver by the
         same kind of link (lib/caregiver-photo.js); refs are references */
      if (body.action === 'ask-photo') {
        const refs = (Array.isArray(body.refs) ? body.refs : []).map((x) => String(x || '').toUpperCase().trim()).filter((x) => /^PFA-(MEM|CG)-\d{4}-\d{5}$/.test(x)).slice(0, 300);
        if (!refs.length) return sendJson(response, 400, { code: 'NO_REFERENCES', message: 'Which cards?' });
        const nowMs = now();
        const at = new Date(nowMs).toISOString();
        const by = who.email || who.name || '';
        const ask = kind === 'member' ? require('./membership')._private.requestPhoto : require('../../caregiver-photo').request;
        const results = [];
        for (const ref of refs) results.push(Object.assign({ reference: ref }, await ask(db, ref, { by, at, nowMs })));
        const sent = results.filter((x) => x.ok).map((x) => x.reference);
        if (sent.length) await audit.record(who, { module: DC.KINDS[kind].module, action: 'card-photo-request', subject: sent.length === 1 ? sent[0] : `${sent.length} cards`, detail: `Photo link emailed: ${sent.slice(0, 5).join(', ')}${sent.length > 5 ? '...' : ''}` }, request);
        return sendJson(response, 200, { ok: true, results });
      }
      if (body.action === 'withdraw') {
        const id = String(body.id || '').toUpperCase();
        if (!DC.ID.test(id)) return sendJson(response, 400, { code: 'BAD_ID', message: 'That is not a digital card address.' });
        const r = await DC.withdraw(db, id, { who, nowMs: now() });
        if (!r.ok) return sendJson(response, r.status, { code: 'NOT_FOUND', message: r.message });
        await audit.record(who, { module: DC.KINDS[kind].module, action: 'digital-card-withdrawn', subject: id, detail: `${DC.KINDS[kind].label} withdrawn online` }, request);
        return sendJson(response, 200, { ok: true, digital: r.card });
      }
      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Issue or withdraw.' });
    } catch (error) {
      console.error('digital card', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
