'use strict';

/* The life of a case: which states it may move to next, and the one piece of
   code that moves it.

   Until 8 Oct 2026 there were no rules. Any of the four generic statuses
   could be written over any other, by two routes that did it two ways: a
   case closed twice lost the first close's note, a reopen left the old
   closer's name on it, an application could be "handled" (a status its kind
   does not have) but never "shortlisted" (one it does), and a stale read in
   one request undid another administrator's close. Now:

   - Generic kinds: new -> in-progress -> handled | spam, and a closed case
     (handled or spam) only moves again by being reopened, to new or
     in-progress. In progress may also be handed back to new.
   - Kinds with stages (S.STAGES in lib/submissions.js) move between their
     own stage keys. A closing stage (approved, rejected, withdrawn, revoked,
     delivered; or the last stage of a kind that names none of those) is
     left only by a reopen to an open stage, or by another closing stage.
     A few stages belong to an action, not to a status move: a caregiver
     application is "Card issued" only by issuing the card (approve).
   - The same state again is refused (SAME_STATUS), so nothing is rewritten
     by a repeated click.
   - Leaving a closed state keeps the close it ends in record.closes[]
     ({ status, by, at, note }) and clears handledBy, handledAt and
     handledNote, so a reopened case never shows the old closer as its owner.
   - Every move runs in a transaction that reads the record and checks the
     state it is moving from, so two people never undo each other.

   Both admin routes that change a status (lib/routes/admin/case.js and the
   older lib/routes/admin/submission-status.js) use changeStatus() below;
   lib/inbound-mail.js uses takeUpStatus() and isClosed(). */

const S = require('./submissions');
const ORDER = require('./message-order');

const GENERIC = ['new', 'in-progress', 'handled', 'spam'];
const GENERIC_LABELS = { new: 'Waiting', 'in-progress': 'In progress', handled: 'Handled', spam: 'Spam',
  /* Not a stage and in no kind's moves: a removed record is set aside whole by
     its own action in lib/routes/admin/case.js, never moved here. The label
     lives with the others so every register and drawer words it the same. */
  removed: 'Removed' };
const GENERIC_CLOSED = new Set(['handled', 'spam']);
const GENERIC_MOVES = {
  new: ['in-progress', 'handled', 'spam'],
  'in-progress': ['new', 'handled', 'spam'],
  handled: ['new', 'in-progress'],
  spam: ['new', 'in-progress']
};

/* Stage keys that end an application or a membership. */
const CLOSING_STAGES = new Set(['approved', 'rejected', 'withdrawn', 'revoked', 'delivered']);

/* Stages that only an action may reach (8 Oct 2026): "Card issued" without a
   card on the register would tell the applicant something untrue. */
const ACTION_ONLY = {
  'PFA-CG': { approved: 'approve' },
  /* a membership card (owner, 26 Oct 2026): each of these is a fact the
     register must not be told without it being so - a link sent, a
     photograph on file, a card on the register (lib/membership-card.js) */
  'PFA-MEM': { 'photo-requested': 'request-photo', 'photo-received': 'member-upload', 'card-approved': 'approve-member-card' }
};
const ACTION_WORDS = {
  approve: 'approving the application',
  'request-photo': 'emailing the member a photo link from Membership cards',
  'member-upload': 'the member sending their photograph',
  'approve-member-card': 'approving the photograph in Membership cards'
};

/* Stages that only make sense in a given state of the record. */
const NEEDS = {
  'PFA-CG': {
    revoked: (data) => Boolean(data && data.cardId),    // only an issued card can be revoked
    rejected: (data) => !(data && data.cardId)          // "Not issued" is untrue once a card exists
  }
};

const MAX_NOTE = 4000;

function flowOf(kind) {
  const stages = S.stagesFor(kind);
  if (!stages) return { staged: false, keys: GENERIC.slice(), labels: GENERIC_LABELS, closed: GENERIC_CLOSED };
  const keys = stages.map((s) => s.key);
  let closed = new Set(keys.filter((k) => CLOSING_STAGES.has(k)));
  if (!closed.size && keys.length) closed = new Set([keys[keys.length - 1]]);
  const labels = {};
  stages.forEach((s) => { labels[s.key] = s.label; });
  return { staged: true, keys, labels, closed };
}

/* The state a record is in, as this table knows it. A kind with stages may
   still carry a generic status written before the stages were used; it is
   kept as it is (and can be moved on from), never guessed into a stage. */
function currentOf(data) {
  const d = data || {};
  const flow = flowOf(d.kind);
  const status = String(d.status || '');
  if (flow.keys.includes(status)) return status;
  if (flow.staged && GENERIC.includes(status)) return status;
  return 'new';
}

function isClosed(kind, status) {
  const flow = flowOf(kind);
  return flow.closed.has(status) || (flow.staged && GENERIC_CLOSED.has(status));
}

function labelOf(kind, status) {
  const flow = flowOf(kind);
  return flow.labels[status] || GENERIC_LABELS[status] || String(status || '');
}

/* A status this kind can ever be moved to by a status change. */
function isKnownStatus(kind, status) {
  return flowOf(kind).keys.includes(status);
}

