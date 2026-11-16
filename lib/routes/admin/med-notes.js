'use strict';

/* GET  /api/admin/med-notes                    every care guide, newest first, with PFA's own
   POST /api/admin/med-notes { action, ... }

     save     { reference, note }        correct the note (words, and which files show); kept as a version
     publish  { reference, note? }       on the site, and the sender emailed that it is live
     ask      { reference, text }        email the sender what to change, with a private link to update it
     seed     { id, hidden }             take one of PFA's own notes off the site, or put it back

   Not publishing, and taking a note off the site, are status moves
   ("Not published", "Taken off the site") made through the case itself
   (lib/routes/admin/case.js), so they read the same in every register.

   The owner's brief (16 Nov 2026): "once approved, submitter will get an
   email confirming success. also admin should have option to send/ask for
   edit, update". Each action runs in a transaction that re-reads the note
   and checks it may still be done, writes a line in the case's conversation
   and the audit log, and only then sends the letter. The letters go through
   the outbound queue (lib/membership-notify.js), so one the mail provider
   could not take just now is sent by the email worker, and a second press
   is the same letter, never two. Needs the Care Guides section. */

const crypto = require('crypto');
const firebase = require('../../firebase');
const adminAuth = require('../../admin-auth');
const audit = require('../../admin-audit');
const S = require('../../submissions');
const FLOW = require('../../case-flow');
const MED = require('../../med-notes');
const ORDER = require('../../message-order');

const MODULE = 'mednotes';
const MAX_BODY = 128 * 1024;
const SCAN = 500;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return reject(new Error('Invalid body.')); } }
    if (request.body === null || request.readableEnded) return resolve({});
    let over = false;
    request.on('data', (chunk) => { if (over) return; raw += chunk; if (raw.length > MAX_BODY) { over = true; raw = ''; reject(new Error('Too large.')); } });
    request.on('end', () => { if (over) return; try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); } });
    request.on('error', reject);
  });
}

function whoLabel(who) {
  return (who && (who.email || who.name || who.uid)) || 'staff';
}

/* One line of the panel's list: the note, where it stands, who sent it. */
function rowOf(reference, d) {
  const note = MED.noteOf(d);
  const f = d.fields || {};
  const removed = d.status === 'removed';
  const status = removed ? 'removed' : FLOW.currentOf(d);
  return {
    reference,
    status,
    statusLabel: FLOW.labelOf(MED.KIND, status),
    published: MED.isPublished(d),
    note,
    sent: { name: MED.clean(f.name, 80), email: MED.clean(f.email, 254), mobile: MED.clean(f.mobile, 20), role: MED.clean(f.role, 40), regNo: MED.clean(f.regNo, 60) },
    attachments: Number(d.attachments) || 0,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    publishedAt: (d.published && d.published.at) || null,
    changes: d.changes ? { text: MED.clean(d.changes.text, MED.ASK_MAX), at: d.changes.at || null, by: d.changes.by || '', expiresAt: d.changes.expiresAt || null, answeredAt: d.changes.answeredAt || null } : null,
    versions: (Array.isArray(d.revisions) ? d.revisions.length : 0) + 1,
    moves: removed ? [] : FLOW.movesFor(d)
  };
}

