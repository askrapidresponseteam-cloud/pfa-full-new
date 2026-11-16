'use strict';

/* /api/live-chat: the visitor's side of a live chat (lib/live-chat.js).

     GET  /api/live-chat                       -> { online }
     GET  /api/live-chat?id=&token=&after=n&seen=m
          -> { status, staff, staffOnline, online, staffTyping, staffSeenN, messages after n }
     POST { action: 'start', text, page, lang, cid } -> { id, token, n }   (409 NO_ONE when no one is on)
     POST { action: 'send', id, token, text, cid }  -> { n, away }        (the same cid twice is one message)
     POST { action: 'typing', id, token }
     POST { action: 'end', id, token }

   Braked per connection in memory (lib/memory-brake.js): starting a chat,
   writing in one, and looking for news, each with its own limit. */

const firebase = require('../firebase');
const LC = require('../live-chat');
const { brake } = require('../memory-brake');
const { clientIp } = require('../client-ip');

const WINDOW_MS = 15 * 60 * 1000;
/* a look every second while a chat is lively: 900 in 15 minutes, with room */
const LIMITS = { start: 6, send: 200, look: 2400, typing: 600 };
const stores = { start: new Map(), send: new Map(), look: new Map(), typing: new Map() };

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') { try { return JSON.parse(request.body); } catch (_) { return {}; } }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return {}; }
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url, 'https://pfa.local').searchParams); } catch (_) { return {}; }
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const method = String(request.method || 'GET').toUpperCase();
    const nowMs = now();
    const ip = clientIp(request);
    const limited = (kind) => brake(stores[kind], ip, LIMITS[kind], nowMs, WINDOW_MS);
    const tooMany = () => sendJson(response, 429, { ok: false, code: 'TOO_MANY', message: 'Too many messages from this connection. Wait a few minutes.' });
    try {
      const db = getDb();
      if (method === 'GET') {
        if (limited('look')) return tooMany();
        const q = queryOf(request);
        if (!q.id) return sendJson(response, 200, { ok: true, online: await LC.isOnline(db, nowMs) });
        return sendJson(response, 200, await LC.poll(db, q.id, q.token, q.after, q.seen, nowMs));
      }
      if (method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return sendJson(response, 405, { ok: false, message: 'Use GET or POST.' });
      }
      let body;
      try { body = await readBody(request); } catch (_) { return sendJson(response, 413, { ok: false, message: 'That message is too long.' }); }
      if (body.action === 'start') {
        if (limited('start')) return tooMany();
        const r = await LC.start(db, { text: body.text, page: body.page, lang: body.lang, cid: body.cid }, nowMs);
        return sendJson(response, 201, { ok: true, id: r.id, token: r.token, seq: r.chat.seq, n: r.n });
      }
      if (body.action === 'send') {
        if (limited('send')) return tooMany();
        const m = await LC.visitorSend(db, body.id, body.token, body.text, body.cid, nowMs);
        return sendJson(response, 200, { ok: true, n: m.n, away: Boolean(m.away) });
      }
      if (body.action === 'typing') {
        if (limited('typing')) return sendJson(response, 200, { ok: true });
        await LC.visitorTyping(db, body.id, body.token, nowMs);
        return sendJson(response, 200, { ok: true });
      }
      if (body.action === 'end') {
        await LC.visitorEnd(db, body.id, body.token, nowMs);
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 400, { ok: false, message: 'Unknown action.' });
    } catch (error) {
      if (error && error.code && error.status) return sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
      console.warn('live chat failed', error && error.message);
      return sendJson(response, 503, { ok: false, code: 'UNAVAILABLE', message: 'The chat could not be reached just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { stores, LIMITS };
