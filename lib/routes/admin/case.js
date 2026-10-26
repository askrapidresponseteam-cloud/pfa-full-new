/* GET  /api/admin/case?reference=PFA-C-2026-00042
   POST /api/admin/case  { reference, action: 'reply' | 'note' | 'assign' | 'status' | 'wall' | 'approve' | 'reject', ... }

   One submission, in full, and everything that can be done to it. The
   register lists; this is where a case is worked.

   - reply   { text, requestId? }  emails the sender; recorded; a new case is taken up
   - note    { text }              internal, never sent
   - assign  { to }                a staff email, or '' to clear
   - status  { status, note? }     a legal next state (lib/case-flow.js); case.moves lists them
   - wall    { published }         a film or field note on the public wall, or off it
   - approve                       a caregiver application becomes a card (needs Caregivers too)
   - reject  { reason, text? }     a caregiver application is closed as Not issued; text emails the applicant

   Every action lands in the case's conversation with who did it and when,
   and in the audit log before the answer is sent. Every answer to a POST
   carries `case`, the same shape GET returns, so the panel redraws from what
   is actually on file. Nothing here deletes; a case can be closed or
   reopened, never erased.

   Since 8 Oct 2026 every read-modify-write of the record runs in a
   transaction that re-reads it and checks the state it moves from: before
   that, an administrator's close could be undone by a reply that had read
   the case a moment earlier. A reply is reserved under its requestId before
   it is sent, so a double click or a retried request sends one email, and
   its number (reply.N in the Message-ID) is allocated in a transaction, so
   two replies never share a Message-ID. */

'use strict';

const crypto = require('crypto');
const firebase = require('../../firebase');
const mail = require('../../caregiver-mail');
const adminAuth = require('../../admin-auth');
const S = require('../../submissions');
const audit = require('../../admin-audit');
const CAREGIVER = require('../../caregiver');
const caregiverStore = require('../../caregiver-store');
const PLACE = require('../../caregiver-place');
const FORWARD = require('../../submission-forward');
const CONFIRM = require('../../confirmations');
const MT = require('../../mail-thread');
const ORDER = require('../../message-order');
const FLOW = require('../../case-flow');
const PRINT = require('../../../assets/card-print.js');
const RULES = require('../../../assets/field-rules.js');

const MAX_TEXT = 4000;
const MAX_MESSAGES = 200;
const MAX_REQUEST_ID = 80;
const REQUESTS = 'caseRequests';
/* A reply sent with no requestId (a panel from before 8 Oct 2026) is matched
   on its text instead: the same words from the same person to the same case
   within two minutes are the same click. */
const REPEAT_WINDOW_MS = 2 * 60 * 1000;

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

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function siteUrl(request) {
  const configured = clean(process.env.PUBLIC_SITE_URL, 300);
  try { const u = new URL(configured); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* fall through */ }
  const host = (request.headers || {})['x-forwarded-host'] || (request.headers || {}).host || 'pfa-full-website.vercel.app';
  return `https://${host}`;
}

function whoLabel(who) {
  return (who && (who.email || who.name || who.uid)) || 'staff';
}

function alreadyExists(error) {
  return Boolean(error && (error.code === 6 || /already exists/i.test(String(error.message))));
}

function caseView(reference, data, messages, window) {
  const contact = S.contactOf(data.fields);
  const kind = data.kind || '';
  /* currentOf knows the flows' statuses and reads anything else as 'new',
     which is right for a stray value and wrong for a removed record: that
     would draw it as Waiting with a full set of moves. Removed is its own
     state, outside every flow (the 'remove' action below). */
  const removed = data.status === 'removed' ? (data.removed || {}) : null;
  const status = removed ? 'removed' : FLOW.currentOf(data);
  const w = window || {};
  const older = Number(w.olderNotShown) || 0;
  return {
    reference,
    kind,
    cardId: data.cardId || '',
    printName: data.printName || '',
    handledAt: data.handledAt || null,
    kindLabel: data.kindLabel || S.KIND_LABELS[kind] || 'Submission',
    status,
    statusLabel: FLOW.labelOf(kind, status),
    removed,
    /* The legal next states, for the panel's "Move to" list (lib/case-flow.js).
       A removed record has none: it is read only until it is restored. */
    moves: removed ? [] : FLOW.movesFor(data),
    /* Whether this film is on the public wall, which is a separate
       question from where it sits in the queue. */
    onWall: !!(data.wall && data.wall.published),
    createdAt: data.createdAt || null,
    receivedAtMs: Number(data.receivedAtMs) || 0,
    page: data.page || '',
    fields: data.fields || {},
    /* the forms' own wording for each field, the same the inbox copy uses */
    labels: Object.fromEntries(Object.keys(data.fields || {}).map((key) => [key, FORWARD.labelIn(kind, key)])),
    attachments: Number(data.attachments) || 0,
    /* a paid caregiver application whose photograph is not attached yet, or
       could not be (lib/routes/payment/response.js, 8 Oct 2026), and the
       payment it came with, so the panel can attach it again */
    photoPending: data.photoPending === true,
    photoMissing: data.photoMissing === true,
    payment: data.payment && data.payment.orderId
      ? { orderId: String(data.payment.orderId), amount: Number(data.payment.amount) || 0, currency: String(data.payment.currency || 'INR').toUpperCase() }
      : null,
    contact,
    assignedTo: data.assignedTo || null,
    handledBy: data.handledBy || '',
    handledNote: data.handledNote || '',
    /* every earlier close, kept when the case was reopened */
    closes: Array.isArray(data.closes) ? data.closes : [],
    /* emails about this case that came back undelivered (lib/inbound-mail.js) */
    mailProblems: Array.isArray(data.mailProblems) ? data.mailProblems : [],
    threadId: data.threadId || '',
    replyCount: Number(data.replyCount) || 0,
    noteCount: Number(data.noteCount) || 0,
    lastReplyAt: data.lastReplyAt || null,
    history: Array.isArray(data.history) ? data.history : [{ status: 'new', at: data.createdAt || null }],
    messages,
    /* The newest messages are the ones shown. When there are more, say so. */
    messagesShown: messages.length,
    olderNotShown: older,
    olderNote: older ? `Only the newest ${messages.length} messages are shown; ${older === 1 ? 'one older message is' : `${older} older messages are`} not.` : ''
  };
}

