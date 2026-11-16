'use strict';

/* Live chat: a visitor and someone at PFA, through the site's assistant.

   Owner, 16 Nov 2026: "build a chat UI for admin side, where people can
   answer questions- when online.. i.e. if one asks for a person. and if the
   answer is not available in the site data", and "live chat works for main
   site user, only if someone from admin panel is online. else, ask the main
   site user to send a query". Then, the same day: "make chat work super
   fast ... enterprise grade. like whatsapp grade", "when the person goes
   offline. end user needs to know. also the admin user who is on chat should
   get the chat in diff color when the chat comes in when offline", "no new
   chat should be allowed [when] no agent would be live", "how will chat be
   handled when multiple users are there in admin who handle chat", "edge
   cases everything".

   No sockets and no paid service: both sides ask the server every second
   while a chat is lively (lib/routes/live-chat.js, the panel's
   assets/admin-live-chat.js), and each chat is one Firestore document, so a
   look is one read.

     live_chats/{id}       { status: waiting | open | closed, seq, messages,
                             takenBy, visitorSeenN, staffSeenN, awayCount,
                             visitorTypingMs, staffTypingMs, lastVisitorMs ... }
     live_chat_staff/{uid} { name, available, seenMs }

   How it behaves:

   - A new chat starts only while someone is available. Otherwise the site
     offers the help desk, which answers by email.
   - A chat waiting is offered to everyone available; the first to reply or
     press Take has it (in a transaction, so two people never both do). The
     rest see who has it and cannot type into it; anyone available may take
     it over, which the visitor is told.
   - Every message has its number (seq, in a transaction, so order is the
     server's) and the sender's own id (cid), so a retried send is the same
     message, never a second one.
   - Read receipts: the visitor's page says the highest message it has
     shown (visitorSeenN); the person answering, theirs (staffSeenN).
   - Typing: each side marks itself typing at most every few seconds; it
     shows for six seconds after.
   - Offline: the person answering is online while their panel says so (every
     25 seconds, 75 seconds' grace). The visitor's page is told at once when
     they go, and when they are back. What the visitor writes while nobody
     who could answer is online is marked away; the chat shows in the panel
     in another colour, first, until someone answers it.
   - A chat the visitor has not looked at for 15 minutes is closed as left;
     one they left unanswered says so.

   The visitor proves the chat is theirs with a token given once when it
   starts (kept in the tab's sessionStorage); only its hash is stored. */

const crypto = require('node:crypto');

const CHATS = 'live_chats';
const STAFF = 'live_chat_staff';
const ONLINE_MS = 75 * 1000;          /* the panel says so every 25 seconds */
const LEFT_MS = 15 * 60 * 1000;       /* a visitor gone this long has left */
const HERE_MS = 30 * 1000;            /* a visitor looked within this: here */
const SEEN_EVERY_MS = 15 * 1000;      /* how often a visitor's look is written */
const TYPING_MS = 6000;
const KEEP_CLOSED_MS = 30 * 24 * 3600 * 1000;
const MAX_TEXT = 1000;
const MAX_MESSAGES = 400;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max || MAX_TEXT);
}
function cleanCid(v) { return /^[A-Za-z0-9_-]{6,40}$/.test(String(v || '')) ? String(v) : ''; }

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

function fresh(s, nowMs) { return Boolean(s && s.available && Number(s.seenMs) >= nowMs - ONLINE_MS); }

async function availableStaff(db, nowMs) {
  const snap = await db.collection(STAFF).where('available', '==', true).get();
  return (snap.docs || []).map((d) => Object.assign({ uid: d.id }, d.data() || {})).filter((s) => fresh(s, nowMs));
}

/* One look per instance every few seconds, so every visitor's page asking
   "is anyone there" is not a read each. A change made through this instance
   is seen at once. */
let cache = { at: 0, list: [], db: null };
async function onlineList(db, nowMs, fresh0) {
  if (!fresh0 && cache.db === db && nowMs - cache.at < 5000) return cache.list;
  const list = await availableStaff(db, nowMs);
  cache = { at: nowMs, list, db };
  return list;
}
async function isOnline(db, nowMs, fresh0) { return (await onlineList(db, nowMs, fresh0)).length > 0; }
async function uidOnline(db, uid, nowMs) { return (await onlineList(db, nowMs)).some((s) => s.uid === uid); }
function forgetOnline() { cache = { at: 0, list: [], db: null }; }

async function presence(db, who, available, nowMs) {
  const doc = { uid: who.uid, name: shownName(who), email: String(who.email || ''), available: Boolean(available), seenMs: nowMs, seenAt: iso(nowMs) };
  await db.collection(STAFF).doc(String(who.uid)).set(doc, { merge: true });
  forgetOnline();
  return doc;
}

