'use strict';

/* GET  /api/admin/old-members                 the old site's members, with every change made by hand
   POST /api/admin/old-members  { action: 'import', fileName, data }                 (super admin)
   POST /api/admin/old-members  { action: 'propose', change, reason }                (super admin)
   POST /api/admin/old-members  { action: 'confirm', proposalId, confirm: 'CONFIRM' } (super admin)
   GET  /api/admin/old-members?notes=<person id>   one person's notes and emails
   POST /api/admin/old-members  { action: 'note', personId, text, email: { to, subject } }
                                                    a note, and an email to them if asked

   Notes and emails (owner, 28 Oct 2026: "there should be a section to add
   notes if someone from admin side reaches out to the person and email
   should go out..optional. from here.. like for existing tickets"). Anyone
   with the Old site members section may add a note; it is kept in
   oldSiteMembersNotes, never changes the person, and is in the audit log.
   Ticked, the same words go to them by email from info@, to one of their
   own addresses. Their reply comes back as the forms' replies do: to the
   site's mailbox, read every two minutes (lib/inbound-mail.js), filed here
   under them (fileReply), and sent on to whoever wrote to them; that
   person's Reply goes on to them from info@ and is kept here too. Each
   person has one conversation (oldSiteMembersThreads), so every email in it
   carries ids that name them (lib/mail-thread.js, PFA-OLD-...).

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

const MT = require('../../mail-thread');
const NOTIFY = require('../../membership-notify');
const STORE = require('../../caregiver-store');

const COLLECTION = 'oldSiteMembers';
const NOTES = 'oldSiteMembersNotes';
const THREADS = 'oldSiteMembersThreads';
const NOTE_MAX = 4000;
const SUBJECT_MAX = 150;
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

/* ---- notes and emails (28 Oct 2026) ----------------------------------- */

/* A person joined into another keeps their notes: absorbed id to kept id. */
function aliasesOf(changes) {
  const map = new Map();
  for (const c of changes || []) {
    const ch = c && c.change;
    if (ch && ch.op === 'merge' && ch.absorb && ch.keep) map.set(ch.absorb, ch.keep);
  }
  return map;
}
function resolveId(aliases, id) {
  let x = id;
  for (let n = 0; n < 20 && aliases.has(x); n += 1) x = aliases.get(x);
  return x;
}

const referenceOf = (personId) => 'PFA-OLD-' + String(personId || '').replace(/^OSM-/, '');
const LIVE_PENDING = new Set(['queued', 'retry', 'sending', 'unsent']);

/* Every note, resolved to who it is about now, newest first. An email not
   yet known to have gone is read against the outbound queue each time. */
async function readNotes(db, aliases, personId) {
  const snap = await db.collection(NOTES).get();
  const all = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
    .map((n) => Object.assign(n, { personNow: resolveId(aliases, n.personId) }));
  const mine = personId ? all.filter((n) => n.personNow === personId) : all;
  await Promise.all(mine.filter((n) => n.email && LIVE_PENDING.has(String(n.email.state || '')) && Array.isArray(n.email.emailIds) && n.email.emailIds.length).map(async (n) => {
    try {
      const rows = await Promise.all(n.email.emailIds.map((id) => db.collection('caregiverEmails').doc(id).get()));
      const statuses = rows.map((r) => (r.exists ? String((r.data() || {}).status || '') : ''));
      if (statuses.some((s) => !s)) return;
      const live = statuses.every((s) => s === 'sent') ? 'sent' : statuses.find((s) => s !== 'sent');
      if (live && live !== n.email.state) {
        n.email = Object.assign({}, n.email, { state: live });
        if (live === 'sent') await db.collection(NOTES).doc(n.id).update({ email: n.email });
      }
    } catch (_) { /* shown as it was */ }
  }));
  return mine.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
}

function forNotes(n) {
  return {
    id: n.id, type: n.type, party: n.party || '', text: n.text || '', at: n.at, by: n.by || null,
    email: n.email ? { to: n.email.to || '', from: n.email.from || '', subject: n.email.subject || '', state: n.email.state || '', reason: n.email.reason || '' } : null,
    attachments: n.attachments || 0, auto: n.auto || ''
  };
}

/* One conversation per person: its thread id, how many emails went, who
   wrote them (their replies are carried back to them). Taken in a
   transaction so two emails at once number themselves apart. */
