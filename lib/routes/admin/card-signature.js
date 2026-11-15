'use strict';

/* POST /api/admin/card-signature { card: 'caregiver' | 'member', x, y }

   Where Smt. Maneka Sanjay Gandhi's signature sits on the colony caregiver
   card and on the membership card (owner, 15 Nov 2026: "Add Maneka Gandhi's
   signature to caregiver and membership cards using the same logic as the
   internship certificate"). As the certificate's: one setting for the whole
   site, how far the signature is moved from where the card first puts it,
   in the card's tenths of a millimetre (lib/certificate-layout.js), set
   from the card studio's Signature position and read by every card the
   panel draws, prints or saves. A caregiver card's is changed by whoever
   has Caregivers, a membership card's by whoever has Members; every
   change is in the audit log. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const L = require('../../certificate-layout');

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
    request.on('data', (c) => { raw += c; if (raw.length > 4096) raw = raw.slice(0, 4096); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const body = await readBody(request);
    const card = Object.prototype.hasOwnProperty.call(L.CARDS, body.card) ? body.card : 'caregiver';
    const who = await requireAdmin(request, response, L.CARDS[card].module);
    if (!who) return undefined;
    const checked = L.checkCard(body);
    if (!checked.ok) return sendJson(response, 422, { code: 'BAD_LAYOUT', message: checked.message });
    try {
      const r = await L.writeCard(getDb(), checked.card, checked.x, checked.y, who, now());
      await audit.record(who, { module: L.CARDS[checked.card].module, action: 'card-signature', subject: checked.card, detail: `Signature on the ${L.CARDS[checked.card].label} moved from ${r.before.x} across, ${r.before.y} down to ${r.after.x} across, ${r.after.y} down` }, request);
      return sendJson(response, 200, { ok: true, card: checked.card, layout: r.after });
    } catch (error) {
      console.error('card signature not saved', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be saved just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
