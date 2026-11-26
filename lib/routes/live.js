'use strict';
/* /api/live: PFA Live for viewers (lib/live-show.js).
     GET                                       the show, what is in the
                                               spotlight, the latest comments.
                                               Cached for three seconds at the
                                               edge: every viewer's page asks
                                               every few seconds.
     POST { type: 'comment' | 'question', name, text, cid }
                                               a comment or a question */
const firebase = require('../firebase');
const Live = require('../live-show');
const { clientIp } = require('../client-ip');

function send(response, status, payload, cache) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache || 'no-store');
  response.end(JSON.stringify(payload));
}
function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 4000) raw = raw.slice(0, 4000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const now = d.now || (() => Date.now());
  const ipOf = d.ipOf || ((request) => { try { return clientIp(request); } catch (_) { return ''; } });
  return async function handler(request, response) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      try {
        return send(response, 200, Object.assign({ ok: true }, await Live.publicState(getDb())), 'public, max-age=2, s-maxage=3');
      } catch (error) {
        console.error('live not read', error && error.message);
        return send(response, 200, { ok: false, show: { status: 'off' }, comments: [] }, 'public, max-age=5, s-maxage=5');
      }
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return send(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const body = await readBody(request);
      const r = await Live.post(getDb(), body, ipOf(request), now());
      if (!r.ok) return send(response, 422, { code: 'NOT_DONE', message: r.message });
      return send(response, 200, r);
    } catch (error) {
      console.error('live post', error && error.message);
      return send(response, 500, { code: 'SERVER_ERROR', message: 'That did not go through. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