async function presenceOf(db, uid) {
  const snap = await db.collection(STAFF).doc(String(uid)).get();
  return snap.exists ? snap.data() : null;
}

/* ---- messages ------------------------------------------------------------- */

function message(chat, from, text, nowMs, more) {
  const n = Number(chat.seq || 0) + 1;
  chat.seq = n;
  const m = Object.assign({ n, from, text, at: iso(nowMs), ms: nowMs }, more || {});
  chat.messages = (chat.messages || []).concat([m]);
  chat.updatedMs = nowMs;
  chat.updatedAt = iso(nowMs);
  return m;
}
function system(chat, text, nowMs, kind) { return message(chat, 'system', text, nowMs, kind ? { kind } : null); }

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

/* ---- the visitor's side ----------------------------------------------------- */

async function start(db, input, nowMs) {
  const text = cleanText(input && input.text);
  if (!text) throw fail('EMPTY', 'Write your question first.');
  /* no one there, no chat: the site offers the help desk instead */
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
    visitorSeenN: 0,
    staffSeenN: 0,
    awayCount: 0,
    messages: []
  };
  const first = message(chat, 'visitor', text, nowMs, cleanCid(input.cid) ? { cid: cleanCid(input.cid) } : null);
  await db.collection(CHATS).doc(id).set(chat);
  return { id, token, chat, n: first.n };
}

async function mine(db, id, token) {
  if (!/^LC[0-9A-F]{16}$/.test(String(id || ''))) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  const ref = db.collection(CHATS).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || !sameHash(hash(token), snap.data().tokenHash)) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  return { ref, chat: snap.data() };
}

/* who the visitor is waiting on, and whether they are there */
async function answerer(db, chat, nowMs) {
  if (chat.status === 'closed') return { name: '', online: false, any: false };
  const list = await onlineList(db, nowMs);
  const any = list.length > 0;
  if (!chat.takenBy) return { name: '', online: any, any };
  return { name: chat.takenBy.name, online: list.some((s) => s.uid === chat.takenBy.uid), any };
}

function visitorView(chat, after, who, nowMs) {
  const since = Number(after) || 0;
  return {
    ok: true,
    status: chat.status,
    staff: chat.takenBy ? chat.takenBy.name : '',
    closedBy: chat.closedBy || '',
    /* the person answering (or, while waiting, anyone) is online */
    staffOnline: Boolean(who.online),
    online: Boolean(who.any),
    staffTyping: Boolean(chat.takenBy && nowMs - Number(chat.staffTypingMs || 0) < TYPING_MS),
    staffSeenN: Number(chat.staffSeenN || 0),
    seq: Number(chat.seq || 0),
    messages: (chat.messages || []).filter((m) => m.n > since && m.from !== 'visitor')
      .map((m) => ({ n: m.n, from: m.from, name: m.name || '', text: m.text, at: m.at, kind: m.kind || '' }))
  };
}

async function poll(db, id, token, after, seen, nowMs) {
  const { ref, chat } = await mine(db, id, token);
  if (chat.status !== 'closed') {
    const up = {};
    if (nowMs - Number(chat.lastVisitorMs || 0) > SEEN_EVERY_MS) up.lastVisitorMs = nowMs;
    const s = Math.min(Number(seen) || 0, Number(chat.seq || 0));
    if (s > Number(chat.visitorSeenN || 0)) up.visitorSeenN = s;
    if (Object.keys(up).length) { await ref.update(up); Object.assign(chat, up); }
  }
  return visitorView(chat, after, await answerer(db, chat, nowMs), nowMs);
}

async function visitorSend(db, id, token, text, cid, nowMs) {
  await mine(db, id, token);
  const said = cleanText(text);
  if (!said) throw fail('EMPTY', 'Write something first.');
  const c = cleanCid(cid);
  /* is anyone there who could answer? if not, the message is marked away */
  const list = await onlineList(db, nowMs, true);
  return change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    const again = c && (chat.messages || []).find((m) => m.cid === c && m.from === 'visitor');
    if (again) return again;
    if ((chat.messages || []).length >= MAX_MESSAGES) throw fail('FULL', 'This chat is full. Start a new one.', 409);
    const there = chat.takenBy ? list.some((s) => s.uid === chat.takenBy.uid) : list.length > 0;
    chat.lastVisitorMs = nowMs;
    chat.visitorTypingMs = 0;
    const extra = c ? { cid: c } : {};
    if (!there) { extra.away = true; extra.awayOf = chat.takenBy ? chat.takenBy.name : ''; chat.awayCount = Number(chat.awayCount || 0) + 1; if (!chat.awaySinceMs) chat.awaySinceMs = nowMs; }
    return message(chat, 'visitor', said, nowMs, extra);
  });
}