function createHandler(deps) {
  const dd = deps || {};
  const getDb = dd.getDb || (() => firebase.getDb());
  const fieldValue = dd.fieldValue || (() => firebase.fieldValue());
  const now = dd.now || (() => Date.now());
  const requireAdmin = dd.requireAdmin || adminAuth.requireAdmin;
  const notify = dd.notify || ((args) => require('../../membership-notify').send(args));
  const site = dd.site || (() => require('../../public-site').publicSite());

  async function list(db) {
    const snap = await db.collection('submissions').where('kind', '==', MED.KIND).limit(SCAN).get();
    const rows = [];
    snap.forEach((doc) => rows.push(rowOf(doc.id, doc.data() || {})));
    rows.sort((a, b) => String(b.reference).localeCompare(String(a.reference)));
    let hidden = new Set();
    try {
      const seeds = await db.collection(MED.SEEDS).get();
      seeds.forEach((doc) => { if ((doc.data() || {}).hidden === true) hidden.add(doc.id); });
    } catch (_) { /* shown as on the site */ }
    const own = MED.seeds().map((s) => Object.assign(MED.seedPublic(s), { seed: s.id, hidden: hidden.has(s.id) }));
    return { rows, own };
  }

  /* a line in the case's conversation, in the same commit as the change */
  function noteLine(tx, ref, { text, by, at, status, tag }) {
    const id = `${Date.parse(at) || Date.now()}-${tag}-${crypto.randomBytes(3).toString('hex')}`;
    tx.set(ref.collection('messages').doc(id), { id, seq: ORDER.nextSeq(), type: 'note', text: String(text).slice(0, 4000), by, at, status });
  }

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, MODULE);
    if (!who) return;
    const by = whoLabel(who);
    const nowMs = now();
    const at = new Date(nowMs).toISOString();
    let db;
    try {
      db = getDb();
      if (request.method === 'GET') {
        const { rows, own } = await list(db);
        const counts = { waiting: 0, changes: 0, published: 0, closed: 0 };
        rows.forEach((r) => {
          if (r.status === 'removed') return;
          if (r.published) counts.published += 1;
          else if (r.status === 'changes') counts.changes += 1;
          else if (FLOW.isClosed(MED.KIND, r.status)) counts.closed += 1;
          else counts.waiting += 1;
        });
        return sendJson(response, 200, { ok: true, rows, own, counts, linkDays: MED.LINK_DAYS });
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return sendJson(response, 405, { ok: false, message: 'Use GET or POST.' });
      }

      const body = await readBody(request);
      const action = MED.clean(body.action, 20);

      if (action === 'seed') {
        const id = MED.clean(body.id, 80);
        const seed = MED.seeds().find((s) => s.id === id);
        if (!seed) return sendJson(response, 404, { ok: false, message: 'No such note.' });
        const hidden = body.hidden === true;
        await db.collection(MED.SEEDS).doc(id).set({ hidden, by, at }, { merge: true });
        await audit.record(who, { module: MODULE, action: 'med-seed', subject: id, detail: hidden ? `Took "${seed.title}" off the site` : `Put "${seed.title}" back on the site` }, request);
        return sendJson(response, 200, { ok: true, action, id, hidden });
      }

      const reference = MED.clean(body.reference, 40).toUpperCase().replace(/\s+/g, '');
      if (!S.isReference(reference) || !reference.startsWith(`${MED.KIND}-`)) return sendJson(response, 400, { ok: false, message: 'That is not a care guide.' });
      const ref = db.collection('submissions').doc(reference);
      const answer = async (status, payload) => {
        const snap = await ref.get();
        return sendJson(response, status, Object.assign({}, payload, snap.exists ? { row: rowOf(reference, snap.data() || {}) } : {}));
      };

      /* ---- save: the note corrected by PFA ---- */
      if (action === 'save' || action === 'publish') {
        const given = body.note && typeof body.note === 'object' ? body.note : null;
        let checked = null;
        if (given) {
          checked = MED.checkNote(given);
          if (checked.errors.length) return answer(422, { ok: false, message: checked.errors[0].message, fields: checked.errors });
        }
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { ok: false, http: 404, message: 'No note carries that reference.' };
          const d = snap.data() || {};
          if (d.kind !== MED.KIND) return { ok: false, http: 400, message: 'That is not a care guide.' };
          if (d.status === 'removed') return { ok: false, http: 409, message: 'This note is removed. Restore it first.' };
          const before = MED.noteOf(d);
          const all = MED.filesOf(Object.assign({}, d, { note: null }));
          const on = Number(d.attachments) || 0;
          let files = before.files;
          if (given && Array.isArray(given.files)) {
            files = given.files.map(String).filter((n) => /^\d{1,2}$/.test(n) && Number(n) >= 1 && Number(n) <= Math.max(on, all.length));
          }
          const note = Object.assign({}, checked ? checked.note : before, { files });
          const changed = MED.changedKeys(before, note);
          const fv = fieldValue();
          const update = { updatedAt: at };
          if (changed.length) {
            const revision = (Array.isArray(d.revisions) ? d.revisions.length : 0) + 1;
            Object.assign(update, { note, revisions: fv.arrayUnion({ n: revision, at, by, before }) });
            noteLine(tx, ref, { text: `Edited the note (version ${revision + 1}). Changed: ${MED.describeChanges(changed)}.`, by, at, status: FLOW.currentOf(d), tag: 'med-edit' });
          }
          let first = false;
          if (action === 'publish') {
            if (d.status === 'approved') {
              if (!changed.length) return { ok: true, unchanged: true };
            } else {
              const count = (Number(d.publishCount) || 0) + 1;
              first = true;
              const leaving = FLOW.isClosed(MED.KIND, FLOW.currentOf(d));
              Object.assign(update, {
                status: 'approved', publishCount: count, published: { at, by }, handledBy: by, handledAt: at, handledNote: '',
                history: fv.arrayUnion({ status: 'approved', event: 'publish', at, by })
              });
              if (leaving) update.closes = fv.arrayUnion(FLOW.closeOf(d, FLOW.currentOf(d)));
              noteLine(tx, ref, { text: 'Published on the website.', by, at, status: 'approved', tag: 'med-publish' });
              update.awaitingReply = false;
              tx.set(ref, update, { merge: true });
              return { ok: true, first, count, note, record: d, changed };
            }
          } else if (!changed.length) {
            return { ok: true, unchanged: true };
          }
          tx.set(ref, update, { merge: true });
          return { ok: true, first, note, record: d, changed };
        });
        if (!done.ok) return answer(done.http || 409, { ok: false, message: done.message });
        if (done.unchanged) return answer(200, { ok: true, action, unchanged: true, message: action === 'publish' ? 'It is already on the site, as it is.' : 'Nothing was changed.' });
        await audit.record(who, { module: MODULE, action: action === 'publish' ? 'med-publish' : 'med-edit', subject: reference,
          detail: action === 'publish' ? `Published "${done.note.title}"${done.changed.length ? ` (edited: ${MED.describeChanges(done.changed)})` : ''}` : `Edited: ${MED.describeChanges(done.changed)}` }, request);
        let mailed = null;
        if (done.first) {
          const sender = MED.senderOf(done.record);
          if (sender.email) {
            const home = site();
            mailed = await notify({ template: 'med_note_published', to: sender.email, dedupeKey: `${reference}:published:${done.count}`, claimBy: 'med-notes',
              payload: { name: sender.name, reference, title: done.note.title, noteUrl: MED.pageLink(home, reference), siteUrl: home } });
            await ref.collection('messages').doc(`${nowMs}-med-published-mail`).set({ id: `${nowMs}-med-published-mail`, seq: ORDER.nextSeq(), type: 'note',
              text: mailed.sent ? `Emailed ${sender.email} that the note is published.` : `The email telling ${sender.email} it is published is queued: ${mailed.reason || 'it will be retried'}.`, by: 'site', at, status: 'approved' });
          }
        }
        return answer(200, { ok: true, action, mailed, message: action === 'publish' ? (done.first ? 'Published.' : 'Saved. The site shows it now.') : 'Saved.' });
      }

      /* ---- ask: the sender is emailed what to change, with a link ---- */
      if (action === 'ask') {
        const text = MED.clean(String(body.text || '').replace(/\r/g, ''), MED.ASK_MAX + 1);
        if (!text) return answer(400, { ok: false, message: 'Write what should change first.' });
        if (text.length > MED.ASK_MAX) return answer(400, { ok: false, message: `Keep it under ${MED.ASK_MAX} characters.` });
        const { token, hash } = MED.newToken();
        const expiresAt = new Date(nowMs + MED.LINK_MS).toISOString();
        const done = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { ok: false, http: 404, message: 'No note carries that reference.' };
          const d = snap.data() || {};
          if (d.kind !== MED.KIND) return { ok: false, http: 400, message: 'That is not a care guide.' };
          if (d.status === 'removed') return { ok: false, http: 409, message: 'This note is removed. Restore it first.' };
          if (d.status === 'approved') return { ok: false, http: 409, message: 'This note is on the site. Edit it yourself, or take it off the site first and then ask for changes.' };
          const sender = MED.senderOf(d);
          if (!sender.email) return { ok: false, http: 409, message: 'No email was given with this note, so no link can be sent. Call them instead.' };
          const fv = fieldValue();
          const from = FLOW.currentOf(d);
          const asks = (Number(d.askCount) || 0) + 1;
          const update = {
            status: 'changes', askCount: asks, updatedAt: at, handledBy: by, handledAt: at, handledNote: '',
            changes: { text, at, by, linkHash: hash, expiresAt, answeredAt: null },
            history: fv.arrayUnion({ status: 'changes', event: 'ask-changes', at, by })
          };
          if (FLOW.isClosed(MED.KIND, from)) update.closes = fv.arrayUnion(FLOW.closeOf(d, from));
          tx.set(ref, update, { merge: true });
          tx.set(db.collection(MED.LINKS).doc(hash), { reference, createdAt: at, expiresAt, by });
          noteLine(tx, ref, { text: `Asked the sender to change the note: ${text}`, by, at, status: 'changes', tag: 'med-ask' });
          return { ok: true, asks, sender, title: MED.noteOf(d).title };
        });
        if (!done.ok) return answer(done.http || 409, { ok: false, message: done.message });
        const home = site();
        const mailed = await notify({ template: 'med_note_changes', to: done.sender.email, dedupeKey: `${reference}:changes:${done.asks}`, claimBy: 'med-notes', scrub: true,
          payload: { name: done.sender.name, reference, title: done.title, text, uploadUrl: MED.editLink(home, token), expiresAt, siteUrl: home } });
        await audit.record(who, { module: MODULE, action: 'med-ask', subject: reference, detail: `Asked for changes: ${text.slice(0, 200)}` }, request);
        return answer(200, { ok: true, action, mailed, to: done.sender.email, expiresAt,
          message: mailed && mailed.sent ? `Emailed ${done.sender.email} with a link to update the note. It works for ${MED.LINK_DAYS} days.` : `The email to ${done.sender.email} is queued and will be sent shortly.` });
      }

      return sendJson(response, 400, { ok: false, message: 'Unknown action.' });
    } catch (error) {
      console.error('admin med-notes failed', error && error.message);
      return sendJson(response, 500, { ok: false, message: 'That could not be done just now. Try again in a minute.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { rowOf };