async function nextInThread(db, personId, by, to, subject) {
  const ref = db.collection(THREADS).doc(personId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const t = snap.exists ? snap.data() || {} : {};
    const threadId = MT.isThreadId(t.threadId) ? t.threadId : MT.newThreadId();
    const n = (Number(t.sent) || 0) + 1;
    const staff = [...new Set([...(t.staff || []), by && by.email].filter(Boolean).map((e) => String(e).toLowerCase()))];
    const next = Object.assign({}, t, {
      personId, threadId, sent: n, staff, lastTo: to, lastSubject: subject || t.lastSubject || '',
      lastBy: by && by.email ? { email: by.email, name: by.name || '' } : (t.lastBy || null), updatedAt: new Date().toISOString()
    });
    tx.set(ref, next);
    return next;
  });
}

async function sendToPerson(db, { person, personId, to, subject, text, by, noteRef, siteUrl }) {
  const thread = await nextInThread(db, personId, by, to, subject);
  const template = 'old_member_message';
  const dedupeKey = `${template}:${noteRef.id}`;
  const signoff = by && (by.name || by.email) ? `${by.name || String(by.email).split('@')[0].replace(/[._-]+/g, ' ')}, People for Animals` : 'People for Animals';
  const sent = await NOTIFY.send({ template, to, dedupeKey, claimBy: 'panel',
    payload: { reference: referenceOf(personId), threadId: thread.threadId, n: thread.sent, name: person.name || '', text, subject: subject || thread.lastSubject || '', signoff, siteUrl } });
  const email = {
    to, subject: subject || thread.lastSubject || 'A message from People for Animals', n: thread.sent,
    state: sent.sent ? 'sent' : sent.queued ? 'queued' : 'unsent', reason: sent.reason || '',
    emailIds: [STORE.emailIdFor(template, dedupeKey)]
  };
  return email;
}