function createHandler(deps) {
  const { getDb, fieldValue, deliver, isConfigured, now } = deps;
  const issueCard = deps.issueCard || caregiverStore.issueCard;
  const queueEmail = deps.queueEmail || caregiverStore.queueEmail;
  const recordEmailResult = deps.recordEmailResult || caregiverStore.recordEmailResult;
  const requireAdmin = deps.requireAdmin || adminAuth.requireAdmin;

  /* The newest MAX_MESSAGES, presented oldest first (8 Oct 2026: it used to
     read the oldest 200, so a long case hid everything said since). */
  /* Messages written in the same millisecond tie on `at`, and the database
     breaks that tie by document id, which says nothing about order: cutting
     the window there could keep an older message and drop a newer one
     (8 Oct 2026, seen on a fast Mac: note 4 shown, note 5 dropped). So a
     margin past the window is read, put in true order (when recorded, then
     seq), and the newest MAX_MESSAGES of those are shown. */
  const WINDOW_MARGIN = 50;
  async function loadMessages(ref) {
    const snap = await ref.collection('messages').orderBy('at', 'desc').limit(MAX_MESSAGES + WINDOW_MARGIN).get();
    const docs = snap.docs || [];
    const ordered = ORDER.sortMessages(docs.map((d) => Object.assign({ id: d.id }, d.data())));
    const shown = ordered.slice(-MAX_MESSAGES);
    let olderNotShown = 0;
    if (docs.length > MAX_MESSAGES) {
      olderNotShown = 1;
      try {
        const counted = await ref.collection('messages').count().get();
        olderNotShown = Math.max(1, (Number(counted.data().count) || 0) - MAX_MESSAGES);
      } catch (_) { /* at least one; the exact number is a courtesy */ }
    }
    return { messages: shown, olderNotShown };
  }

  async function loadCase(db, reference) {
    const ref = db.collection('submissions').doc(reference);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const window = await loadMessages(ref);
    return { ref, data: snapshot.data() || {}, messages: window.messages, window };
  }

  async function viewOf(db, reference) {
    const found = await loadCase(db, reference);
    if (!found) return null;
    /* a caregiver application filed before v1.450 is shown with the district
       and state its payment kept, so the drawer's card preview prints them */
    const data = await PLACE.withPlace(db, found.data);
    return caseView(reference, data, found.messages, found.window);
  }

  async function addMessage(ref, message) {
    await ref.collection('messages').doc(message.id).create(Object.assign({ seq: ORDER.nextSeq() }, message));
  }

  /* Holds a reply's requestId before anything is sent. Resolves to
     { ref, duplicate: true } for a repeat, or { ref } to go ahead. A
     requestId whose earlier attempt failed may try again; one that is still
     sending, or has sent, is a repeat. */
  async function reserveReply(db, reference, { requestId, by, text, at, nowMs }) {
    const basis = requestId ? `id\n${requestId}` : `text\n${by}\n${text}`;
    const key = crypto.createHash('sha256').update(`${reference}\n${basis}`, 'utf8').digest('hex').slice(0, 40);
    const ref = db.collection(REQUESTS).doc(key);
    const row = { reference, action: 'reply', requestId: requestId || '', by, at, atMs: nowMs, state: 'sending', attempts: 1 };
    try {
      await ref.create(row);
      return { ref };
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() || {} : {};
      const lapsed = !requestId && nowMs - (Number(prev.atMs) || 0) > REPEAT_WINDOW_MS;
      if (snap.exists && prev.state !== 'failed' && !lapsed) return { ref, duplicate: true };
      tx.set(ref, Object.assign({}, row, { attempts: (Number(prev.attempts) || 0) + 1 }), { merge: true });
      return { ref };
    });
  }

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, 'submissions');
    if (!who) return;
    const nowMs = now();
    const at = new Date(nowMs).toISOString();
    const by = whoLabel(who);
    let db = null;
    let reference = '';

    /* Every POST answer carries the case as it now stands. */
    async function answer(status, payload) {
      let view = null;
      try { view = db && reference ? await viewOf(db, reference) : null; } catch (error) {
        console.error('admin case: the case could not be re-read for the answer', error && error.message);
      }
      return sendJson(response, status, Object.assign({}, payload, view ? { case: view, mailConfigured: isConfigured() } : {}));
    }

    try {
      db = getDb();

      if (request.method === 'GET') {
        reference = clean((request.query || {}).reference, 40).toUpperCase().replace(/\s+/g, '');
        if (!S.isReference(reference)) return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'That is not a reference.' });
        const view = await viewOf(db, reference);
        if (!view) return sendJson(response, 404, { code: 'NOT_FOUND', message: 'No submission carries that reference.' });
        return sendJson(response, 200, { ok: true, case: view, mailConfigured: isConfigured() });
      }

      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
      }

      const body = await readBody(request);
      reference = clean(body.reference, 40).toUpperCase().replace(/\s+/g, '');
      const action = clean(body.action, 20);
      if (!S.isReference(reference)) { reference = ''; return sendJson(response, 400, { code: 'BAD_REFERENCE', message: 'That is not a reference.' }); }
      const ref = db.collection('submissions').doc(reference);
      const snapshot = await ref.get();
      if (!snapshot.exists) { reference = ''; return sendJson(response, 404, { code: 'NOT_FOUND', message: 'No submission carries that reference.' }); }
      const data = snapshot.data() || {};
      const kind = data.kind || '';
      const id = `${nowMs}-${Math.random().toString(36).slice(2, 8)}`;

      /* A removed record is read only until it is restored. Without this, a
         note or a reply would quietly build on a record nobody can see. */
      if (data.status === 'removed' && action !== 'restore' && action !== 'remove') {
        return answer(409, { code: 'REMOVED', message: 'This record is removed. Restore it first.' });
      }

      if (action === 'note') {
        const text = clean(body.text, MAX_TEXT);
        if (!text) return answer(400, { code: 'EMPTY', message: 'Write the note first.' });
        await addMessage(ref, { id, type: 'note', text, by, at });
        await ref.set({ noteCount: fieldValue().increment(1), updatedAt: at }, { merge: true });
        await audit.record(who, { module: 'submissions', action: 'note', subject: reference, detail: `Internal note on ${reference}` }, request);
        return answer(200, { ok: true, action, at, by });
      }

      if (action === 'assign') {
        const to = clean(body.to, 254).toLowerCase();
        if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return answer(400, { code: 'BAD_ASSIGNEE', message: 'Assign to a staff email address.' });
        const assignedTo = to ? { email: to, at, by } : null;
        /* The history line names the status the case is in now, read in the
           same transaction that writes it. */
        const changed = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const d = snap.data() || {};
          const was = (d.assignedTo && d.assignedTo.email) || '';
          if (was === to) return false;
          tx.set(ref, { assignedTo, history: fieldValue().arrayUnion({ status: FLOW.currentOf(d), event: 'assign', to, at, by }), updatedAt: at }, { merge: true });
          return true;
        });
        if (!changed) return answer(200, { ok: true, action, unchanged: true, assignedTo: data.assignedTo || null });
        await audit.record(who, { module: 'submissions', action: 'assign', subject: reference, detail: to ? `Assigned to ${to}` : 'Assignment cleared' }, request);
        return answer(200, { ok: true, action, assignedTo });
      }

      /* Putting a film on the wall is not a status. The vocabulary above is
         about this queue: new, in progress, handled, spam. `handled` means
         dealt with, and most submissions end up handled and should never
         appear on a public page, so publishing on that field would put every
         rejected and awkward one on the wall the moment someone tidied up.
         This is its own flag, its own action and its own line in the audit,
         and it can be taken back. */
      if (action === 'wall') {
        /* The same flag publishes a newsroom field note (PFA-W): one action,
           one audit line, one way to take it back, read by /api/field-notes
           the way /api/wall reads films. */
        if (data.kind !== 'PFA-S' && data.kind !== 'PFA-W') {
          return answer(400, { code: 'NOT_A_FILM', message: 'Only a wall submission or a newsroom field note can be published.' });
        }
        const published = body.published === true || body.published === 'true';
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          tx.set(ref, {
            wall: { published, by, at },
            history: fieldValue().arrayUnion({ status: FLOW.currentOf(snap.data() || {}), event: published ? 'wall-publish' : 'wall-remove', at, by }),
            updatedAt: at
          }, { merge: true });
        });
        await audit.record(who, { module: 'submissions', action: 'wall', subject: reference,
          detail: published ? 'Put on the wall' : 'Taken off the wall' }, request);
        return answer(200, { ok: true, action, published, at, by });
      }

      /* Removing is not deleting, by the oldest rule this panel has: an
         earlier admin destroyed records outright in four places - posts,
         replies and whole member profiles - and test/admin-master-record.test.js
         exists so nothing here can ever do that again. (Two scanners hold the
         rule, and the one in test/submissions.test.js reads comments too, so
         the word pair it hunts for cannot even be quoted here.) So a removed record
         keeps everything it has - its messages, its files, its history - and
         simply leaves every register, count, search and public page, under a
         status no flow can reach. What put it aside is written on it and in
         the audit, and restore puts it back exactly where it stood, wall
         placement included. */
      if (action === 'remove') {
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const d = snap.data() || {};
          if (d.status === 'removed') return null;
          const was = FLOW.currentOf(d);
          const wasWall = Boolean(d.wall && d.wall.published === true);
          tx.set(ref, Object.assign(
            {
              status: 'removed',
              removed: { at, by, was, wasWall },
              history: fieldValue().arrayUnion({ status: was, event: 'remove', at, by }),
              updatedAt: at
            },
            wasWall ? { wall: { published: false, by, at } } : {}
          ), { merge: true });
          return { was, wasWall };
        });
        if (!done) return answer(200, { ok: true, action, unchanged: true });
        await audit.record(who, { module: 'submissions', action: 'remove', subject: reference,
          detail: `Removed from the panel (was ${done.was}${done.wasWall ? ', taken off the wall' : ''})` }, request);
        return answer(200, { ok: true, action, status: 'removed', statusLabel: FLOW.labelOf(kind, 'removed'), at, by });
      }

      if (action === 'restore') {
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const d = snap.data() || {};
          if (d.status !== 'removed') return null;
          const r = d.removed || {};
          const back = r.was || 'new';
          tx.set(ref, Object.assign(
            {
              status: back,
              removed: null,
              history: fieldValue().arrayUnion({ status: back, event: 'restore', at, by }),
              updatedAt: at
            },
            r.wasWall ? { wall: { published: true, by, at } } : {}
          ), { merge: true });
          return { back, wasWall: Boolean(r.wasWall) };
        });
        if (!done) return answer(200, { ok: true, action, unchanged: true });
        await audit.record(who, { module: 'submissions', action: 'restore', subject: reference,
          detail: `Restored to ${done.back}${done.wasWall ? ', back on the wall' : ''}` }, request);
        return answer(200, { ok: true, action, status: done.back, statusLabel: FLOW.labelOf(kind, done.back), at, by });
      }

      if (action === 'status') {
        const status = clean(body.status, 30).toLowerCase();
        const note = clean(body.note, MAX_TEXT);
        const moved = await FLOW.changeStatus({ db, ref, to: status, note, handledBy: by, at, fieldValue, noteId: id });
        if (!moved.ok) {
          return answer(moved.http || 409, { ok: false, code: moved.code, message: moved.message, status: moved.from, statusLabel: FLOW.labelOf(kind, moved.from) });
        }
        await audit.record(who, { module: 'submissions', action: moved.reopen ? 'reopen' : 'status', subject: reference,
          detail: `${moved.from} to ${moved.to}${moved.reopen ? ' (reopened)' : ''}` }, request);
        return answer(200, { ok: true, action, status: moved.to, statusLabel: FLOW.labelOf(kind, moved.to), reopened: moved.reopen, at, by });
      }

      /* Emails the sender as a reply in the case's own thread: reserved
         under its requestId first, so a repeat sends nothing; numbered in a
         transaction, so two replies never share a Message-ID; recorded in the
         conversation; and a new case taken up. Reply uses it, and Reject, to
         tell an applicant why. Resolves { duplicate } or { delivered, error,
         n, status }. */
      async function emailReply(contact, text, requestId, messageDocId) {
        /* 1. Held before anything is sent: a repeat sends nothing. */
        const held = await reserveReply(db, reference, { requestId, by, text, at, nowMs });
        if (held.duplicate) return { duplicate: true };

        /* Whatever happens next, the reservation ends up saying whether the
           email went: 'failed' lets the same requestId try again, 'sent'
           refuses a repeat. Left as 'sending' only if even that write fails,
           which refuses a repeat: the safe side. */
        let delivered = false, error = '', messageId = '';
        const settle = async (state, extra) => {
          try {
            await held.ref.set(Object.assign({ state, error, messageId, finishedAt: new Date(now()).toISOString() }, extra || {}), { merge: true });
          } catch (markError) {
            console.warn('reply reservation not updated', markError && markError.message);
          }
        };
        try {
          /* 2. The reply's number, and the thread id of a record from before
             conversations had one, in one transaction: two replies at once get
             reply.1 and reply.2, and a legacy record gets exactly one thread. */
          const slot = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.data() || {};
            const threadId = MT.isThreadId(d.threadId) ? d.threadId : MT.newThreadId();
            const threadSubject = d.threadSubject || CONFIRM.threadSubject(Object.assign({ reference }, d));
            const n = Math.max(Number(d.replyN) || 0, Number(d.replyCount) || 0) + 1;
            const update = { replyN: n };
            if (threadId !== d.threadId) { update.threadId = threadId; update.threadSubject = threadSubject; }
            tx.set(ref, update, { merge: true });
            return { threadId, threadSubject, n };
          });
          const { threadId, threadSubject, n } = slot;

          const captured = Boolean(mail.captureAddress && mail.captureAddress());
          const payload = {
            name: contact.name, reference, threadId, threadSubject, n, kindLabel: data.kindLabel || S.KIND_LABELS[kind], text,
            signoff: `${who.name || (who.email ? who.email.split('@')[0].replace(/[._-]+/g, ' ') : 'People for Animals')}, People for Animals`,
            followUrl: `${siteUrl(request)}/track.html#ref=${encodeURIComponent(reference)}`,
            replyHint: captured || process.env.PFA_MAIL_REPLY_TO ? 'You can reply to this email and it will reach PFA.' : 'Reply through the site using your reference number.'
          };
          try {
            const sent = await deliver({ to: contact.email, template: 'submission_reply', payload });
            messageId = (sent && sent.messageId) || '';
            delivered = true;
          } catch (e) {
            error = clean(e && e.message, 200);
          }
          await addMessage(ref, { id: messageDocId, type: 'reply', direction: 'out', party: 'staff', from: who.email || '', to: contact.email, subject: `Re: ${threadSubject}`, text, by, at, delivered, error, messageId, n, requestId });

          let status = FLOW.currentOf(data);
          if (delivered) {
            /* 3. A reply means somebody is on it, but only a case that is still
               new is taken up: one closed while this was sending stays closed. */
            status = await db.runTransaction(async (tx) => {
              const snap = await tx.get(ref);
              const d = snap.data() || {};
              const from = FLOW.currentOf(d);
              const target = from === 'new' ? FLOW.takeUpStatus(d.kind) : null;
              const next = target || from;
              /* PFA has answered: the register's "Wrote back" marker goes */
              const update = { replyCount: fieldValue().increment(1), lastReplyAt: at, updatedAt: at, awaitingReply: false };
              /* Taken up first, then the reply, so the story reads in order:
                 two rows, one write each, applied in order in one commit. */
              if (target) Object.assign(update, { status: target, handledBy: by, handledAt: at, history: fieldValue().arrayUnion({ status: target, at, by }) });
              tx.set(ref, update, { merge: true });
              tx.set(ref, { history: fieldValue().arrayUnion({ status: next, event: 'reply', direction: 'out', at, by, n }) }, { merge: true });
              return next;
            });
          } else {
            await ref.set({ updatedAt: at }, { merge: true });
          }
          await settle(delivered ? 'sent' : 'failed', { n });
          return { delivered, error, n, status };
        } catch (failure) {
          await settle(delivered ? 'sent' : 'failed', { error: clean(failure && failure.message, 200) });
          throw failure;
        }
      }

      if (action === 'reply') {
        const text = clean(body.text, MAX_TEXT);
        if (!text) return answer(400, { code: 'EMPTY', message: 'Write the reply first.' });
        const requestId = clean(body.requestId, 200);
        if (requestId.length > MAX_REQUEST_ID) return answer(400, { code: 'BAD_REQUEST_ID', message: `requestId is at most ${MAX_REQUEST_ID} characters.` });
        const contact = S.contactOf(data.fields);
        if (!contact.email) return answer(409, { code: 'NO_EMAIL', message: contact.mobile ? `No email was given. Call ${contact.mobile} and add a note of what was said.` : 'No email or mobile was given with this submission.' });
        if (!isConfigured()) return answer(503, { code: 'MAIL_NOT_CONFIGURED', message: 'Email is not set up on the server (PFA_SMTP_USER and PFA_SMTP_PASS, or PFA_MAIL_API_KEY), so replies cannot be sent yet.' });
        const sent = await emailReply(contact, text, requestId, id);
        if (sent.duplicate) {
          return answer(200, { ok: true, action, duplicate: true, message: 'That reply was already sent (or is being sent). Nothing was sent again.' });
        }
        const { delivered, error, n, status } = sent;
        await audit.record(who, {
          module: 'submissions', action: 'reply', subject: reference,
          detail: delivered ? `Replied by email to ${contact.email}` : `Reply to ${contact.email} was not delivered`,
          outcome: delivered ? 'done' : 'refused'
        }, request);
        return answer(delivered ? 200 : 502, {
          ok: delivered, action, delivered, to: contact.email, at, by, n, status, statusLabel: FLOW.labelOf(kind, status),
          message: delivered ? '' : `The email was not delivered: ${error || 'the mail provider refused it'}. The reply is kept on the case; try again or call them.`
        });
      }

      /* Reject a colony caregiver application (owner, 24 Oct 2026: "there
         should be issue or reject"). The reason is required: it closes the
         application as "Not issued", is kept on it as the close note, and is
         what the applicant is told, in an email they can answer (the case's
         own thread, as a reply). The same guards as issuing: an application
         with a card is revoked, never rejected; a closed one is reopened
         first. The status moves in a transaction that re-reads it, so a card
         issued by someone else a moment earlier is never contradicted. */
      if (action === 'reject') {
        if (kind !== 'PFA-CG') return answer(400, { code: 'NOT_AN_APPLICATION', message: 'Only a colony caregiver application is rejected here.' });
        if (!(await requireAdmin(request, response, 'caregivers'))) return undefined;
        if (data.cardId) return answer(409, { code: 'ALREADY_ISSUED', message: `A card was already issued for this application (${data.cardId}). Revoke the card instead.` });
        const current = FLOW.currentOf(data);
        if (FLOW.isClosed(kind, current)) return answer(409, { code: 'CLOSED', message: `This application is ${FLOW.labelOf(kind, current)} already.` });
        const reason = clean(body.reason, 1000);
        if (!reason) return answer(400, { code: 'NO_REASON', message: 'Say why the card is not being issued.' });
        const text = clean(body.text, MAX_TEXT);
        const moved = await FLOW.changeStatus({ db, ref, to: 'rejected', note: `Not issued. ${reason}`, handledBy: by, at, fieldValue, noteId: id });
        if (!moved.ok) {
          return answer(moved.http || 409, { ok: false, code: moved.code, message: moved.message, status: moved.from, statusLabel: FLOW.labelOf(kind, moved.from) });
        }
        /* Then the applicant is told. The application is already closed
           whatever happens to the email; the answer says which. */
        const contact = S.contactOf(data.fields);
        let emailed = false;
        let emailNote = '';
        if (!text) emailNote = 'No email was written, so none was sent.';
        else if (!contact.email) emailNote = contact.mobile ? `No email on the application. Call ${contact.mobile} to tell them.` : 'No email or mobile on the application.';
        else if (!isConfigured()) emailNote = 'Email is not set up on the server, so the applicant was not emailed.';
        else {
          const sent = await emailReply(contact, text, clean(body.requestId, 80) || `reject:${reference}`, `${id}-r`);
          emailed = Boolean(sent.duplicate || sent.delivered);
          if (!emailed) emailNote = `The email did not go: ${sent.error || 'the mail provider refused it'}. It is kept on the application; send it again as a reply.`;
        }
        await audit.record(who, { module: 'submissions', action: 'reject', subject: reference,
          detail: `Not issued: ${reason.slice(0, 200)}${emailed ? `; ${contact.email} emailed` : ''}` }, request);
        return answer(200, { ok: true, action, status: 'rejected', statusLabel: FLOW.labelOf(kind, 'rejected'), emailed, to: emailed ? contact.email : '', message: emailNote });
      }

      /* Approve a paid colony caregiver application: the card is issued on
         the register from what the applicant sent, the application records
         the card number and moves to its "Card issued" stage, and the
         applicant is emailed that it is approved and will be posted. The card
         then shows on Print and post. What the reviewer approved is the card
         they previewed: the same fields, drawn by the same renderer. This is
         the only way a card comes to exist (lib/routes/caregiver/apply.js is
         retired), and only the back office can do it: Submissions and
         Caregivers both. The applicant never sees the card drawn; the
         printed card is the only copy. */
      if (action === 'approve') {
        if (kind !== 'PFA-CG') return answer(400, { code: 'NOT_AN_APPLICATION', message: 'Only a colony caregiver application can be approved into a card.' });
        /* Issuing a card is the Caregivers register's business as well as the
           case's (8 Oct 2026): an account with Submissions alone could issue
           cards it could not see. The guard answers the refusal itself. */
        if (!(await requireAdmin(request, response, 'caregivers'))) return undefined;
        if (data.cardId) return answer(409, { code: 'ALREADY_ISSUED', message: `A card was already issued for this application: ${data.cardId}.` });
        const current = FLOW.currentOf(data);
        if (current === 'spam') return answer(409, { code: 'SPAM', message: 'This application is marked spam. Move it back first.' });
        if (FLOW.isClosed(kind, current)) return answer(409, { code: 'CLOSED', message: `This application is ${FLOW.labelOf(kind, current)}. Reopen it before issuing a card.` });
        /* the district and state print on the card (lib/caregiver-place.js) */
        const f = (await PLACE.withPlace(db, data)).fields || {};
        const name = clean(f.name, 60);
        const mobile = CAREGIVER.normaliseMobile(clean(f.mobile, 20));
        const addressLine = [clean(f.address, 200), clean(f.city, 80)].filter(Boolean).join(', ');
        const pin = CAREGIVER.extractPin(addressLine) || CAREGIVER.extractPin(clean(f.pin, 10)) || '';
        if (!name || !mobile) return answer(422, { code: 'INCOMPLETE', message: 'The application has no usable name or mobile. Ask the applicant for them first.' });
        /* The name as the card prints it (owner, 24 Oct 2026: one size for
           every card, nothing cut or squeezed). The reviewer's, when they
           confirmed or edited it; otherwise the whole name, if it fits. A
           shortened name is never issued on the rule's say alone. */
        const suggestion = PRINT.suggestName(RULES.nameCase(name));
        const printName = clean(body.printName, 80).replace(/\s+/g, ' ') || (suggestion.fits && !suggestion.shortened ? suggestion.text : '');
        if (!printName) {
          return answer(422, { code: 'PRINT_NAME_NEEDED', suggestion: suggestion.fits ? suggestion.text : '',
            message: suggestion.fits
              ? `The full name does not fit the card. Confirm the name to print: ${suggestion.text}.`
              : 'The name does not fit the card at its fixed size. Type the name to print, for example with initials.' });
        }
        const nameProblem = PRINT.nameProblem(printName);
        if (nameProblem) return answer(422, { code: 'PRINT_NAME_BAD', message: nameProblem, suggestion: suggestion.fits ? suggestion.text : '' });
        const place = { district: PRINT.placeName(clean(f.district, 60)), state: PRINT.placeName(clean(f.state, 40)) };
        if (!place.district || !place.state) return answer(422, { code: 'NO_PLACE', message: 'The card prints the district and the state. Ask the applicant for them first.' });
        if (!PRINT.fits(place.district) || !PRINT.fits(place.state)) return answer(422, { code: 'PLACE_TOO_LONG', message: 'The district or state is not one the card can print. Correct it on the application first.' });
        /* The printed card is the only copy, and it goes by post (owner, 24
           Oct 2026), so a card with nowhere to go is not issued. */
        if (!CAREGIVER.postable({ address: addressLine, pin })) return answer(422, { code: 'NO_ADDRESS', message: 'The card is posted to the applicant, and the application has no full postal address with a 6-digit PIN. Ask the applicant for it first.' });
        const application = { name, printName, mobile, email: clean(f.email, 254).toLowerCase(), address: addressLine, pin,
          district: clean(f.district, 60), state: clean(f.state, 40) };
        const result = await issueCard({ application, idempotencyKey: `application:${reference}`, requestMeta: { ip: '' } });
        const card = result.card;
        if (result.reissued && !result.sameRequest) {
          return answer(409, { code: 'MOBILE_HELD', cardId: card.cardId,
            message: `This mobile number already holds card ${card.cardId} (${card.name}). Reply to the applicant rather than issuing a second card.` });
        }
        /* Point the card back at the application so the panel can print it
           with the photograph the applicant sent. */
        await db.collection('caretakerCards').doc(card.cardId).set({ applicationRef: reference, approvedBy: by, approvedAt: at }, { merge: true });
        /* Recorded in a transaction that re-reads the application. Two
           approves at once get the same card from the register (one
           idempotency key); only the first records it. */
        const recorded = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const d = snap.data() || {};
          if (d.cardId) return d.cardId === card.cardId ? 'already' : 'other';
          const from = FLOW.currentOf(d);
          if (FLOW.isClosed(kind, from)) {
            /* closed by someone else while the card was being issued: the
               card exists, so the link is kept, and the status is left alone */
            tx.set(ref, { cardId: card.cardId, updatedAt: at }, { merge: true });
            return 'closed';
          }
          tx.set(ref, {
            cardId: card.cardId, printName: card.printName || printName, status: 'approved', handledBy: by, handledAt: at, handledNote: '', updatedAt: at,
            history: fieldValue().arrayUnion({ status: 'approved', at, by })
          }, { merge: true });
          tx.set(ref.collection('messages').doc(id), { id, seq: ORDER.nextSeq(), type: 'note', text: `Approved. Card ${card.cardId} issued.`, by, at, status: 'approved' });
          return 'done';
        });
        if (recorded === 'already') return answer(409, { code: 'ALREADY_ISSUED', cardId: card.cardId, message: `A card was already issued for this application: ${card.cardId}.` });
        if (recorded === 'other') return answer(409, { code: 'ALREADY_ISSUED', message: 'Another card was recorded on this application meanwhile. Check it before going on.' });
        if (recorded === 'closed') {
          await audit.record(who, { module: 'submissions', action: 'approve', subject: reference, detail: `Card ${card.cardId} issued; the application had been closed meanwhile`, outcome: 'refused' }, request);
          return answer(409, { code: 'STATUS_CHANGED', cardId: card.cardId, message: `Card ${card.cardId} was issued, but the application was closed by someone else meanwhile. Its status was left as it is; check it before emailing the holder.` });
        }
        /* Queued first, so it survives a mail outage and the worker will send
           it; then sent now, because "the holder emailed" has to be true when
           the panel says it. It used to be queued only, which meant the card
           email waited for the daily worker - up to a day - while the note on
           the case said it had gone. */
        let emailed = false;
        if (application.email) {
          /* an approval notice, not the card: no card number and no link to
             one (lib/caregiver-mail.js card_issued). The printed card is
             posted; the applicant follows the application by its number. */
          const payload = { name: card.name, applicationRef: reference, issuedAt: card.issuedAt, validUntil: card.validUntil,
            postTo: CAREGIVER.postalLines({ address: addressLine, district: application.district, state: application.state, pin }),
            followUrl: `${siteUrl(request)}/track.html#ref=${encodeURIComponent(reference)}` };
          try {
            /* written already claimed, so the worker or Resend cannot send it
               while this request does (lib/caregiver-store.js lease, 8 Oct 2026) */
            const configured = isConfigured();
            const queued = await queueEmail({ template: 'card_issued', to: application.email, dedupeKey: `card_issued:${card.cardId}`, payload, claim: configured ? 'approve' : undefined });
            if (queued.created && configured) {
              try {
                const sent = await deliver({ to: application.email, template: 'card_issued', payload });
                await recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
                emailed = true;
              } catch (mailError) {
                await recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error: mailError });
                console.error('approve: card email not sent now; the worker will retry it', mailError && mailError.message);
              }
            } else if (!queued.created) {
              emailed = queued.status === 'sent';      /* sent on an earlier approve of the same card */
            }
          } catch (e) { console.error('approve: card email not queued', e && e.message); }
        }
        await audit.record(who, { module: 'submissions', action: 'approve', subject: reference, detail: `Card ${card.cardId} issued from the application${printName !== RULES.nameCase(name) ? `, printed as ${printName}` : ''}` }, request);
        return answer(200, { ok: true, action, cardId: card.cardId, status: 'approved', statusLabel: FLOW.labelOf(kind, 'approved'), emailed, softDuplicateOf: result.softDuplicateOf || null });
      }

      return answer(400, { code: 'BAD_ACTION', message: 'action must be reply, note, assign, status, wall, approve or reject.' });
    } catch (error) {
      console.error('admin case failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done right now.' });
    }
  };
}

