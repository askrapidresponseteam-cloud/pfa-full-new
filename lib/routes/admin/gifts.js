/* GET  /api/admin/gifts
     -> { ok, today, seasons: [{ ...season, state }], live, next, pieces, occasions, page: { hidden } }
   POST /api/admin/gifts
     { action: 'save', season: {...}, id? }      create, or change the season with that id
     { action: 'copy', id }                      the same season a year on, as a draft
     { action: 'remove', id }                    off the list and the page; kept, marked removed
     { action: 'page', visible: true | false }   show or hide gifts.html and every link to it
     -> { ok, ..., the same listing as GET }

   The Seasonal gifts section of the panel (owner, 10 Nov 2026; module
   'gifts'). Seasons are checked by lib/gift-seasons.js before anything is
   written. Showing or hiding the page is the Website section's own switch
   (lib/site-visibility.js), for this one page, so someone who looks after
   the gifts can take the page off the site without carrying the whole
   Website section; it hides the page and every link to it, as hiding any
   page does. Every change is in the audit log before the answer goes back. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const audit = require('../../admin-audit');
const G = require('../../gift-seasons');
const V = require('../../site-visibility');
const { getDb } = require('../../firebase');

const PAGE = 'gifts';
const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

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
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 200000) raw = raw.slice(0, 200000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

async function listing(db, now) {
  const today = G.todayIST(now);
  const seasons = await G.readAll(db);
  const { active, next } = G.pick(seasons, today);
  const state = await V.readState(db);
  return {
    ok: true,
    today,
    seasons: seasons.map((s) => Object.assign({}, s, { state: G.stateOf(s, today) })),
    live: active ? active.id : '',
    next: next ? next.id : '',
    pieces: G.PIECES.map((p) => ({ id: p.id, name: p.name, price: p.price, image: p.image, available: p.available })),
    occasions: G.OCCASIONS,
    page: { hidden: state.hidden.pages[PAGE] === true }
  };
}

function label(s) { return `${s.name} ${s.year}`; }

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, 'gifts');
  if (!who) return undefined;
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const db = getDb();
    if (request.method === 'GET') return sendJson(response, 200, await listing(db));

    const body = await readBody(request);
    const action = body && body.action;
    const by = { email: who.email || '', name: who.name || '' };
    const at = new Date().toISOString();
    const col = db.collection(G.COLLECTION);

    if (action === 'save') {
      const id = body.id ? String(body.id) : '';
      if (id && !ID.test(id)) return sendJson(response, 400, { code: 'BAD_ID', message: 'That season could not be found.' });
      const checked = G.validate(body.season, id);
      if (checked.error) return sendJson(response, 400, { code: 'INVALID', message: checked.error });
      const s = checked.season;
      const saved = await db.runTransaction(async (tx) => {
        let ref;
        let before = null;
        if (id) {
          ref = col.doc(id);
          const snap = await tx.get(ref);
          if (!snap.exists) return { missing: true };
          before = snap.data();
        } else {
          const base = `${G.slug(s.occasion === 'other' ? s.name : s.occasion)}-${s.year}`;
          for (let n = 1; n <= 20 && !ref; n += 1) {
            const candidate = col.doc(n === 1 ? base : `${base}-${n}`);
            const snap = await tx.get(candidate);
            if (!snap.exists) ref = candidate;
          }
          if (!ref) return { full: true };
        }
        const doc = Object.assign({}, s, { id: ref.id, updatedAt: at, updatedBy: by, createdAt: (before && before.createdAt) || at, createdBy: (before && before.createdBy) || by });
        tx.set(ref, doc);
        return { doc, before };
      });
      if (saved.missing) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'That season is no longer there. Read the list again.' });
      if (saved.full) return sendJson(response, 409, { code: 'TOO_MANY', message: `There are already twenty ${label(s)} seasons.` });
      const was = saved.before;
      await audit.record(who, {
        module: 'gifts',
        action: was ? 'gift-season-change' : 'gift-season-add',
        subject: saved.doc.id,
        detail: `${label(saved.doc)}, ${saved.doc.startDate} to ${saved.doc.endDate}, ${saved.doc.status === 'published' ? 'published' : 'draft'}${was && was.status !== saved.doc.status ? ` (was ${was.status === 'published' ? 'published' : 'draft'})` : ''}`
      }, request);
      G.forget();
      return sendJson(response, 200, Object.assign(await listing(db), { saved: saved.doc.id }));
    }

    if (action === 'copy' || action === 'remove') {
      const id = String(body.id || '');
      if (!ID.test(id)) return sendJson(response, 400, { code: 'BAD_ID', message: 'That season could not be found.' });
      const snap = await col.doc(id).get();
      if (!snap.exists || snap.data().removed) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'That season is no longer there. Read the list again.' });
      const s = Object.assign({}, snap.data(), { id });
      if (action === 'remove') {
        await col.doc(id).update({ removed: true, removedAt: at, removedBy: by });
        await audit.record(who, { module: 'gifts', action: 'gift-season-remove', subject: id, detail: `${label(s)} removed (it was ${s.status === 'published' ? 'published' : 'a draft'})` }, request);
        G.forget();
        return sendJson(response, 200, await listing(db));
      }
      const copy = Object.assign({}, s, {
        year: s.year + 1,
        startDate: G.nextYearDay(s.startDate),
        endDate: G.nextYearDay(s.endDate),
        status: 'draft',
        offers: (s.offers || []).map((o) => Object.assign({}, o, { until: o.until ? G.nextYearDay(o.until) : '' }))
      });
      const checked = G.validate(copy, '');
      if (checked.error) return sendJson(response, 400, { code: 'INVALID', message: checked.error });
      const made = await db.runTransaction(async (tx) => {
        const base = `${G.slug(copy.occasion === 'other' ? copy.name : copy.occasion)}-${copy.year}`;
        for (let n = 1; n <= 20; n += 1) {
          const ref = col.doc(n === 1 ? base : `${base}-${n}`);
          const exists = (await tx.get(ref)).exists;
          if (!exists) {
            const doc = Object.assign({}, checked.season, { id: ref.id, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by, copiedFrom: id });
            tx.set(ref, doc);
            return doc;
          }
        }
        return null;
      });
      if (!made) return sendJson(response, 409, { code: 'TOO_MANY', message: `There are already twenty ${label(copy)} seasons.` });
      await audit.record(who, { module: 'gifts', action: 'gift-season-add', subject: made.id, detail: `${label(made)} copied from ${label(s)}, as a draft` }, request);
      return sendJson(response, 200, Object.assign(await listing(db), { saved: made.id }));
    }

    if (action === 'page') {
      if (typeof body.visible !== 'boolean') return sendJson(response, 400, { code: 'BAD_VISIBLE', message: 'Say whether the page should be visible or hidden.' });
      const reg = V.registry();
      const parsed = V.parseChanges({ kind: 'page', id: PAGE, visible: body.visible }, reg, await V.readState(db));
      if (parsed.error) return sendJson(response, parsed.error.status, { code: parsed.error.code, message: parsed.error.message });
      const result = await V.applyChanges(db, who, parsed.changes);
      await Promise.all(result.done.map((c) => audit.record(who, {
        module: 'gifts',
        action: c.to === 'hidden' ? 'site-hide' : 'site-show',
        subject: 'gifts.html',
        detail: `${c.label}: ${c.from === 'hidden' ? 'Hidden' : 'Visible'} to ${c.to === 'hidden' ? 'Hidden' : 'Visible'}`
      }, request)));
      if (result.done.length) V.forget();
      return sendJson(response, 200, await listing(db));
    }

    return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Say what to do: save, copy, remove or page.' });
  } catch (error) {
    console.error('gift seasons change failed', (error && error.message) || error);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be saved. Nothing on the site has changed.' });
  }
};
