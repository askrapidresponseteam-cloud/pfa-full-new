'use strict';
/* /api/admin/live: running PFA Live from the panel (lib/live-show.js).
     GET                                          the show, the Mux set-up,
                                                  every comment and question
     POST { action: 'setup', title, about, startsAt, source, youtube,
            approveFirst, questions, announce }   the show's details
     POST { action: 'mux', ytServer?, ytKey? }    the Mux stream (made once),
                                                  with YouTube as its backup
     POST { action: 'status', status }            soon, live, ended or off
     POST { action: 'moderate', act, id?, text? } show, hide, block,
                                                  spotlight, clear, answered,
                                                  reply (as PFA)
     POST { action: 'post' }                      the recording, as an update
   Going live, ending, blocking and posting are in the audit log. */
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const Live = require('../../live-show');

const MODULE = 'live';

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
    request.on('data', (c) => { raw += c; if (raw.length > 16000) raw = raw.slice(0, 16000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

const STATUS = ['soon', 'live', 'ended', 'off'];
const SAY = { soon: 'Live show announced', live: 'Live show started', ended: 'Live show ended', off: 'Live show taken off the site' };

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
    const by = (who && (who.email || who.name)) || 'admin';
    const log = (action, subject, detail) => audit.record(who, { module: MODULE, action, subject, detail }, request).catch(() => {});
    try {
      const db = getDb();
      if (request.method === 'GET') return sendJson(response, 200, Object.assign({ ok: true }, await Live.panelState(db)));
      const body = await readBody(request);
      const action = String(body.action || '');
      let r;
      if (action === 'setup') r = await Live.setup(db, by, body, now());
      else if (action === 'mux') r = await Live.muxSetup(db, by, body, now());
      else if (action === 'status') {
        if (!STATUS.includes(body.status)) return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do.' });
        r = await Live.setStatus(db, by, body.status, now());
        if (r.ok) await log('live-' + body.status, 'current', `${SAY[body.status]}: ${r.title}`.slice(0, 200));
      } else if (action === 'moderate') {
        r = await Live.moderate(db, by, body, now());
        if (r.ok && r.act === 'block') await log('live-block', r.id, `Stopped from posting on the live show: ${r.name || ''}`.slice(0, 200));
      } else if (action === 'post') {
        r = await Live.postRecording(db, by, now());
        if (r.ok) await log('update-save', r.id, `Live show recording posted: ${r.title}`.slice(0, 200));
      } else return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do.' });
      if (!r.ok) return sendJson(response, 422, { code: 'NOT_DONE', message: r.message });
      return sendJson(response, 200, r);
    } catch (error) {
      console.error('admin live', error && error.message);
      const mux = error && error.code === 'MUX';
      return sendJson(response, mux ? 502 : 500, { code: mux ? 'MUX' : 'SERVER_ERROR', message: mux ? 'Mux did not accept that: ' + error.message.replace(/^Mux said /, '') : 'That could not be done just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
