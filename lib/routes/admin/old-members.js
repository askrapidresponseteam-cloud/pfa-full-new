'use strict';

/* GET  /api/admin/old-members                 the old site's members, with every change made by hand
   POST /api/admin/old-members  { action: 'import', fileName, data }                 (super admin)
   POST /api/admin/old-members  { action: 'propose', change, reason }                (super admin)
   POST /api/admin/old-members  { action: 'confirm', proposalId, confirm: 'CONFIRM' } (super admin)

   Owner, 26 Oct 2026: the members who applied on the old site are kept on a
   page of their own, "DONT ADD THEM TO THE CURRENT PANEL. KEEP THIS SEPARATE
   AND VERY CLEARLY". So this route reads and writes one collection,
   oldSiteMembers, and nothing else: never `members`, never `submissions`,
   never a count or search the rest of the panel uses. The people in it hold
   no card, no login and no record anywhere else.

   The list is never committed to the site's code (the repository is public);
   it reaches the database only through this import, behind the admin sign-in.
   The workbook is read and de-duplicated by lib/old-members.js. An import is
   kept whole: its people are written in parts under one import id, and the
   `current` pointer moves to it in the same batch, so a reader sees the old
   import or the new one, never half of one. Earlier imports stay where they
   are, as nothing in this panel is ever deleted.

   Changes by hand (owner, 26 Oct 2026: "edit merge etc manually with 2 level
   confirmations and audit history ... who changed what and why"). Two
   steps, both enforced here, not only in the page:
     1. propose: the change and its reason are checked (a reason that does
        not say why is refused, lib/old-members-changes.js), the exact before
        and after are worked out and kept as a proposal for this person
        only, for 15 minutes;
     2. confirm: the same person sends that proposal back with the word
        CONFIRM. It is refused if anyone changed the list in between, so a
        change is only ever confirmed against what was shown.
   A confirmed change is a new document in oldSiteMembersChanges (who, when,
   what, before, after, why), and the admin audit log gets a line too. The
   list is the import with every change replayed, in order; nothing is
   overwritten. */

const { requireAdmin } = require('../../admin-auth');
const { getDb } = require('../../firebase');
const audit = require('../../admin-audit');
const OLD = require('../../old-members');
const CH = require('../../old-members-changes');