/* The printed card's two steps on the application it came from, "Card
   printed" and "Card posted" (lib/submissions.js shows them to the
   applicant). Print and post (lib/routes/admin/cards.js) records them, in
   its own batch, through here: every write to a case lives in this file and
   submission-status.js, and none of them touches what the sender wrote. */
function cardStepOnApplication(db, batch, fieldValue, { reference, cardId, event, at, by }) {
  if (!reference || !['card-printed', 'card-posted'].includes(event)) return false;
  batch.set(db.collection('submissions').doc(reference), {
    history: fieldValue().arrayUnion({ status: 'approved', event, cardId, at, by }),
    updatedAt: at
  }, { merge: true });
  return true;
}

/* ---- the membership card's steps on the member's record ------------------

   Owner, 26 Oct 2026: a member is emailed a link for their photograph, sends
   it, and PFA approves it into a card. Every write to a case lives here and
   in submission-status.js, so these steps do too; the routes that drive
   them (lib/routes/admin/membership.js, lib/routes/membership/photo.js)
   call these inside their own transaction, after reading the record and
   checking the step is allowed (lib/membership-card.js). Each touches the
   status, the photo and card state, the history and the conversation, and
   never what the member wrote. */
const MEMBER_STEPS = new Set(['photo-requested', 'photo-received', 'card-approved', 'card-printed']);

