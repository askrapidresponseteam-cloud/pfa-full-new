/* GET  /api/admin/test-data                     what would move, and what has
   POST /api/admin/test-data { action: 'archive' }  move it
   POST /api/admin/test-data { action: 'restore' }  put it all back

   Test data out of the panel (owner, 23 Oct 2026: "dont need any record of
   20 oct and earlier cause all of them are test data"). lib/test-data.js
   says what moves and how; nothing is destroyed. A super administrator
   only, and every move is written to the admin log. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb } = require('../../../lib/firebase');
const audit = require('../../../lib/admin-audit');
const TEST = require('../../../lib/test-data');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => { raw += c; if (raw.length > 2048) raw = raw.slice(0, 2048); });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

const count = (n, one, many) => `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;
const words = (c) => [
  count(c.cases, 'form', 'forms'), count(c.payments, 'payment', 'payments'), count(c.cards, 'colony card', 'colony cards'), count(c.emails, 'email', 'emails')
].join(', ') + ` (${count(c.documents, 'document', 'documents')} in all)`;


module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const who = await requireAdmin(request, response, 'people');
  if (!who) return undefined;
  if (who.role !== 'super') return sendJson(response, 403, { code: 'SUPER_ONLY', message: 'Only a super administrator can do this.' });
  const db = getDb();
  /* well inside the server's limit, the reading included: a minute on
     Firebase, ten seconds on Vercel; a press cut short goes on from where
     it stopped */
  const firebaseHost = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);
  const deadline = Date.now() + (firebaseHost ? 25000 : 6000);

  try {
    if (request.method === 'GET') return sendJson(response, 200, Object.assign({ ok: true }, await TEST.preview(db)));

    const body = await readBody(request);
    if (body.action === 'archive') {
      const done = await TEST.archive(db, { by: who.email || '', deadline });
      await audit.record(who, {
        module: 'people', action: 'test-data-out', subject: `until ${TEST.CUTOFF_ISO.slice(0, 10)}`,
        detail: `Test data dated 20 Oct 2026 and earlier moved to the archive: ${words(done.moved)}`
          + (done.taken ? `; ${count(done.taken, 'document', 'documents')} left where they were (the archive already held one at that place)` : '')
          + (done.more ? '; the rest is left for the next press' : '') + (done.error ? ` (stopped: ${done.error})` : '')
      }, request);
      return sendJson(response, 200, { ok: true, action: 'archive', went: done.moved, taken: done.taken, more: done.more });
    }
    if (body.action === 'restore') {
      const done = await TEST.restore(db, { by: who.email || '', deadline });
      await audit.record(who, {
        module: 'people', action: 'test-data-back', subject: `until ${TEST.CUTOFF_ISO.slice(0, 10)}`,
        detail: `Test data put back from the archive: ${words(done.restored)}`
          + (done.kept ? `; ${count(done.kept, 'document', 'documents')} left in the archive (their place was taken)` : '')
          + (done.more ? '; the rest is left for the next press' : '') + (done.error ? ` (stopped: ${done.error})` : '')
      }, request);
      return sendJson(response, 200, { ok: true, action: 'restore', back: done.restored, kept: done.kept, more: done.more });
    }
    return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be archive or restore.' });
  } catch (error) {
    console.error('test data: failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Nothing was lost; press again.' });
  }
};
