/* GET  /api/admin/site
     -> { ok, groups, pages: [{ id, file, title, group, menu, locked, partsLocked,
                                modules: [{ id, key, label }] }], state }
   POST /api/admin/site  { kind: 'page' | 'module', id, visible: true | false }
                     or  { kind: 'choice', id: 'manekas-picks#opening', value: '1' | '2' }
                     or  { changes: [{ kind, id, visible | value }, ...] }
     -> { ok, changed, state }

   The Website section of the panel (owner, 8 Oct 2026: "Admin should be able
   to show/hide any section or content module ... with each section having a
   simple Visible / Hidden toggle"). Module 'website'; super admins have it as
   they have every module.

   The list of what can be hidden is assets/site-modules.json, generated from
   the pages, and an id that is not on it is refused, as is anything on a
   locked page (lib/site-visibility.js LOCKED says which and why). The change
   is written in one transaction, and every change is in the audit log, with
   who made it and from what to what, before the answer goes back. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const audit = require('../../admin-audit');
const V = require('../../site-visibility');

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
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 64000) raw = raw.slice(0, 64000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

/* The state as the panel shows it: what is hidden, who last touched each
   thing, and the last change made. */
function panelState(state) {
  return {
    version: state.version,
    hidden: state.hidden,
    choices: V.chosen(state),
    marks: state.marks,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    last: state.last
  };
}

function listing(reg) {
  return {
    groups: reg.groups || [],
    choices: Object.keys(V.CHOICES).map((id) => ({
      id, page: V.CHOICES[id].page, label: V.CHOICES[id].label, fallback: V.CHOICES[id].fallback,
      options: V.CHOICES[id].options.map((o) => ({ value: o.value, label: o.label, detail: o.detail }))
    })),
    pages: (reg.pages || []).map((page) => ({
      id: page.id,
      file: page.file,
      title: page.title,
      group: page.group,
      menu: page.menu || '',
      locked: V.lockOf('page', page.id),
      partsLocked: Boolean(V.LOCKED[page.id] && V.LOCKED[page.id].parts),
      modules: (page.modules || []).map((m) => ({ id: m.id, key: `${page.id}#${m.id}`, label: m.label }))
    }))
  };
}

const WORD = { visible: 'Visible', hidden: 'Hidden' };

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, 'website');
  if (!who) return undefined;

  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  const reg = V.registry();
  if (!reg || !Array.isArray(reg.pages)) {
    return sendJson(response, 503, {
      code: 'NO_REGISTRY',
      message: 'The list of pages is missing from this deployment (assets/site-modules.json). Run npm run build:site-modules, then deploy again.'
    });
  }

  try {
    const db = require('../../firebase').getDb();

    if (request.method === 'GET') {
      const state = await V.readState(db);
      return sendJson(response, 200, Object.assign({ ok: true }, listing(reg), { state: panelState(state) }));
    }

    const body = await readBody(request);
    /* Read for checking only; the transaction reads it again to change it. */
    const parsed = V.parseChanges(body, reg, await V.readState(db));
    if (parsed.error) return sendJson(response, parsed.error.status, { code: parsed.error.code, message: parsed.error.message });

    const result = await V.applyChanges(db, who, parsed.changes);
    /* Awaited, every one: the log holds the change before anyone is told it
       was made. lib/admin-audit.js never throws, so a log that cannot be
       written is reported in the function log and does not undo the change. */
    await Promise.all(result.done.map((c) => audit.record(who, {
      module: 'website',
      action: c.kind === 'choice' ? 'site-design' : c.to === 'hidden' ? 'site-hide' : 'site-show',
      subject: c.kind === 'page' ? `${c.id}.html` : c.id,
      detail: `${c.label}: ${WORD[c.from] || c.from} to ${WORD[c.to] || c.to}`
    }, request)));
    if (result.done.length) V.forget();
    return sendJson(response, 200, { ok: true, changed: result.done.length, state: panelState(result.state) });
  } catch (error) {
    console.error('site visibility change failed', (error && error.message) || error);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be saved. Nothing on the site has changed.' });
  }
};
