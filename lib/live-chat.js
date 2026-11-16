'use strict';

/* Live chat: a visitor and someone at PFA, through the site's assistant.

   Owner, 16 Nov 2026: "build a chat UI for admin side, where people can
   answer questions- when online.. i.e. if one asks for a person. and if the
   answer is not available in the site data", and "live chat works for main
   site user, only if someone from admin panel is online. else, ask the main
   site user to send a query".

   So a chat is offered only while someone in the panel has said they are
   available (and their panel is still open: it says so every 25 seconds,
   lib/routes/admin/live-chat.js). Otherwise the assistant offers the help
   desk form, which is answered by email.

   Nothing here costs anything to run: no sockets, no paid service. The
   visitor's page and the panel each ask the server every few seconds for
   what is new, and every chat is one Firestore document holding its
   messages, so a look is one read.

     live_chats/{id}       { status: waiting | open | closed, messages: [...],
                             seq, tokenHash, page, lang, takenBy, ... }
     live_chat_staff/{uid} { name, available, seenMs }

   The visitor proves the chat is theirs with a token given once when it
   starts (kept in the tab's sessionStorage); only its hash is stored. A chat
   the visitor has not looked at for 15 minutes is closed as left. */

const crypto = require('node:crypto');

const CHATS = 'live_chats';
const STAFF = 'live_chat_staff';
const ONLINE_MS = 75 * 1000;          /* the panel says so every 25 seconds */
const LEFT_MS = 15 * 60 * 1000;       /* a visitor gone this long has left */
const SEEN_EVERY_MS = 60 * 1000;      /* how often a visitor's look is written */
const KEEP_CLOSED_MS = 30 * 24 * 3600 * 1000;
const MAX_TEXT = 1000;
const MAX_MESSAGES = 300;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max || MAX_TEXT);
}

function hash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function newId() { return 'LC' + crypto.randomBytes(8).toString('hex').toUpperCase(); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function iso(ms) { return new Date(ms).toISOString(); }

/* The name a visitor sees: the first word of the person's own name, never
   their email. */
function shownName(who) {
  const first = cleanText((who && who.name) || '', 60).split(/\s+/)[0] || '';
  return first || 'PFA';
}

function fail(code, message, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status || 400;
  return e;
}

/* ---- who is available ---------------------------------------------------- */

async function availableStaff(db, nowMs) {
  const snap = await db.collection(STAFF).where('available', '==', true).get();
  return (snap.docs || []).map((d) => Object.assign({ uid: d.id }, d.data() || {}))
    .filter((s) => Number(s.seenMs) >= nowMs - ONLINE_MS);
}

/* One look per instance every 15 seconds, so every visitor's page asking
   "is anyone there" is not a read each. */
let cache = { at: 0, online: false };
async function isOnline(db, nowMs, fresh) {
  if (!fresh && nowMs - cache.at < 15000 && cache.db === db) return cache.online;
  const online = (await availableStaff(db, nowMs)).length > 0;
  cache = { at: nowMs, online, db };
  return online;
}
function forgetOnline() { cache = { at: 0, online: false }; }

async function presence(db, who, available, nowMs) {
  const doc = { uid: who.uid, name: shownName(who), email: String(who.email || ''), available: Boolean(available), seenMs: nowMs, seenAt: iso(nowMs) };
  await db.collection(STAFF).doc(String(who.uid)).set(doc, { merge: true });
  if (available) cache = { at: nowMs, online: true, db };
  else forgetOnline();
  return doc;
}

async function presenceOf(db, uid) {
  const snap = await db.collection(STAFF).doc(String(uid)).get();
  return snap.exists ? snap.data() : null;
}

/* ---- the visitor's side ----------------------------------------------------- */

function message(chat, from, text, nowMs, name) {
  const n = Number(chat.seq || 0) + 1;
  chat.seq = n;
  const m = { n, from, text, at: iso(nowMs), ms: nowMs };
  if (name) m.name = name;
  chat.messages = (chat.messages || []).concat([m]);
  chat.updatedMs = nowMs;
  chat.updatedAt = iso(nowMs);
  return m;
}

async function start(db, input, nowMs) {
  const text = cleanText(input && input.text);
  if (!text) throw fail('EMPTY', 'Write your question first.');
  if (!(await isOnline(db, nowMs, true))) throw fail('NO_ONE', 'No one from PFA is on the chat just now.', 409);
  const id = newId();
  const token = newToken();
  const chat = {
    id,
    status: 'waiting',
    tokenHash: hash(token),
    page: cleanText(input.page, 120),
    lang: input.lang === 'hi' ? 'hi' : 'en',
    createdMs: nowMs,
    createdAt: iso(nowMs),
    lastVisitorMs: nowMs,
    takenBy: null,
    seq: 0,
    messages: []
  };
  message(chat, 'visitor', text, nowMs);
  await db.collection(CHATS).doc(id).set(chat);
  return { id, token, chat };
}

function visitorView(chat, after, online) {
  const since = Number(after) || 0;
  return {
    ok: true,
    status: chat.status,
    staff: chat.takenBy ? chat.takenBy.name : '',
    closedBy: chat.closedBy || '',
    online: Boolean(online),
    seq: Number(chat.seq || 0),
    messages: (chat.messages || []).filter((m) => m.n > since && m.from !== 'visitor')
      .map((m) => ({ n: m.n, from: m.from, name: m.name || '', text: m.text, at: m.at }))
  };
}

async function mine(db, id, token) {
  if (!/^LC[0-9A-F]{16}$/.test(String(id || ''))) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  const ref = db.collection(CHATS).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || !sameHash(hash(token), snap.data().tokenHash)) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  return { ref, chat: snap.data() };
}

