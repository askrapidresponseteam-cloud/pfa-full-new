'use strict';

/* GET /api/admin/analytics?days=30            the last 30 days, today included
   GET /api/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD   (at most 366 days)

   The site's numbers for the panel's Analytics section: page views and
   visits by day, the pages people open and the ones visits begin on, where
   visits come from, phone or computer, the states and countries, the hours,
   campaign links, scripts that failed on a page, and, beside them, what
   people did: the forms, payments and orders that arrived in the same days.

   Reads one document per day (two with campaigns, three with errors), never a
   record of a person. What is counted and how: lib/analytics.js. */

const A = require('../../analytics');
const { requireAdmin } = require('../../admin-auth');
const { getDb } = require('../../firebase');
const { KIND_LABELS } = require('../../submissions');

const MODULE = 'analytics';
const COLLECTION = 'analytics_days';
const MAX_DAYS = 366;
const READ_CAP = 5000;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function range(q, nowMs) {
  const today = A.dayOf(nowMs);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(String(q.from || '')) && iso.test(String(q.to || ''))) {
    const to = q.to > today ? today : q.to;
    return A.daysBetween(q.from, to, MAX_DAYS);
  }
  const n = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(q.days) || 30)));
  const start = new Date(Date.parse(today + 'T00:00:00Z') - (n - 1) * 864e5).toISOString().slice(0, 10);
  return A.daysBetween(start, today, MAX_DAYS);
}

async function read(col, ids) {
  const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
  return snaps.map((s) => (s && s.exists ? s.data() || {} : null));
}

module.exports = async function handler(request, response, deps) {
  const o = deps || {};
  if (String(request.method || 'GET').toUpperCase() !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' });
  }
  const who = await requireAdmin(request, response, MODULE);
  if (!who) return undefined;
  const nowMs = o.now ? o.now() : Date.now();
  const days = range(request.query || {}, nowMs);
  if (!days.length) return sendJson(response, 400, { code: 'BAD_RANGE', message: 'Choose a start date on or before the end date.' });
  try {
    const db = o.getDb ? o.getDb() : getDb();
    const col = db.collection(COLLECTION);
    const [main, camps] = await Promise.all([read(col, days), read(col, days.map((d) => `${d}_campaigns`))]);
    const out = A.summarise(days, main.map((d, i) => Object.assign({}, d || {}, { campaigns: camps[i] || {} })));
    /* the failing scripts of the last fortnight in the range, worst first */
    const recent = days.slice(-14);
    const errs = await read(col, recent.map((d) => `${d}_errors`));
    const byId = {};
    errs.forEach((doc) => Object.entries(doc || {}).forEach(([id, e]) => {
      if (!e || typeof e !== 'object') return;
      const x = byId[id] || (byId[id] = { page: A.titleOf(e.page), message: String(e.message || ''), n: 0 });
      x.n += Number(e.n) || 0;
    }));
    out.errorMessages = Object.values(byId).sort((a, b) => b.n - a.n).slice(0, 15);
    /* what people did in the same days: everything that arrived */
    const fromMs = Date.parse(days[0] + 'T00:00:00Z') - 5.5 * 3600e3;
    const toMs = Date.parse(days[days.length - 1] + 'T00:00:00Z') - 5.5 * 3600e3 + 864e5;
    try {
      const snap = await db.collection('submissions').where('receivedAtMs', '>=', fromMs).where('receivedAtMs', '<', toMs).select('kind', 'status').limit(READ_CAP).get();
      const by = {};
      (snap.docs || []).forEach((d) => { const r = d.data() || {}; if (r.status === 'removed' || r.status === 'spam') return; const k = r.kind || 'other'; by[k] = (by[k] || 0) + 1; });
      out.actions = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([kind, n]) => ({ kind, label: KIND_LABELS[kind] || kind, n }));
      out.actionsCapped = (snap.docs || []).length >= READ_CAP;
    } catch (error) {
      out.actions = null;
    }
    out.from = days[0]; out.to = days[days.length - 1]; out.days = days.length;
    out.started = main.some(Boolean);
    return sendJson(response, 200, Object.assign({ ok: true }, out));
  } catch (error) {
    console.error('admin analytics failed', { message: error && error.message });
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The numbers could not be read just now.' });
  }
};

module.exports.MODULE = MODULE;
