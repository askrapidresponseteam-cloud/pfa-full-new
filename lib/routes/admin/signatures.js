'use strict';
/* /api/admin/signatures: the signature collection, behind its password
   (lib/signature-vault.js; owner, 22 Nov 2026).
     GET                                   the names in the collection and
                                           what letters, certificates and
                                           cards are drawn with; never a
                                           signature itself
     POST { action: 'check', password }             the password, alone
     POST { action: 'unlock', password, id }        the vector, to this
                                           admin's panel, to draw it
     POST { action: 'add', password, name, svg }    a new signature, sealed
     POST { action: 'use', password, place, id, colour, picture }
                                           a place drawn with it from now on
     POST { action: 'builtin', password, place }    back to the built-in one
     POST { action: 'password', password, next }    a new password
   Every action asks the password; every try, right or wrong, and every
   change is in the audit log, never the password itself. Kept with the
   Certificates in the panel: whoever has Certificates. */
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const V = require('../../signature-vault');

const MODULE = 'certificates';
const MAX_BODY = 3.5 * 1024 * 1024;

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
    request.on('data', (c) => { if (over) return; raw += c; if (raw.length > MAX_BODY) { over = true; raw = ''; } });
    request.on('end', () => { if (over) return resolve({ tooLarge: true }); try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  return async function handler(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const who = await requireAdmin(request, response, MODULE);
    if (!who) return undefined;
    const db = getDb();
    const by = (who && (who.email || who.name)) || 'admin';
    const log = (action, subject, detail) => audit.record(who, { module: MODULE, action, subject, detail }, request).catch(() => {});
    try {
      if (request.method === 'GET') return sendJson(response, 200, Object.assign({ ok: true }, await V.list(db)));
      const body = await readBody(request);
      if (body.tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That is too large to send.' });
      const action = String(body.action || '');
      if (!['check', 'unlock', 'add', 'use', 'builtin', 'password'].includes(action)) return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do.' });
      /* the password, first, for every action */
      const gate = await V.admit(db, by, body.password, now());
      if (!gate.ok) {
        await log('signature-password', action, gate.code === 'LOCKED' ? 'Signatures: tried while locked' : 'Signatures: a wrong password');
        return sendJson(response, gate.code === 'LOCKED' ? 429 : 422, { code: gate.code, message: gate.message });
      }
      if (action === 'check') {
        await log('signature-unlock', 'signatures', 'Signatures opened in the panel');
        return sendJson(response, 200, { ok: true });
      }
      if (action === 'unlock') {
        const r = await V.unlock(db, body.password, body.id);
        if (!r.ok) return sendJson(response, 404, { code: 'NOT_OPENED', message: r.message });
        await log('signature-unlock', r.id, `Signature opened in the panel: ${r.name}`);
        return sendJson(response, 200, { ok: true, id: r.id, name: r.name, vector: r.vector });
      }
      if (action === 'add') {
        const r = await V.add(db, by, body.password, body.name, body.svg, now());
        if (!r.ok) return sendJson(response, 422, { code: 'NOT_ADDED', message: r.message });
        await log('signature-add', r.id, `Signature added to the collection: ${r.name}`);
        return sendJson(response, 200, r);
      }
      if (action === 'use') {
        const r = await V.use(db, by, body.place, body.id, body.colour, body.picture, now());
        if (!r.ok) return sendJson(response, 422, { code: 'NOT_USED', message: r.message });
        await log('signature-use', r.place, `${V.PLACES[r.place].label} now signed with ${r.id}, in ${r.colour}`);
        return sendJson(response, 200, r);
      }
      if (action === 'builtin') {
        const r = await V.reset(db, by, body.place, now());
        if (!r.ok) return sendJson(response, 422, { code: 'NOT_USED', message: r.message });
        await log('signature-use', r.place, `${V.PLACES[r.place].label} back to the built-in signature`);
        return sendJson(response, 200, r);
      }
      const r = await V.changePassword(db, body.password, body.next);
      if (!r.ok) return sendJson(response, 422, { code: 'NOT_CHANGED', message: r.message });
      await log('signature-password-change', 'signatures', `Signatures password changed; ${r.resealed} sealed again`);
      return sendJson(response, 200, r);
    } catch (error) {
      console.error('signatures', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