async function poll(db, id, token, after, nowMs) {
  const { ref, chat } = await mine(db, id, token);
  if (chat.status !== 'closed' && nowMs - Number(chat.lastVisitorMs || 0) > SEEN_EVERY_MS) {
    await ref.update({ lastVisitorMs: nowMs });
  }
  const online = chat.status === 'closed' ? false : await isOnline(db, nowMs);
  return visitorView(chat, after, online);
}

async function change(db, id, fn) {
  const ref = db.collection(CHATS).doc(String(id));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NOT_FOUND', 'That chat is not here.', 404);
    const chat = snap.data();
    const result = fn(chat);
    tx.set(ref, chat);
    return result === undefined ? chat : result;
  });
}

async function visitorSend(db, id, token, text, nowMs) {
  await mine(db, id, token);
  const said = cleanText(text);
  if (!said) throw fail('EMPTY', 'Write something first.');
  return change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    if ((chat.messages || []).length >= MAX_MESSAGES) throw fail('FULL', 'This chat is full. Start a new one.', 409);
    chat.lastVisitorMs = nowMs;
    return message(chat, 'visitor', said, nowMs);
  });
}

async function visitorEnd(db, id, token, nowMs) {
  await mine(db, id, token);
  return change(db, id, (chat) => {
    if (chat.status === 'closed') return chat;
    message(chat, 'system', 'The visitor ended the chat.', nowMs);
    chat.status = 'closed'; chat.closedBy = 'visitor'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
    return chat;
  });
}

/* ---- PFA's side --------------------------------------------------------------- */

function summary(chat) {
  const msgs = chat.messages || [];
  const last = msgs.filter((m) => m.from !== 'system').slice(-1)[0] || msgs.slice(-1)[0] || {};
  return {
    id: chat.id,
    status: chat.status,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    closedAt: chat.closedAt || '',
    closedBy: chat.closedBy || '',
    page: chat.page || '',
    lang: chat.lang || 'en',
    takenBy: chat.takenBy || null,
    count: msgs.filter((m) => m.from !== 'system').length,
    first: (msgs.find((m) => m.from === 'visitor') || {}).text || '',
    last: last.text || '',
    lastFrom: last.from || '',
    /* the visitor spoke last: it is waiting on PFA */
    awaiting: chat.status !== 'closed' && last.from === 'visitor'
  };
}

function full(chat) {
  return Object.assign(summary(chat), {
    seq: Number(chat.seq || 0),
    messages: (chat.messages || []).map((m) => ({ n: m.n, from: m.from, name: m.name || '', text: m.text, at: m.at }))
  });
}

async function closeLeft(db, chats, nowMs) {
  const gone = chats.filter((c) => c.status !== 'closed' && nowMs - Number(c.lastVisitorMs || c.createdMs || 0) > LEFT_MS);
  for (const c of gone) {
    try {
      await change(db, c.id, (chat) => {
        if (chat.status === 'closed') return chat;
        message(chat, 'system', 'The visitor left the chat.', nowMs);
        chat.status = 'closed'; chat.closedBy = 'left'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
        Object.assign(c, chat);
        return chat;
      });
    } catch (_) { /* tried again on the next look */ }
  }
}

async function list(db, nowMs, opts) {
  const o = opts || {};
  const [waiting, open] = await Promise.all(['waiting', 'open'].map((s) => db.collection(CHATS).where('status', '==', s).get()));
  const live = [].concat(waiting.docs || [], open.docs || []).map((d) => d.data());
  await closeLeft(db, live, nowMs);
  const current = live.filter((c) => c.status !== 'closed')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'waiting' ? -1 : 1) || Number(a.createdMs) - Number(b.createdMs));
  const out = { chats: current.map(summary), closed: [] };
  if (o.closed) {
    const snap = await db.collection(CHATS).where('closedMs', '>=', nowMs - KEEP_CLOSED_MS).orderBy('closedMs', 'desc').limit(40).get();
    out.closed = (snap.docs || []).map((d) => summary(d.data()));
  }
  return out;
}

async function read(db, id) {
  const snap = await db.collection(CHATS).doc(String(id || '')).get();
  if (!snap.exists) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  return full(snap.data());
}

function takeIn(chat, who, nowMs) {
  if (chat.takenBy && chat.takenBy.uid === who.uid) return;
  const name = shownName(who);
  chat.takenBy = { uid: who.uid, name, email: String(who.email || '') };
  chat.status = 'open';
  message(chat, 'system', `${name} from PFA joined the chat.`, nowMs);
}

async function take(db, who, id, nowMs) {
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    takeIn(chat, who, nowMs);
  }));
}

async function staffSend(db, who, id, text, nowMs) {
  const said = cleanText(text);
  if (!said) throw fail('EMPTY', 'Write a reply first.');
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    if ((chat.messages || []).length >= MAX_MESSAGES) throw fail('FULL', 'This chat is full.', 409);
    /* answering a chat no one has taken takes it */
    if (!chat.takenBy) takeIn(chat, who, nowMs);
    message(chat, 'staff', said, nowMs, shownName(who));
  }));
}

async function close(db, who, id, nowMs) {
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') return;
    message(chat, 'system', `${shownName(who)} from PFA ended the chat.`, nowMs);
    chat.status = 'closed'; chat.closedBy = 'staff'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
  }));
}

module.exports = {
  CHATS, STAFF, ONLINE_MS, LEFT_MS, MAX_TEXT, MAX_MESSAGES,
  cleanText, shownName, availableStaff, isOnline, forgetOnline, presence, presenceOf,
  start, poll, visitorSend, visitorEnd, list, read, take, staffSend, close, summary
};
