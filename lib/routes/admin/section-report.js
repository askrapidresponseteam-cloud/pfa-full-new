'use strict';

/* GET  /api/admin/section-report?kind=K&from=YYYY-MM-DD&to=YYYY-MM-DD
                                     the section's lines in the period, and who a report may go to
   GET  /api/admin/section-report?kind=K&recipients=1   who a report may go to
   GET  /api/admin/section-report?kind=K&from=..&to=..&format=csv
                                     the same, as a CSV (logged)
   POST /api/admin/section-report?kind=K { from, to, recipients: [addresses] }
                                     email the report, the CSV attached (logged)

   K is volunteers, jobs, interns, shop or caregivers; each needs its own
   section of the panel (lib/section-report.js KINDS). Shop orders go only
   where money goes. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const SR = require('../../section-report');

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
    request.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) raw = raw.slice(0, 64 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function createHandler(deps) {
  const d = deps || {};
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const getDb = d.getDb || firebase.getDb;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const q = queryOf(request);
    const kind = String(q.kind || '');
    if (!Object.prototype.hasOwnProperty.call(SR.KINDS, kind)) return sendJson(response, 400, { code: 'BAD_KIND', message: 'Choose a section.' });
    const who = await requireAdmin(request, response, SR.KINDS[kind].module);
    if (!who) return undefined;
    try {
      const db = getDb();
      const nowMs = now();
      if (method === 'GET' && q.recipients) return sendJson(response, 200, { ok: true, kind, recipients: SR.recipients(kind), money: SR.KINDS[kind].money });
      const body = method === 'POST' ? await readBody(request) : {};
      let period;
      try {
        period = SR.periodOf({ from: method === 'POST' ? body.from : q.from, to: method === 'POST' ? body.to : q.to }, nowMs);
      } catch (error) {
        return sendJson(response, 400, { code: error.code || 'BAD_PERIOD', message: error.message });
      }

      if (method === 'GET') {
        const report = await SR.rowsFor(db, kind, period, nowMs);
        if (String(q.format || '') === 'csv') {
          await audit.record(who, { module: SR.KINDS[kind].module, action: 'section-report-exported', subject: kind, detail: `${report.label}, ${report.period}: ${report.count} lines` }, request);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/csv; charset=utf-8');
          response.setHeader('Content-Disposition', `attachment; filename="${SR.fileName(kind, period)}"`);
          response.setHeader('Cache-Control', 'no-store');
          return response.end(Buffer.from(SR.csvOf(report), 'utf8'));
        }
        return sendJson(response, 200, {
          ok: true, kind, label: report.label, period: report.period, columns: report.columns, count: report.count,
          total: report.total, rows: report.rows.map((r) => ({ id: r.id, cells: r.cells })),
          recipients: SR.recipients(kind), money: SR.KINDS[kind].money
        });
      }

      let result;
      try {
        result = await SR.send({
          mail: d.mail, queue: d.queue, db, kind, period, to: body.recipients, nowMs,
          by: `admin:${who.email || who.uid || ''}`,
          siteUrl: require('../../public-site').publicSite()
        });
      } catch (error) {
        if (error && (error.code === 'NO_RECIPIENT' || error.code === 'NOT_ALLOWED')) return sendJson(response, 400, { code: error.code, message: error.message });
        throw error;
      }
      await audit.record(who, { module: SR.KINDS[kind].module, action: 'section-report-sent', subject: result.sendId, detail: `${result.label}, ${result.period}: ${result.count} lines, to ${result.emails.map((e) => e.to).join(', ')}` }, request);
      return sendJson(response, 200, { ok: true, result });
    } catch (error) {
      console.error('section report route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SECTION_REPORT_FAILED', message: 'The report could not be made. Try again.' });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
