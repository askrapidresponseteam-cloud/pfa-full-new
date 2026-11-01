'use strict';

/* GET  /api/admin/weekly-digest                 the last eight Mondays: made, sent, counts
   POST /api/admin/weekly-digest { action: 'send', week }
                                                 make and email that week's digest now; a
                                                 week already sent goes again, logged so

   The Monday digest in the panel (lib/weekly-digest.js), under Submissions:
   whether each week's email went, to whom, and the queue row's state. A
   send by hand is in the audit log. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const WD = require('../../weekly-digest');

const MODULE = 'submissions';
const WEEK = /^\d{4}-\d{2}-\d{2}$/;

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
    request.on('data', (c) => { raw += c; if (raw.length > 8192) raw = raw.slice(0, 8192); });
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
    const who = await requireAdmin(request, response, MODULE);
    if (!who) return undefined;
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const db = getDb();
      if (request.method === 'GET') {
        const weeks = WD.lastWeeks(now());
        const rows = await Promise.all(weeks.map(async (week) => {
          const s = await WD.status(db, week).catch(() => null);
          return { week, label: WD.bounds(week).label, digest: s ? {
            state: s.state || '', count: s.count || 0, waiting: s.waiting || 0, groups: s.groups || [], madeAt: s.madeAt || '', sentAt: s.sentAt || '',
            email: s.email, sends: (s.sends || []).slice(-6), error: s.error || ''
          } : null };
        }));
        const { to, cc } = WD.recipients();
        return sendJson(response, 200, { ok: true, weeks: rows, recipients: { to, cc }, schedule: 'Every Monday, India time (up to Wednesday if Monday is missed).' });
      }
      const body = await readBody(request);
      const week = String(body.week || '');
      if (body.action !== 'send') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
      try { WD.bounds(week); } catch (_) { return sendJson(response, 400, { code: 'BAD_WEEK', message: 'Choose a week.' }); }
      if (!WEEK.test(week) || WD.bounds(week).to > now() + 60000) return sendJson(response, 422, { code: 'NOT_ENDED', message: 'A week is sent once it has ended.' });
      const result = await WD.send({ db, week, nowMs: now(), by: `admin:${who.email || who.uid || ''}`, force: true, mail: d.mail, queue: d.queue });
      await audit.record(who, { module: MODULE, action: 'weekly-digest-sent', subject: week, detail: `${result.state}${result.count != null ? `, ${result.count} listed` : ''}` }, request);
      if (result.state === 'failed') return sendJson(response, 500, { code: 'NOT_MADE', message: `The digest could not be made: ${result.error}` });
      return sendJson(response, 200, { ok: true, result, digest: await WD.status(db, week) });
    } catch (error) {
      console.error('weekly digest route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