function memberRecord(db, reference) {
  return db.collection('submissions').doc(reference);
}

/* Every membership on the register, for the Membership cards queues. */
function memberRecords(db, limit) {
  return db.collection('submissions').where('kind', '==', 'PFA-MEM').limit(limit).get();
}

function memberStep(tx, ref, fieldValue, { step, at, by, photo, card, attachment, note, noteId }) {
  if (!MEMBER_STEPS.has(step)) return false;
  const update = { updatedAt: at };
  if (step === 'photo-requested' || step === 'photo-received') {
    update.status = step;
    if (photo) update.memberPhoto = photo;
  } else if (step === 'card-approved') {
    Object.assign(update, { status: step, memberCard: card, handledBy: by, handledAt: at, handledNote: '' });
  } else {
    update.memberCard = card;
  }
  update.history = fieldValue().arrayUnion(step === 'card-printed'
    ? { status: 'card-approved', event: 'card-printed', at, by }
    : { status: step, at, by });
  if (attachment && attachment.id) tx.create(ref.collection('attachments').doc(attachment.id), attachment.data);
  tx.set(ref, update, { merge: true });
  if (note) {
    const id = noteId || `${Date.parse(at) || Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    tx.set(ref.collection('messages').doc(id), { id, seq: ORDER.nextSeq(), type: 'note', text: String(note).slice(0, MAX_TEXT), by, at, status: update.status || 'card-approved' });
  }
  return true;
}

module.exports = createHandler({
  getDb: firebase.getDb,
  fieldValue: firebase.fieldValue,
  deliver: mail.deliver,
  isConfigured: mail.isConfigured,
  now: () => Date.now()
});
module.exports.cardStepOnApplication = cardStepOnApplication;
module.exports.memberRecord = memberRecord;
module.exports.memberRecords = memberRecords;
module.exports.memberStep = memberStep;
module.exports._private = { createHandler, caseView, STATUS_LABELS: FLOW.GENERIC_LABELS };
