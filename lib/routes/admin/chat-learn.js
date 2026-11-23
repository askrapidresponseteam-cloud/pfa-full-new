'use strict';
/* /api/admin/chat-learn: teaching the site's chat (lib/chat-learn.js;
   owner, 23 Nov 2026: "can you have chat module keep learning and get
   better").
     GET                                         what visitors asked that the
                                                 chat could not answer, most
                                                 asked first, and what it has
                                                 been taught
     POST { action: 'teach', id?, q, answer, link?, also? }
                                                 an answer, from now on
     POST { action: 'ignore', id, q }            off the list
     POST { action: 'forget', id }               a taught answer no longer
                                                 given, or a question set
                                                 aside back on the list
   Kept with Live chat in the panel: whoever answers the chat teaches it.
   Every change is in the audit log. */
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const L = require('../../chat-learn');

const MODULE = 'livechat';
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
      if (request.method === 'GET') return sendJson(response, 200, Object.assign({ ok: true }, await L.overview(db, now())));
      const body = await readBody(request);
      if (body.tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That is too long to send.' });
      const action = String(body.action || '');
      let r;
      if (action === 'teach') r = await L.teach(db, by, body, now());
      else if (action === 'ignore') r = await L.ignore(db, by, body.id, now(), body.q);
      else if (action === 'forget') r = await L.forget(db, by, body.id, now());
      else return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do.' });
      if (!r.ok) return sendJson(response, 422, { code: 'NOT_DONE', message: r.message });
      const said = { teach: `Chat taught an answer to: ${r.q || ''}`, ignore: 'Chat question set aside', forget: 'Chat answer forgotten' }[action];
      await log('chat-' + action, r.id, said.slice(0, 200));
      return sendJson(response, 200, r);
    } catch (error) {
      console.error('chat-learn', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
