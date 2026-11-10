/* GET /api/admin/directory
     -> { ok, generatedAt, categories: [{ key, label, count }], people: [...] }
   GET /api/admin/directory?format=csv[&category=&state=&district=&q=]
     -> the same people, as filtered, for Excel (logged)

   The People directory (owner, 10 Nov 2026; lib/people-directory.js): one
   line per person, with their state, district, name, address and phone, and
   every way PFA knows them. Its own module, 'directory', because it gathers
   people from every register: a super admin has it, staff only when ticked.
   A download is in the audit log, with how many people it held and the
   filter it was made with, before the file goes back. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const audit = require('../../admin-audit');
const D = require('../../people-directory');
const { getDb } = require('../../firebase');

const IST_MS = 330 * 60000;

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

const short = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/* The same filter the panel applies, so a download is what was on screen. */
function filtered(people, q) {
  const category = short(q.category, 40);
  const state = short(q.state, 60);
  const district = short(q.district, 60);
  const words = short(q.q, 80).toLowerCase().split(' ').filter(Boolean);
  return people.filter((p) => {
    if (category && !p.categories.includes(category)) return false;
    if (state && p.state !== state) return false;
    if (district && p.district !== district) return false;
    if (!words.length) return true;
    const hay = [p.name, p.mobile, p.otherMobiles.join(' '), p.email, p.address, p.district, p.state, p.pin, p.records.map((r) => r.id).join(' ')].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, 'directory');
  if (!who) return undefined;
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const people = await D.read(getDb());
    const q = queryOf(request);
    if (q.format === 'csv') {
      const rows = filtered(people, q);
      const how = ['category', 'state', 'district', 'q'].filter((k) => short(q[k], 80)).map((k) => `${k} ${short(q[k], 80)}`).join(', ');
      await audit.record(who, { module: 'directory', action: 'directory-download', subject: 'people-directory', detail: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}${how ? `, ${how}` : ', everyone'}` }, request);
      const d = new Date(Date.now() + IST_MS);
      const name = `PFA-people-directory-${d.toISOString().slice(0, 10)}.csv`;
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      response.setHeader('Cache-Control', 'no-store');
      return response.end(D.csvOf(rows));
    }
    const counts = {};
    for (const p of people) for (const c of p.categories) counts[c] = (counts[c] || 0) + 1;
    return sendJson(response, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      categories: D.CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: counts[c.key] || 0 })),
      people
    });
  } catch (error) {
    console.error('people directory failed', (error && error.message) || error);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The directory could not be read just now. Try again in a minute.' });
  }
};

module.exports._private = { filtered };