async function visitorTyping(db, id, token, nowMs) {
  const { ref, chat } = await mine(db, id, token);
  if (chat.status !== 'closed' && nowMs - Number(chat.visitorTypingMs || 0) > 2500) await ref.update({ visitorTypingMs: nowMs, lastVisitorMs: nowMs });
  return true;
}

async function visitorEnd(db, id, token, nowMs) {
  await mine(db, id, token);
  return change(db, id, (chat) => {
    if (chat.status === 'closed') return chat;
    system(chat, 'The visitor ended the chat.', nowMs, 'end');
    chat.status = 'closed'; chat.closedBy = 'visitor'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
    return chat;
  });
}

/* ---- PFA's side --------------------------------------------------------------- */

/* the visitor messages after the last one answered */
function unanswered(chat) {
  const msgs = chat.messages || [];
  let lastStaff = 0;
  msgs.forEach((m) => { if (m.from === 'staff') lastStaff = m.n; });
  return msgs.filter((m) => m.from === 'visitor' && m.n > lastStaff).length;
}

function summary(chat, me, online, nowMs) {
  const msgs = chat.messages || [];
  const last = msgs.filter((m) => m.from !== 'system').slice(-1)[0] || msgs.slice(-1)[0] || {};
  const owner = chat.takenBy || null;
  const ownerOnline = Boolean(owner && (online || []).some((s) => s.uid === owner.uid));
  const mineNow = Boolean(owner && me && owner.uid === me.uid);
  const waitingOn = unanswered(chat);
  const unread = msgs.filter((m) => m.from === 'visitor' && m.n > Number(chat.staffSeenN || 0)).length;
  return {
    id: chat.id,
    status: chat.status,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    closedAt: chat.closedAt || '',
    closedBy: chat.closedBy || '',
    page: chat.page || '',
    lang: chat.lang || 'en',
    takenBy: owner ? { uid: owner.uid, name: owner.name } : null,
    mine: mineNow,
    ownerOnline,
    count: msgs.filter((m) => m.from !== 'system').length,
    first: (msgs.find((m) => m.from === 'visitor') || {}).text || '',
    last: last.text || '',
    lastFrom: last.from || '',
    lastAt: last.at || chat.updatedAt || '',
    /* the visitor spoke last: it is waiting on PFA */
    awaiting: chat.status !== 'closed' && waitingOn > 0,
    unanswered: waitingOn,
    unread: chat.status === 'closed' ? 0 : (owner ? (mineNow ? unread : 0) : waitingOn),
    /* written while nobody who could answer was online, and not answered yet */
    away: Number(chat.awayCount || 0),
    visitorHere: chat.status !== 'closed' && nowMs - Number(chat.lastVisitorMs || 0) < HERE_MS
  };
}

function full(chat, me, online, nowMs) {
  return Object.assign(summary(chat, me, online, nowMs), {
    seq: Number(chat.seq || 0),
    visitorSeenN: Number(chat.visitorSeenN || 0),
    visitorTyping: chat.status !== 'closed' && nowMs - Number(chat.visitorTypingMs || 0) < TYPING_MS,
    lastVisitorAt: chat.lastVisitorMs ? iso(chat.lastVisitorMs) : '',
    messages: (chat.messages || []).map((m) => ({ n: m.n, from: m.from, name: m.name || '', uid: m.uid || '', text: m.text, at: m.at, away: Boolean(m.away), awayOf: m.awayOf || '', kind: m.kind || '' }))
  });
}

async function closeLeft(db, chats, nowMs) {
  const gone = chats.filter((c) => c.status !== 'closed' && nowMs - Number(c.lastVisitorMs || c.createdMs || 0) > LEFT_MS);
  for (const c of gone) {
    try {
      await change(db, c.id, (chat) => {
        if (chat.status === 'closed') return chat;
        system(chat, unanswered(chat) ? 'The visitor left before an answer.' : 'The visitor left the chat.', nowMs, 'left');
        chat.status = 'closed'; chat.closedBy = 'left'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
        Object.assign(c, chat);
        return chat;
      });
    } catch (_) { /* tried again on the next look */ }
  }
}

/* Order: what needs someone first (written while away; waiting; the person
   on it offline), then mine, then the rest; oldest wait first. */
function rank(s) {
  if (s.away) return 0;
  if (s.status === 'waiting') return 1;
  if (s.takenBy && !s.ownerOnline && s.awaiting) return 2;
  if (s.mine) return 3;
  return 4;
}

