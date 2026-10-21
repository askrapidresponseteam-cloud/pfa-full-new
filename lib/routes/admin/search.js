'use strict';

/* GET /api/admin/search?q=...   the panel's one search box (8 Oct 2026).

   Any signed-in administrator may search; each result is kept only if this
   person's account carries the section that opens it (a case needs
   Submissions, a payment Payments, a card Colony cards, the audit log and
   staff accounts People), so a search shows nobody a record they could not
   open anyway.

   The index is brought up to date first when its last run is more than a
   minute old (lib/admin-search.js), within a short budget, so the answer
   never waits long.

   POST { action: 'rebuild' } (super administrators): every source is read
   again from the start on the next runs. Nothing is deleted. */

const { requireAdmin, canAccess } = require('../../admin-auth');
const { getDb } = require('../../firebase');
const SEARCH = require('../../admin-search');
const audit = require('../../admin-audit');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

/* Staff accounts live in Firebase Authentication, not in the database, and
   there are few of them: read at most every five minutes per server. */
let people = { at: 0, list: [] };
async function staffAccounts(getAuth) {
  if (Date.now() - people.at < 5 * 60 * 1000) return people.list;
  const out = [];
  try {
    const auth = getAuth();
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      (page.users || []).forEach((u) => {
        const c = u.customClaims || {};
        if (c.admin === true) out.push({ uid: u.uid, email: String(u.email || '').toLowerCase(), name: u.displayName || '', role: c.role === 'staff' ? 'Staff' : 'Super administrator' });
      });
      pageToken = page.pageToken;
    } while (pageToken);
    people = { at: Date.now(), list: out };
  } catch (error) {
    console.warn('admin search: staff accounts not read', String(error && error.message).slice(0, 160));
  }
  return people.list;
}

function createHandler(deps) {
  const d = deps || {};
  const db = () => (d.getDb || getDb)();
  const getAuth = d.getAuth || (() => { getDb(); return require('firebase-admin/auth').getAuth(); });

  return async function handler(request, response) {
    if (request.method === 'POST') {
      const who = await requireAdmin(request, response, 'people');
      if (!who) return;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      if (body.action !== 'rebuild') return sendJson(response, 400, { code: 'BAD_ACTION', message: 'The only action is rebuild.' });
      await db().collection('adminSearchMeta').doc('state').set({ v: 0, marks: {}, syncedAt: 0 });
      const ran = await SEARCH.sync(db(), { budgetMs: 20000 });
      await audit.record(who, { module: 'people', action: 'search-rebuild', subject: 'search index', detail: `Search index rebuilt from the start (${ran.written} entries written${ran.complete ? '' : ', more on the next runs'})` }, request);
      return sendJson(response, 200, { ok: true, written: ran.written, complete: ran.complete });
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const who = await requireAdmin(request, response);
    if (!who) return;
    const q = String((request.query || {}).q || '').slice(0, 120);
    if (q.trim().length < 2) return sendJson(response, 200, { ok: true, q, results: [], more: false });
    try {
      const store = db();
      const fresh = await SEARCH.syncIfStale(store, { budgetMs: 1500 });
      const allowed = (module) => canAccess(who, module);
      const out = await SEARCH.search(store, q, allowed);
      const results = out.results.slice();
      if (canAccess(who, 'people')) {
        const tokens = out.tokens;
        const staff = (await staffAccounts(getAuth)).filter((p) => {
          const hay = `${p.email} ${String(p.name || '').toLowerCase()}`;
          return tokens.length && tokens.every((t) => hay.includes(t));
        }).slice(0, 5);
        staff.forEach((p) => results.push({ type: 'person', id: p.email, title: p.name || p.email, line: `${p.email}, ${p.role}`, status: '', at: 0 }));
      }
      return sendJson(response, 200, { ok: true, q, results, more: out.more, near: Boolean(out.near), building: Boolean(fresh && fresh.complete === false) });
    } catch (error) {
      console.error('admin search failed', String(error && error.message).slice(0, 200));
      return sendJson(response, 500, { code: 'SEARCH_FAILED', message: 'The search could not be run just now. Try again in a moment.' });
    }
  };
}

module.exports = createHandler();
module.exports._private = { createHandler, resetPeople: () => { people = { at: 0, list: [] }; } };