const COLLECTION = 'oldSiteMembers';
const CHANGES = 'oldSiteMembersChanges';
const PROPOSALS = 'oldSiteMembersProposals';
const CURRENT = 'current';
const PROPOSAL_MS = 15 * 60 * 1000;
const CONFIRM_WORD = 'CONFIRM';
const MAX_FILE_BYTES = 9 * 1024 * 1024;
/* a Firestore document holds 1 MiB; parts stay well under it */
const PART_BYTES = 600 * 1024;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    let size = 0; let over = false;
    request.on('data', (chunk) => { size += chunk.length; if (size > MAX_FILE_BYTES * 1.4) over = true; else raw += chunk; });
    request.on('end', () => { if (over) return resolve({ tooLarge: true }); try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function parts(members) {
  const out = [];
  let part = []; let bytes = 0;
  for (const m of members) {
    const size = Buffer.byteLength(JSON.stringify(m));
    if (part.length && bytes + size > PART_BYTES) { out.push(part); part = []; bytes = 0; }
    part.push(m); bytes += size;
  }
  if (part.length) out.push(part);
  return out;
}

function importId(atMs) {
  const d = new Date(atMs).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `IMP-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function readCurrent(db) {
  const pointer = await db.collection(COLLECTION).doc(CURRENT).get();
  if (!pointer.exists || !pointer.data().importId) return null;
  const id = pointer.data().importId;
  const head = await db.collection(COLLECTION).doc(id).get();
  if (!head.exists) return null;
  const meta = head.data();
  const docs = await Promise.all(Array.from({ length: Number(meta.parts) || 0 }, (_, n) => db.collection(COLLECTION).doc(`${id}-part-${n + 1}`).get()));
  const members = docs.flatMap((d) => (d.exists ? d.data().members || [] : []));
  return {
    importId: id,
    changeSeq: Number(pointer.data().changeSeq) || 0,
    fileName: meta.fileName || '',
    importedAt: meta.importedAt || '',
    importedBy: meta.importedBy || '',
    stats: meta.stats || {},
    review: meta.review || [],
    members
  };
}

async function readChanges(db) {
  const snap = await db.collection(CHANGES).orderBy('seq').get();
  return snap.docs.map((d) => d.data());
}

/* The list as it stands now, and the state the changes were replayed into. */
async function standing(db) {
  const current = await readCurrent(db);
  if (!current) return null;
  const changes = await readChanges(db);
  const { state, results } = CH.replay(current.members, changes);
  return { current, changes, state, results };
}

const who4 = (who) => ({ uid: who.uid || '', email: who.email || '', name: who.name || '', role: who.role || '' });
const pad = (n) => String(n).padStart(6, '0');

/* What the page is sent: no source rows beyond where each came from. */
function forPage(m) {
  const out = Object.assign({}, m);
  delete out.rows;
  delete out.overrides;
  return out;
}

async function propose(db, who, body, request) {
  const now = await standing(db);
  if (!now) return { status: 409, payload: { code: 'NOT_LOADED', message: 'Load the old list first.' } };
  const why = CH.checkReason(body.reason);
  if (!why.ok) return { status: 422, payload: { code: 'REASON', message: why.message } };
  let change;
  try {
    change = CH.normalise(now.state, body.change);
  } catch (error) {
    if (error instanceof CH.ChangeError) return { status: 422, payload: { code: error.code, message: error.message } };
    throw error;
  }
  const trial = CH.replay(now.current.members, now.changes).state;
  const result = CH.apply(trial, change);
  const text = CH.summary(change, result.before, result.after);
  const warn = CH.warnings(trial, change, result.after);
  const atMs = Date.now();
  const ref = db.collection(PROPOSALS).doc();
  await ref.set({
    by: who4(who), change, reason: why.reason, summary: text, before: result.before, after: result.after, warnings: warn,
    importId: now.current.importId, changeSeq: now.current.changeSeq,
    createdAt: new Date(atMs).toISOString(), createdAtMs: atMs, expiresAtMs: atMs + PROPOSAL_MS, used: false
  });
  await audit.record(who, { module: 'oldmembers', action: 'old-members-propose', subject: ref.id, detail: `${text}. Why: ${why.reason}` }, request);
  return { status: 200, payload: { ok: true, proposalId: ref.id, summary: text, before: result.before, after: result.after, warnings: warn, reason: why.reason, op: change.op, expiresAtMs: atMs + PROPOSAL_MS, confirmWord: CONFIRM_WORD } };
}

async function confirm(db, who, body, request) {
  if (String(body.confirm || '').trim() !== CONFIRM_WORD) {
    return { status: 422, payload: { code: 'CONFIRM_WORD', message: `Type ${CONFIRM_WORD} to save the change.` } };
  }
  const id = String(body.proposalId || '');
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return { status: 400, payload: { code: 'NO_PROPOSAL', message: 'Review the change first.' } };
  const proposalRef = db.collection(PROPOSALS).doc(id);
  const pointerRef = db.collection(COLLECTION).doc(CURRENT);
  const atMs = Date.now();
  const outcome = await db.runTransaction(async (tx) => {
    const [p, pointer] = await Promise.all([tx.get(proposalRef), tx.get(pointerRef)]);
    if (!p.exists) return { status: 404, payload: { code: 'NO_PROPOSAL', message: 'Review the change first.' } };
    const prop = p.data();
    if (prop.by.uid !== (who.uid || '') || prop.by.email !== (who.email || '')) return { status: 403, payload: { code: 'NOT_YOURS', message: 'Only the person who reviewed this change can confirm it.' } };
    if (prop.used) return { status: 409, payload: { code: 'USED', message: 'This change was already saved.' } };
    if (atMs > prop.expiresAtMs) return { status: 409, payload: { code: 'EXPIRED', message: 'This review is more than 15 minutes old. Review the change again.' } };
    const cur = pointer.exists ? pointer.data() : {};
    if (cur.importId !== prop.importId || (Number(cur.changeSeq) || 0) !== prop.changeSeq) {
      return { status: 409, payload: { code: 'STALE', message: 'The list changed since you reviewed this. Review the change again.' } };
    }
    const seq = prop.changeSeq + 1;
    const record = {
      seq, at: new Date(atMs).toISOString(), atMs, by: who4(who), change: prop.change, reason: prop.reason,
      summary: prop.summary, before: prop.before, after: prop.after, warnings: prop.warnings || [],
      importId: prop.importId, proposalId: id, proposedAt: prop.createdAt
    };
    tx.set(db.collection(CHANGES).doc('C' + pad(seq)), record);
    tx.set(pointerRef, { changeSeq: seq, updatedAt: record.at, updatedBy: who.email || who.uid || '' }, { merge: true });
    tx.update(proposalRef, { used: true, usedAtMs: atMs, changeSeq: seq });
    return { status: 200, payload: { ok: true, seq, summary: prop.summary }, record };
  });
  if (outcome.record) {
    await audit.record(who, { module: 'oldmembers', action: 'old-members-change', subject: 'C' + pad(outcome.record.seq), detail: `${outcome.record.summary}. Why: ${outcome.record.reason}` }, request);
  } else {
    await audit.record(who, { module: 'oldmembers', action: 'old-members-change', subject: id, detail: outcome.payload.message, outcome: 'refused' }, request);
  }
  return { status: outcome.status, payload: outcome.payload };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const who = await requireAdmin(request, response, 'oldmembers');
  if (!who) return undefined;

  try {
    const db = getDb();

    const isSuper = who.role === 'super';
    if (request.method === 'GET') {
      const now = await standing(db);
      if (!now) return sendJson(response, 200, { ok: true, empty: true, canImport: isSuper, canEdit: false, members: [], review: [], history: [] });
      const { current, changes, state, results } = now;
      const members = [...state.members.values()].map(forPage)
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
      const review = CH.currentReview(current.review, state);
      const stats = Object.assign({}, current.stats, { people: members.length, toCheck: review.length, changes: changes.length });
      const history = changes.map((c, i) => ({
        seq: c.seq, at: c.at, by: c.by, op: c.change && c.change.op, summary: c.summary, reason: c.reason,
        before: c.before, after: c.after, warnings: c.warnings || [], ids: [...new Set([...(c.before || []), ...(c.after || [])].filter(Boolean).map((x) => x.id))],
        appliesNow: results[i] ? results[i].applied : true, note: results[i] ? results[i].skipped : ''
      })).reverse();
      return sendJson(response, 200, {
        ok: true, canImport: isSuper, canEdit: isSuper, importId: current.importId, fileName: current.fileName,
        importedAt: current.importedAt, importedBy: current.importedBy, stats, review, members, history
      });
    }

    const body = await readBody(request);
    if (body.tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That file is too large. The membership list should be well under 9 MB.' });
    if (!['import', 'propose', 'confirm'].includes(body.action)) return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    if (!isSuper) {
      await audit.record(who, { module: 'oldmembers', action: 'old-members-' + body.action, subject: String(body.fileName || body.proposalId || '').slice(0, 120), detail: 'Only a super administrator can change the old list', outcome: 'refused' }, request);
      return sendJson(response, 403, { code: 'SUPER_ONLY', message: body.action === 'import' ? 'Only a super administrator can load the old list.' : 'Only a super administrator can change the old list.' });
    }
    if (body.action === 'propose' || body.action === 'confirm') {
      const out = body.action === 'propose' ? await propose(db, who, body, request) : await confirm(db, who, body, request);
      return sendJson(response, out.status, out.payload);
    }
    const fileName = String(body.fileName || 'workbook.xlsx').replace(/[^\w .()&+-]/g, '').slice(0, 120);
    const data = String(body.data || '').replace(/^data:[^,]*,/, '');
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return sendJson(response, 400, { code: 'NO_FILE', message: 'Choose the .xlsx file first.' });
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_FILE_BYTES) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That file is too large. The membership list should be well under 9 MB.' });

    let built;
    try {
      built = OLD.build(bytes);
    } catch (error) {
      const known = error && (error.code === 'BAD_WORKBOOK' || error.code === 'NO_MEMBERS' || error.code === 'DEDUPE_FAILED');
      if (!known) throw error;
      return sendJson(response, 422, { code: error.code, message: error.message + (error.code === 'BAD_WORKBOOK' ? '' : ' Nothing was saved.') });
    }

    const atMs = Date.now();
    const id = importId(atMs);
    const chunks = parts(built.members);
    const batch = db.batch();
    const col = db.collection(COLLECTION);
    chunks.forEach((members, n) => batch.set(col.doc(`${id}-part-${n + 1}`), { importId: id, part: n + 1, members }));
    batch.set(col.doc(id), {
      importId: id,
      fileName,
      importedAt: new Date(atMs).toISOString(),
      importedAtMs: atMs,
      importedBy: who.email || who.uid || '',
      parts: chunks.length,
      stats: built.stats,
      review: built.review
    });
    /* merge: the count of changes made by hand carries on across imports;
       they are replayed onto the newer copy by person id */
    batch.set(col.doc(CURRENT), { importId: id, updatedAt: new Date(atMs).toISOString(), updatedBy: who.email || who.uid || '' }, { merge: true });
    await batch.commit();

    const s = built.stats;
    await audit.record(who, {
      module: 'oldmembers', action: 'old-members-import', subject: id,
      detail: `${fileName}: ${s.rowsRead} rows, ${s.people} people, ${s.rowsJoined} duplicate rows joined, ${s.toCheck} to check`
    }, request);
    return sendJson(response, 200, { ok: true, importId: id, stats: s });
  } catch (error) {
    console.error('old members failed', (error && error.message) || error);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done. Nothing was changed.' });
  }
};

module.exports._private = { COLLECTION, CHANGES, PROPOSALS, readCurrent, parts, standing };