async function list(db, me, nowMs, opts) {
  const o = opts || {};
  const [waiting, open, online] = await Promise.all([
    db.collection(CHATS).where('status', '==', 'waiting').get(),
    db.collection(CHATS).where('status', '==', 'open').get(),
    onlineList(db, nowMs, true)
  ]);
  const live = [].concat(waiting.docs || [], open.docs || []).map((d) => d.data());
  await closeLeft(db, live, nowMs);
  const current = live.filter((c) => c.status !== 'closed').map((c) => summary(c, me, online, nowMs))
    .sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const out = { chats: current, closed: [], online };
  if (o.closed) {
    const snap = await db.collection(CHATS).where('closedMs', '>=', nowMs - KEEP_CLOSED_MS).orderBy('closedMs', 'desc').limit(40).get();
    out.closed = (snap.docs || []).map((d) => summary(d.data(), me, online, nowMs));
  }
  return out;
}

async function read(db, me, id, seen, nowMs) {
  const ref = db.collection(CHATS).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  const chat = snap.data();
  /* the person answering has read up to here (only theirs counts) */
  const s = Math.min(Number(seen) || 0, Number(chat.seq || 0));
  if (chat.status !== 'closed' && chat.takenBy && me && chat.takenBy.uid === me.uid && s > Number(chat.staffSeenN || 0)) {
    await ref.update({ staffSeenN: s });
    chat.staffSeenN = s;
  }
  return full(chat, me, await onlineList(db, nowMs), nowMs);
}

function takeIn(chat, who, nowMs, force) {
  const name = shownName(who);
  if (chat.takenBy && chat.takenBy.uid === who.uid) return;
  if (chat.takenBy && !force) throw fail('TAKEN', `${chat.takenBy.name} is answering this chat. Take it over to reply.`, 409);
  const was = chat.takenBy;
  chat.takenBy = { uid: who.uid, name, email: String(who.email || '') };
  chat.status = 'open';
  chat.staffSeenN = Number(chat.seq || 0);
  system(chat, was ? `${name} from PFA took over from ${was.name}.` : `${name} from PFA joined the chat.`, nowMs, 'joined');
}

async function take(db, who, id, force, nowMs) {
  const online = await onlineList(db, nowMs, true);
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    takeIn(chat, who, nowMs, force);
  }), who, online, nowMs);
}

async function staffSend(db, who, id, text, cid, force, nowMs) {
  const said = cleanText(text);
  if (!said) throw fail('EMPTY', 'Write a reply first.');
  const c = cleanCid(cid);
  const online = await onlineList(db, nowMs, true);
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') throw fail('CLOSED', 'This chat has ended.', 409);
    if (c && (chat.messages || []).some((m) => m.cid === c && m.from === 'staff')) return;
    if ((chat.messages || []).length >= MAX_MESSAGES) throw fail('FULL', 'This chat is full.', 409);
    /* answering a waiting chat takes it; one someone else has needs Take over */
    takeIn(chat, who, nowMs, force);
    const extra = { name: shownName(who), uid: who.uid };
    if (c) extra.cid = c;
    message(chat, 'staff', said, nowMs, extra);
    chat.staffTypingMs = 0;
    chat.staffSeenN = Number(chat.seq || 0);
    /* answered: no longer waiting on anyone */
    chat.awayCount = 0; chat.awaySinceMs = 0;
  }), who, online, nowMs);
}

async function staffTyping(db, who, id, nowMs) {
  const ref = db.collection(CHATS).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists) throw fail('NOT_FOUND', 'That chat is not here.', 404);
  const chat = snap.data();
  if (chat.status !== 'closed' && chat.takenBy && chat.takenBy.uid === who.uid && nowMs - Number(chat.staffTypingMs || 0) > 2500) await ref.update({ staffTypingMs: nowMs });
  return true;
}

async function close(db, who, id, nowMs) {
  const online = await onlineList(db, nowMs);
  return full(await change(db, id, (chat) => {
    if (chat.status === 'closed') return;
    system(chat, `${shownName(who)} from PFA ended the chat.`, nowMs, 'end');
    chat.status = 'closed'; chat.closedBy = 'staff'; chat.closedMs = nowMs; chat.closedAt = iso(nowMs);
    chat.awayCount = 0;
  }), who, online, nowMs);
}

/* the whole conversation as text, for the record */
function transcript(chat) {
  const t = (iso0) => new Date(Date.parse(iso0) + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ');
  return [`PFA live chat ${chat.id}${chat.page ? ', from ' + chat.page : ''}`, '']
    .concat((chat.messages || []).map((m) => `${t(m.at)}  ${m.from === 'visitor' ? 'Visitor' : m.from === 'staff' ? (m.name || 'PFA') + ', PFA' : '*'}: ${m.text}`))
    .join('\n');
}

module.exports = {
  CHATS, STAFF, ONLINE_MS, LEFT_MS, HERE_MS, TYPING_MS, MAX_TEXT, MAX_MESSAGES,
  cleanText, shownName, availableStaff, onlineList, isOnline, uidOnline, forgetOnline, presence, presenceOf,
  start, poll, visitorSend, visitorTyping, visitorEnd, list, read, take, staffSend, staffTyping, close, summary, transcript, unanswered
};
