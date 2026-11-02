'use strict';

/* GET  /api/admin/cruelty-report                   this month so far and the eleven before:
                                                   made, sent, reports, states
   GET  /api/admin/cruelty-report?month=YYYY-MM&format=pdf
                                                   that month's PDF: as it was sent, or, for
                                                   this month or one not yet made, as it
                                                   stands now
   POST /api/admin/cruelty-report { action: 'send', month }
                                                   make and email that month's report now; a
                                                   month already sent goes again, logged so

   The monthly cruelty report in the panel (lib/cruelty-report.js), under
   Submissions. A send by hand is in the audit log. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const CR = require('../../cruelty-report');

const MODULE = 'submissions';
const MONTH = /^\d{4}-\d{2}$/;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
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
        const q = queryOf(request);
        if (q.month) {
          const month = String(q.month);
          if (!MONTH.test(month)) return sendJson(response, 400, { code: 'BAD_MONTH', message: 'A month is YYYY-MM.' });
          try { CR.bounds(month); } catch (_) { return sendJson(response, 400, { code: 'BAD_MONTH', message: 'A month is YYYY-MM.' }); }
          if (String(q.format || '') !== 'pdf') return sendJson(response, 200, { ok: true, report: await CR.status(db, month) });
          /* a month that has ended and was made: the PDF that went; this
             month, or one never made: as it stands */
          const ended = CR.bounds(month).to <= now();
          const pdf = (ended && await CR.readPdf(db, month)) || (await CR.build(db, month)).pdf;
          await audit.record(who, { module: MODULE, action: 'cruelty-report-downloaded', subject: month, detail: ended ? 'month ended' : 'month so far' }, request);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/pdf');
          response.setHeader('Content-Disposition', `attachment; filename="${CR.fileName(month)}"`);
          response.setHeader('Cache-Control', 'no-store');
          return response.end(pdf);
        }
        const months = CR.lastMonths(now());
        const current = CR.currentMonth(now());
        const rows = await Promise.all(months.map(async (month) => {
          const s = await CR.status(db, month).catch(() => null);
          return { month, label: CR.bounds(month).label, current: month === current, report: s ? {
            state: s.state || '', count: s.count || 0, states: s.states || [], leftOut: s.leftOut || null, madeAt: s.madeAt || '', sentAt: s.sentAt || '',
            email: s.email, sends: (s.sends || []).slice(-6), pdf: Boolean(s.pdf), error: s.error || ''
          } : null };
        }));
        const { to } = CR.recipients();
        return sendJson(response, 200, { ok: true, months: rows, recipients: { to }, schedule: 'On the 2nd of every month, India time (up to the 8th if the 2nd is missed), for the month before.' });
      }
      const body = await readBody(request);
      const month = String(body.month || '');
      if (body.action !== 'send') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
      if (!MONTH.test(month)) return sendJson(response, 400, { code: 'BAD_MONTH', message: 'Choose a month.' });
      try { CR.bounds(month); } catch (_) { return sendJson(response, 400, { code: 'BAD_MONTH', message: 'Choose a month.' }); }
      if (CR.bounds(month).to > now()) return sendJson(response, 422, { code: 'NOT_ENDED', message: 'A month is sent once it has ended. Download it to see it so far.' });
      const result = await CR.send({ db, month, nowMs: now(), by: `admin:${who.email || who.uid || ''}`, force: true, mail: d.mail, queue: d.queue, siteUrl: process.env.PFA_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || '' });
      await audit.record(who, { module: MODULE, action: 'cruelty-report-sent', subject: month, detail: `${result.state}${result.count != null ? `, ${result.count} reports` : ''}` }, request);
      if (result.state === 'failed') return sendJson(response, 500, { code: 'NOT_MADE', message: `The report could not be made: ${result.error}` });
      return sendJson(response, 200, { ok: true, result, report: await CR.status(db, month) });
    } catch (error) {
      console.error('cruelty report route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
