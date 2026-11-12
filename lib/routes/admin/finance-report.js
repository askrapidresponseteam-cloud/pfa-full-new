'use strict';

/* GET  /api/admin/finance-report                     the last twelve months: made, sent, totals
   GET  /api/admin/finance-report?month=YYYY-MM&format=csv
                                                      that month's CSV (as emailed, or made now
                                                      for a month not reported yet)
   GET  /api/admin/finance-report?recipients=1        who a report for a period may go to
   POST /api/admin/finance-report { action: 'period', month | from, to, purpose, to: [addresses] }
                                                      the report for the period chosen on Payments
                                                      & donations, emailed now (3 Nov 2026)
   POST /api/admin/finance-report { action: 'send', month }
                                                      make and email a month's report now; a month
                                                      already sent is sent again, and logged so

   The monthly payments report in the panel (lib/finance-report.js): what
   went, when, to whom, and whether the email got there (the queue row's
   state, attempts and last error), with the CSV to download. Under the
   payments module: the same people who see the payments. Every send by hand
   is in the audit log. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const FIN = require('../../finance-report');
const REC = require('../../finance-reconcile');
const { orderStatus } = require('../../ccavenue');
const { getCredentials, getStatusUrl } = require('../../pfa-ccavenue-flow');

const MODULE = 'payments';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

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
    /* room for the old site's export (a few hundred rows) */
    request.on('data', (c) => { raw += c; if (raw.length > 3 * 1024 * 1024) raw = raw.slice(0, 3 * 1024 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

/* Where a month stands before it is sent: the payments from each site,
   matched, checked with CCAvenue, and the totals as they would go. */
async function preview(db, month) {
  const report = await FIN.build(db, month);
  const imported = await REC.importOf(db, month);
  const checks = await REC.checksOf(db, month);
  const newRows = await FIN.collect(db, month);
  const all = newRows.concat(imported ? imported.rows || [] : []);
  const asked = all.filter((r) => checks[REC.idKey(r.orderId)] && checks[REC.idKey(r.orderId)].state !== 'unreachable').length;
  const rec = report.reconciliation || null;
  return {
    month, label: report.label, count: report.count, totalText: FIN.totalText(report.total),
    heads: report.heads.map((h) => ({ label: h.label, count: h.count, subtotal: FIN.totalText(h.subtotal) })),
    needsOldSite: Boolean(REC.OLD_SITE_WINDOWS[month]), window: REC.OLD_SITE_WINDOWS[month] || null,
    imported: imported ? { count: imported.count || 0, importedAt: imported.importedAt || '', importedBy: imported.importedBy || '', skipped: (imported.skipped || []).length } : null,
    gateway: { total: all.length, asked, left: all.length - asked },
    reconciliation: rec ? { summary: rec.summary, matched: rec.matched, excluded: rec.excluded, corrected: rec.corrected, unconfirmed: rec.unconfirmed.slice(0, 200), lookalikes: rec.lookalikes } : null
  };
}

/* CCAvenue's Order Status API for one order, in its currency's account */
function askGateway(fetchImpl) {
  return (orderId, row) => {
    const { accessCode, workingKey } = getCredentials(String((row && row.currency) || 'INR').toLowerCase() === 'usd' ? 'usd' : 'inr');
    return orderStatus({ orderId, trackingId: (row && row.trackingId) || '', accessCode, workingKey, url: getStatusUrl(), fetchImpl, timeoutMs: 8000 });
  };
}

/* The twelve months before this one, newest first */
function lastMonths(nowMs, n = 12) {
  const out = [];
  let month = FIN.previousMonth(nowMs);
  for (let i = 0; i < n; i += 1) {
    out.push(month);
    const [y, m] = month.split('-').map(Number);
    month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  return out;
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  const ask = d.ask || askGateway(d.fetchImpl);

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
        if (q.recipients) return sendJson(response, 200, { ok: true, recipients: FIN.periodRecipients() });
        if (q.month) {
          const month = String(q.month);
          if (!MONTH.test(month)) return sendJson(response, 400, { code: 'BAD_MONTH', message: 'A month is YYYY-MM.' });
          if (String(q.format || '') === 'csv') {
            let csv = await FIN.readCsv(db, month);
            if (!csv) csv = Buffer.from((await FIN.build(db, month)).csv, 'utf8');
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/csv; charset=utf-8');
            response.setHeader('Content-Disposition', `attachment; filename="${FIN.fileName(month)}"`);
            response.setHeader('Cache-Control', 'no-store');
            return response.end(csv);
          }
          if (String(q.view || '') === 'reconcile') return sendJson(response, 200, { ok: true, preview: await preview(db, month) });
          return sendJson(response, 200, { ok: true, report: await FIN.status(db, month) });
        }
        const months = lastMonths(now());
        const reports = await Promise.all(months.map(async (month) => {
          const s = await FIN.status(db, month).catch(() => null);
          return { month, label: FIN.bounds(month).label, report: s ? {
            state: s.state || '', count: s.count || 0, totalText: s.totalText || '', madeAt: s.madeAt || '', sentAt: s.sentAt || '',
            to: s.to || '', cc: s.cc || [], heads: s.heads || [], email: s.email, sends: (s.sends || []).slice(-10), csv: Boolean(s.csv), error: s.error || ''
          } : null };
        }));
        const { to, cc } = FIN.recipients();
        return sendJson(response, 200, { ok: true, reports, recipients: { to, cc }, schedule: 'The 1st of every month, India time (up to the 7th if the 1st is missed).' });
      }

      const body = await readBody(request);

      /* the period chosen above the payments list, to the people ticked */
      if (body.action === 'period') {
        let period;
        try {
          if (body.month && !MONTH.test(String(body.month))) throw Object.assign(new Error('A month is YYYY-MM.'), { code: 'BAD_MONTH' });
          period = FIN.periodOf({ month: body.month || '', from: body.from || '', to: body.dateTo || '' }, now());
        } catch (error) {
          return sendJson(response, 400, { code: error.code || 'BAD_PERIOD', message: error.message });
        }
        const types = String(body.purpose || '').split(',').map((x) => x.trim()).filter((x) => /^[a-z-]{2,40}$/.test(x));
        let result;
        try {
          result = await FIN.sendPeriod({
            mail: d.mail, queue: d.queue, db, period, types, to: body.recipients, nowMs: now(),
            by: `admin:${who.email || who.uid || ''}`, purposeLabel: String(body.purposeLabel || '').replace(/[\r\n]+/g, ' ').slice(0, 60),
            siteUrl: require('../../public-site').publicSite()
          });
        } catch (error) {
          if (error && (error.code === 'NO_RECIPIENT' || error.code === 'NOT_ALLOWED')) return sendJson(response, 400, { code: error.code, message: error.message });
          throw error;
        }
        await audit.record(who, { module: MODULE, action: 'finance-period-sent', subject: result.sendId, detail: `${result.label}${types.length ? ` (${types.join(', ')})` : ''}: ${result.count} payments, ${result.total}, to ${result.emails.map((e) => e.to).join(', ')}` }, request);
        return sendJson(response, 200, { ok: true, result });
      }

      const month = String(body.month || '');
      if (!MONTH.test(month)) return sendJson(response, 400, { code: 'BAD_MONTH', message: 'Choose a month.' });

      /* the old site's export for a month that needs it */
      if (body.action === 'import') {
        if (!REC.OLD_SITE_WINDOWS[month]) return sendJson(response, 422, { code: 'NO_OLD_SITE', message: 'This month has no old-site payments to add.' });
        let done;
        try {
          done = await REC.importOld(db, month, String(body.csv || ''), who.email || who.uid || '', now());
        } catch (error) {
          return sendJson(response, 422, { code: 'BAD_FILE', message: String((error && error.message) || 'That file could not be read.') });
        }
        await audit.record(who, { module: MODULE, action: 'finance-old-site-imported', subject: month, detail: `${done.count} old-site payments, ${done.skipped.length} rows left out` }, request);
        return sendJson(response, 200, { ok: true, imported: done, preview: await preview(db, month) });
      }

      /* ask CCAvenue about the month's payments, a few at a time */
      if (body.action === 'verify') {
        if (!d.ask) {
          try { getCredentials('inr'); getStatusUrl(); } catch (_) {
            return sendJson(response, 503, { code: 'NOT_CONFIGURED', message: 'The CCAvenue status check is not set up on this server, so the payments cannot be confirmed with CCAvenue here.' });
          }
        }
        const imported = await REC.importOf(db, month);
        const rows = (await FIN.collect(db, month)).concat(imported ? imported.rows || [] : []);
        const r = await REC.verify(db, month, { rows, ask, limit: Math.min(Math.max(Number(body.limit) || 8, 1), 12), nowMs: now() });
        if (!r.left) await audit.record(who, { module: MODULE, action: 'finance-gateway-checked', subject: month, detail: `${r.total} payments asked at CCAvenue` }, request);
        return sendJson(response, 200, { ok: true, progress: r, preview: r.left ? null : await preview(db, month) });
      }

      if (body.action !== 'send') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
      if (REC.OLD_SITE_WINDOWS[month] && !body.withoutOldSite && !(await REC.importOf(db, month))) {
        return sendJson(response, 422, { code: 'NEEDS_OLD_SITE', message: `Add the old site's payments for ${REC.OLD_SITE_WINDOWS[month].from} to ${REC.OLD_SITE_WINDOWS[month].to} first.` });
      }
      if (month > FIN.previousMonth(now())) {
        return sendJson(response, 422, { code: 'NOT_ENDED', message: 'A month is reported once it has ended.' });
      }
      const result = await FIN.send({
        mail: d.mail, queue: d.queue,
        db, month, nowMs: now(), by: `admin:${who.email || who.uid || ''}`, force: true,
        siteUrl: require('../../public-site').publicSite()
      });
      await audit.record(who, { module: MODULE, action: 'finance-report-sent', subject: month, detail: `${result.state}${result.count != null ? `, ${result.count} payments, ${result.total}` : ''}` }, request);
      if (result.state === 'failed') return sendJson(response, 500, { code: 'NOT_MADE', message: `The report could not be made: ${result.error}` });
      return sendJson(response, 200, { ok: true, result, report: await FIN.status(db, month) });
    } catch (error) {
      console.error('finance report route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { lastMonths };
