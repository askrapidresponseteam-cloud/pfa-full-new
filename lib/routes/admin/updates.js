'use strict';
/* /api/admin/updates: the panel's Updates section, "From PFA" news and
   notices for the public site (lib/site-updates.js).
     GET                                             every update, drafts too
     POST { action: 'save', id?, title, body, ... }  a new update, or a change
     POST { action: 'remove', id }                   off the site (kept)
     POST { action: 'upload', kind, type, size }     where to send a film or
                                                     picture (lib/update-media.js)
     POST { action: 'uploaded', path }               checks it arrived; its address
   Every change is in the audit log. */
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const U = require('../../site-updates');
const M = require('../../update-media');

const MODULE = 'updates';
const MAX_BODY = 64 * 1024;

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
  const media = d.media || M;
  return async function handler(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const who = await requireAdmin(request, response, MODULE);
    if (!who) return undefined;
    const by = (who && (who.email || who.name)) || 'admin';
    const log = (action, subject, detail) => audit.record(who, { module: MODULE, action, subject, detail }, request).catch(() => {});
    try {
      const db = getDb();
      if (request.method === 'GET') return sendJson(response, 200, { ok: true, updates: await U.all(db) });
      const body = await readBody(request);
      if (body.tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That is too long to send.' });
      const action = String(body.action || '');
      let r;
      if (action === 'save') r = await U.save(db, by, body, now());
      else if (action === 'remove') r = await U.remove(db, by, body.id, now());
      else if (action === 'upload') {
        const origin = String((request.headers && (request.headers.origin || '')) || body.origin || '');
        r = await media.start({ kind: body.kind, type: body.type, size: body.size, origin });
        if (!r.ok) return sendJson(response, 422, { code: 'NOT_DONE', message: r.message, storage: r.storage });
        return sendJson(response, 200, r);
      } else if (action === 'uploaded') {
        r = await media.finish(body.path);
        if (!r.ok) return sendJson(response, 422, { code: 'NOT_DONE', message: r.message });
        return sendJson(response, 200, r);
      } else return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do.' });
      if (!r.ok) return sendJson(response, 422, { code: 'NOT_DONE', message: r.message });
      const said = action === 'save'
        ? `${r.status === 'draft' ? 'Update saved as a draft' : 'Update on the site'}: ${r.title}`
        : `Update taken off the site: ${r.title}`;
      await log('update-' + action, r.id, said.slice(0, 200));
      return sendJson(response, 200, r);
    } catch (error) {
      console.error('admin updates', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
