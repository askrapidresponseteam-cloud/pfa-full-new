/* POST /api/admin/submission-status   { reference, status, note? }

   Moves a submission to another status. The older of the two ways to do it:
   the case drawer uses POST /api/admin/case { action: 'status' }.

   A register you can only read is a list; a register you can mark is a queue.
   Without this, two people work the same complaint and a third is missed.

   Since 8 Oct 2026 this route does nothing of its own: it hands the move to
   lib/case-flow.js, the same code the case drawer uses, so a status changed
   here looks exactly like one changed there - the same transition rules
   (no same-state rewrite, an explicit reopen), the same history line with
   who and an ISO time, the note in the conversation, and the audit row
   written before the answer. It used to write a history line with no `by`
   and a Firestore timestamp where every other writer stores ISO strings,
   and kept the note only on the record.

   `handledBy` is the administrator's own identity from their token, not
   something the browser sends, so the trail cannot be forged by editing the
   request. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb, fieldValue } = require('../../../lib/firebase');
const audit = require('../../../lib/admin-audit');
const S = require('../../../lib/submissions');
const FLOW = require('../../../lib/case-flow');
const PROGRESS = require('../../../lib/case-progress');

/* The generic statuses. A kind with its own stages (an application, a
   membership) may also be moved to one of those; lib/case-flow.js checks
   which are legal for the record once it is read. */
const ALLOWED = new Set(['new', 'in-progress', 'handled', 'spam']);

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  if (typeof request.body === 'string') {
    try { return Promise.resolve(JSON.parse(request.body || '{}')); } catch (_) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 64000) raw = raw.slice(0, 64000); });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
    });
    request.on('error', () => resolve({}));
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  const who = await requireAdmin(request, response, 'submissions');
  if (!who) return;

  const body = await readBody(request);
  const reference = String(body.reference || '').trim().toUpperCase();
  const status = String(body.status || '').trim().toLowerCase();
  const note = String(body.note || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, FLOW.MAX_NOTE);

  if (!reference) return sendJson(response, 400, { code: 'NO_REFERENCE', message: 'Which submission?' });
  /* The reference becomes a Firestore document id. Anything that is not one of
     ours is refused here rather than thrown at the database, where a value
     with a slash in it is an invalid path and came back as a 500. */
  if (!S.isReference(reference)) {
    return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'That does not look like a PFA reference.' });
  }
  if (!ALLOWED.has(status) && !FLOW.ANY_STAGE.has(status)) {
    return sendJson(response, 400, {
      code: 'BAD_STATUS',
      message: 'Status must be new, in-progress, handled or spam, or one of the stages of an application.'
    });
  }

  try {
    const db = getDb();
    const ref = db.collection('submissions').doc(reference);
    const at = new Date().toISOString();
    const moved = await FLOW.changeStatus({ db, ref, to: status, note, at, fieldValue, handledBy: who.email || who.uid });
    if (!moved.ok) {
      return sendJson(response, moved.http || 409, { ok: false, code: moved.code, message: moved.message, reference, status: moved.from });
    }
    await audit.record(who, { module: 'submissions', action: moved.reopen ? 'reopen' : 'status', subject: reference,
      detail: `${moved.from} to ${moved.to}${moved.reopen ? ' (reopened)' : ''}` }, request);
    /* the office told, as from the case drawer (lib/case-progress.js) */
    try {
      const snap = await ref.get();
      if (snap.exists && PROGRESS.watched(snap.data())) {
        const mail = require('../../../lib/caregiver-mail');
        await PROGRESS.tell({ reference, record: snap.data(), event: { type: 'status', from: moved.from, to: moved.to, text: note }, who, at,
          id: `${Date.parse(at)}-status-${moved.to}`, mail, queue: require('../../../lib/caregiver-store'), site: require('../../../lib/public-site').publicSite() });
      }
    } catch (error) { console.warn('case progress not told', error && error.message); }
    return sendJson(response, 200, { ok: true, reference, status: moved.to, reopened: moved.reopen, handledBy: who.email || who.uid });
  } catch (error) {
    console.error('submission status failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be saved.' });
  }
};
