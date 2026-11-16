'use strict';

/* /api/admin/live-chat: PFA's side of a live chat (lib/live-chat.js).

     GET                         -> { me: { available }, online: [names], chats: [...] }
     GET ?closed=1               -> the same, with the last 30 days' closed chats
     GET ?id=                    -> one chat, every message
     POST { action: 'presence', available }   I am (or am no longer) available
     POST { action: 'take', id }              this one is mine
     POST { action: 'send', id, text }        a reply (takes it, if no one has)
     POST { action: 'close', id }             end it

   Its own module ('livechat'), so a super admin decides who answers. The
   panel says 'presence' every 25 seconds while the person is available and
   the panel is open; stop saying it and, 75 seconds later, the site no
   longer offers a chat. */

const { requireAdmin } = require('../../admin-auth');
const { getDb } = require('../../firebase');
const LC = require('../../live-chat');

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
    if (size > 16384) throw new Error('Too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return {}; }
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url, 'https://pfa.local').searchParams); } catch (_) { return {}; }
}

module.exports = async function handler(request, response, deps) {
  const o = deps || {};
  const who = await requireAdmin(request, response, 'livechat');
  if (!who) return undefined;
  const db = o.getDb ? o.getDb() : getDb();
  const nowMs = o.now ? o.now() : Date.now();
  const method = String(request.method || 'GET').toUpperCase();
  try {
    if (method === 'GET') {
      const q = queryOf(request);
      if (q.id) return sendJson(response, 200, { ok: true, chat: await LC.read(db, q.id) });
      const [lists, staff, mine] = await Promise.all([
        LC.list(db, nowMs, { closed: q.closed === '1' }),
        LC.availableStaff(db, nowMs),
        LC.presenceOf(db, who.uid)
      ]);
      return sendJson(response, 200, Object.assign({
        ok: true,
        me: { uid: who.uid, name: LC.shownName(who), available: Boolean(mine && mine.available && Number(mine.seenMs) >= nowMs - LC.ONLINE_MS) },
        online: staff.map((s) => s.name)
      }, lists));
    }
    if (method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    let body;
    try { body = await readBody(request); } catch (_) { return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That reply is too long.' }); }
    if (body.action === 'presence') {
      const p = await LC.presence(db, who, body.available === true, nowMs);
      return sendJson(response, 200, { ok: true, available: p.available });
    }
    if (body.action === 'take') return sendJson(response, 200, { ok: true, chat: await LC.take(db, who, body.id, nowMs) });
    if (body.action === 'send') return sendJson(response, 200, { ok: true, chat: await LC.staffSend(db, who, body.id, body.text, nowMs) });
    if (body.action === 'close') return sendJson(response, 200, { ok: true, chat: await LC.close(db, who, body.id, nowMs) });
    return sendJson(response, 400, { code: 'UNKNOWN_ACTION', message: 'Unknown action.' });
  } catch (error) {
    if (error && error.code && error.status) return sendJson(response, error.status, { code: error.code, message: error.message });
    console.error('live chat (panel) failed', { message: error && error.message });
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The chats could not be read just now.' });
  }
};