/* The legal next states: [{ status, label, reopen }]. */
function movesFor(data) {
  const d = data || {};
  const kind = d.kind || '';
  const flow = flowOf(kind);
  const from = currentOf(d);
  const fromClosed = isClosed(kind, from);
  let targets;
  if (!flow.staged) {
    targets = GENERIC_MOVES[from] || GENERIC_MOVES.new;
  } else {
    const actionOnly = ACTION_ONLY[kind] || {};
    const needs = NEEDS[kind] || {};
    targets = flow.keys.filter((k) => k !== from && !actionOnly[k] && (!needs[k] || needs[k](d)));
  }
  return targets.map((status) => ({ status, label: labelOf(kind, status), reopen: fromClosed && !isClosed(kind, status) }));
}

/* What a case answered by PFA moves to, if it is still new: in progress for
   the generic flow, under review for an application. A kind with stages and
   no review stage (a membership) is not moved by a reply. */
function takeUpStatus(kind) {
  const flow = flowOf(kind);
  if (!flow.staged) return 'in-progress';
  return flow.keys.includes('under-review') ? 'under-review' : null;
}

/* Whether a move is allowed, and what kind of move it is. */
function planMove(data, to) {
  const d = data || {};
  const kind = d.kind || '';
  const from = currentOf(d);
  const target = String(to || '');
  if (!isKnownStatus(kind, target)) {
    const allowed = flowOf(kind).keys.join(', ');
    return { ok: false, http: 400, code: 'BAD_STATUS', from, message: `Status must be one of: ${allowed}.` };
  }
  if (target === from) {
    return { ok: false, http: 409, code: 'SAME_STATUS', from, message: `It is already ${labelOf(kind, from)}. Nothing was changed.` };
  }
  const move = movesFor(d).find((m) => m.status === target);
  if (!move) {
    const actionOnly = (ACTION_ONLY[kind] || {})[target];
    return {
      ok: false, http: 409, code: 'BAD_MOVE', from,
      message: actionOnly
        ? `${labelOf(kind, target)} is reached by ${ACTION_WORDS[actionOnly] || actionOnly}, not by a status change.`
        : `A case that is ${labelOf(kind, from)} cannot move to ${labelOf(kind, target)}.${isClosed(kind, from) ? ' Reopen it first.' : ''}`
    };
  }
  return { ok: true, from, to: target, reopen: move.reopen, closing: isClosed(kind, target), leavingClosed: isClosed(kind, from) };
}

/* The close a move ends, for record.closes[]. */
function closeOf(data, status) {
  const d = data || {};
  return { status, by: d.handledBy || '', at: d.handledAt || null, note: d.handledNote || '' };
}

/* Moves one case, in a transaction that reads it first. Shared by both
   admin routes, so a status change looks the same whichever one made it.

     ref         the submission's document reference
     to          the status asked for
     note        optional; kept as handledNote on a close, and always as a
                 note in the conversation
     handledBy   the verified identity of whoever asked (never the body)
     at          ISO time of the request
     fieldValue  firebase.fieldValue

   Resolves to { ok: true, from, to, reopen } or { ok: false, http, code,
   message }. Never throws for a refused move; a database error is thrown. */
async function changeStatus({ db, ref, to, note, handledBy, at, fieldValue, noteId }) {
  const fv = fieldValue;
  const text = String(note == null ? '' : note).trim().slice(0, MAX_NOTE);
  const id = noteId || `${Date.parse(at) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, http: 404, code: 'NOT_FOUND', message: 'No submission carries that reference.' };
    const data = snap.data() || {};
    const plan = planMove(data, to);
    if (!plan.ok) return plan;

    const update = { status: plan.to, updatedAt: at };
    if (plan.leavingClosed) update.closes = fv().arrayUnion(closeOf(data, plan.from));
    if (plan.closing) Object.assign(update, { handledBy, handledAt: at, handledNote: text });
    else if (plan.to === 'new') Object.assign(update, { handledBy: '', handledAt: null, handledNote: '' });
    else Object.assign(update, { handledBy, handledAt: at, handledNote: '' });   // taken up by whoever moved it
    update.history = fv().arrayUnion(plan.reopen
      ? { status: plan.to, event: 'reopen', reason: 'staff', at, by: handledBy }
      : { status: plan.to, at, by: handledBy });
    tx.set(ref, update, { merge: true });
    /* The note goes into the conversation in the same commit. A fresh id
       each time, so set() here writes a new document and never over one. */
    if (text) {
      tx.set(ref.collection('messages').doc(id), { id, seq: ORDER.nextSeq(), type: 'note', text, by: handledBy, at, status: plan.to });
    }
    return { ok: true, from: plan.from, to: plan.to, reopen: plan.reopen, closing: plan.closing };
  });
}

/* Every status a kind with stages uses, for a route that checks a status
   before it knows the record's kind. */
const ANY_STAGE = new Set(Object.values(S.STAGES || {}).flatMap((list) => list.map((s) => s.key)));

module.exports = {
  GENERIC, GENERIC_LABELS, ANY_STAGE, MAX_NOTE,
  flowOf, currentOf, isClosed, labelOf, isKnownStatus, movesFor, takeUpStatus, planMove, closeOf, changeStatus
};