async function addNote(db, who, body, request) {
  const now = await standing(db);
  if (!now) return { status: 409, payload: { code: 'NOT_LOADED', message: 'Load the old list first.' } };
  const aliases = aliasesOf(now.changes);
  const personId = resolveId(aliases, String(body.personId || ''));
  const person = now.state.members.get(personId);
  if (!person) return { status: 404, payload: { code: 'NO_PERSON', message: 'That person is not on the list any more. Refresh the page.' } };
  const text = String(body.text || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  if (text.length < 2) return { status: 422, payload: { code: 'NO_TEXT', message: 'Write what happened first.' } };
  const wants = body.email && typeof body.email === 'object' && body.email.send !== false && body.email.to;
  let to = '';
  if (wants) {
    to = String(body.email.to || '').trim().toLowerCase();
    const theirs = (person.emails || []).map((e) => String(e.email || '').toLowerCase());
    if (!theirs.includes(to)) return { status: 422, payload: { code: 'NOT_THEIR_EMAIL', message: 'Choose one of their own email addresses.' } };
  }
  const subject = wants ? String(body.email.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, SUBJECT_MAX) : '';
  const atMs = Date.now();
  const by = who4(who);
  const noteRef = db.collection(NOTES).doc();
  const note = { personId, name: person.name || '', type: wants ? 'email-out' : 'note', text, by, at: new Date(atMs).toISOString(), atMs };
  await noteRef.set(note);
  let email = null;
  if (wants) {
    email = await sendToPerson(db, { person, personId, to, subject, text, by, noteRef, siteUrl: NOTIFY.publicSite() });
    await noteRef.update({ email });
  }
  await audit.record(who, {
    module: 'oldmembers', action: wants ? 'old-members-email' : 'old-members-note', subject: personId,
    detail: `${person.name || personId}: ${wants ? `emailed ${to} (${email.state})` : 'note added'}: ${text.slice(0, 160)}`
  }, request);
  return { status: 200, payload: { ok: true, note: forNotes(Object.assign({ id: noteRef.id }, note, { email })), emailed: Boolean(email && email.state === 'sent'), mailNote: email && email.state !== 'sent' ? (email.reason || 'The email is queued and will go shortly.') : '' } };
}

/* A reply to one of these emails, read from the site's mailbox
   (lib/inbound-mail.js file(), for ids that name PFA-OLD-...). From them:
   filed under them, and carried to whoever last wrote to them. From that
   member of staff (or PFA's inbox): filed, and sent on to them from info@.
   Answers what inbound-mail's file() answers: { filed, reason }. */
async function fileReply(db, msg, own, o) {
  const opts = o || {};
  const personKey = String(own.reference || '').replace(/^PFA-OLD-/i, '');
  const threadRef = db.collection(THREADS).doc('OSM-' + personKey);
  const tSnap = await threadRef.get();
  const thread = tSnap.exists ? tSnap.data() || {} : null;
  if (!thread || thread.threadId !== own.threadId) return { filed: false, reason: 'NO_THREAD', messageId: msg.messageId };
  const staff = new Set([...(thread.staff || []), ...(opts.inboxes || [])].map((e) => String(e || '').toLowerCase()));
  const from = String(msg.from || '').toLowerCase();
  const party = staff.has(from) ? 'staff' : 'person';
  const at = new Date(opts.now ? opts.now() : Date.now());
  const noteRef = db.collection(NOTES).doc('in-' + String(opts.docId || msg.messageId || at.getTime()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120));
  const text = String(msg.newText || msg.text || '').trim().slice(0, NOTE_MAX);
  const note = {
    personId: thread.personId, type: 'email-in', party, text, at: at.toISOString(), atMs: at.getTime(),
    by: party === 'staff' ? { email: from, name: msg.fromName || '' } : null,
    email: { from, subject: String(msg.subject || '').slice(0, 300), messageId: msg.messageId || '' },
    attachments: Array.isArray(msg.attachments) ? msg.attachments.length : 0
  };
  if (msg.autoReply) note.auto = msg.autoReply;
  try {
    await noteRef.create(note);
  } catch (error) {
    if (error && (error.code === 6 || /already exists/i.test(String(error.message)))) return { filed: false, reason: 'DUPLICATE', messageId: msg.messageId };
    throw error;
  }
  const relayed = [];
  if (!msg.autoReply && text) {
    if (party === 'person' && thread.lastBy && thread.lastBy.email) {
      const n = (Number(thread.relays) || 0) + 1;
      await threadRef.update({ relays: n });
      const out = await NOTIFY.send({ template: 'old_member_relay', to: thread.lastBy.email, dedupeKey: `old_member_relay:${noteRef.id}`, claimBy: 'mailbox',
        payload: { reference: own.reference, threadId: thread.threadId, n, answers: own.part || '', name: '', from, text, subject: thread.lastSubject || msg.subject || '', receivedAt: note.at, panelUrl: NOTIFY.panelUrl() } });
      await noteRef.update({ relay: { to: thread.lastBy.email, state: out.sent ? 'sent' : out.queued ? 'queued' : 'unsent' } });
      relayed.push(thread.lastBy.email);
    } else if (party === 'staff' && thread.lastTo) {
      const people = await standing(db);
      const person = people ? people.state.members.get(resolveId(aliasesOf(people.changes), thread.personId)) : null;
      const outRef = db.collection(NOTES).doc('out-' + noteRef.id);
      const by = { email: from, name: msg.fromName || '' };
      await outRef.set({ personId: thread.personId, name: person ? person.name || '' : '', type: 'email-out', via: 'mailbox', text, by, at: note.at, atMs: note.atMs + 1 });
      const email = await sendToPerson(db, { person: person || { name: '' }, personId: thread.personId, to: thread.lastTo, subject: thread.lastSubject, text, by, noteRef: outRef, siteUrl: NOTIFY.publicSite() });
      await outRef.update({ email });
      relayed.push(thread.lastTo);
    }
  }
  return { filed: true, oldMember: true, auto: Boolean(msg.autoReply), relayed };
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
    const query = request.query || (() => { try { return Object.fromEntries(new URL(request.url, 'http://x').searchParams); } catch (_) { return {}; } })();
    if (request.method === 'GET' && query.notes) {
      const now = await standing(db);
      if (!now) return sendJson(response, 200, { ok: true, notes: [] });
      const aliases = aliasesOf(now.changes);
      const personId = resolveId(aliases, String(query.notes));
      const notes = await readNotes(db, aliases, personId);
      return sendJson(response, 200, { ok: true, personId, notes: notes.map(forNotes), mailOn: require('../../caregiver-mail').isConfigured() });
    }
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
      /* how many notes each person has, for the list */
      const noteCounts = {};
      try {
        const aliases = aliasesOf(changes);
        (await readNotes(db, aliases, '')).forEach((n) => { noteCounts[n.personNow] = (noteCounts[n.personNow] || 0) + 1; });
      } catch (_) { /* the list shows without them */ }
      return sendJson(response, 200, {
        ok: true, canImport: isSuper, canEdit: isSuper, canNote: true, noteCounts, importId: current.importId, fileName: current.fileName,
        importedAt: current.importedAt, importedBy: current.importedBy, stats, review, members, history
      });
    }

    const body = await readBody(request);
    if (body.tooLarge) return sendJson(response, 413, { code: 'TOO_LARGE', message: 'That file is too large. The membership list should be well under 9 MB.' });
    if (!['import', 'propose', 'confirm', 'note'].includes(body.action)) return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    /* a note, or an email to them: anyone with this section */
    if (body.action === 'note') {
      const out = await addNote(db, who, body, request);
      return sendJson(response, out.status, out.payload);
    }
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

module.exports._private = { COLLECTION, CHANGES, PROPOSALS, NOTES, THREADS, readCurrent, parts, standing, fileReply, referenceOf, aliasesOf, resolveId };
