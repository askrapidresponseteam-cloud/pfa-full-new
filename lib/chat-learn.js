'use strict';
/* Teaching the site's chat (owner, 23 Nov 2026: "can you have chat module
   keep learning and get better").

   The chat already notes what it could not answer (lib/analytics.js: the
   words only, with numbers, emails, phone numbers and reference numbers
   taken out), and, from 23 Nov 2026, a question it answered after which the
   visitor still went to the help desk. Here those questions are gathered,
   most asked first, for someone at PFA to teach an answer to (in the panel,
   Live chat, Teach the chat) or set aside. A taught answer is what the chat
   says from then on to that question and to the other wordings given with
   it, before the site's own text (assets/assistant.js).

   It learns from PFA, not by itself: nothing a visitor types becomes an
   answer until a person at PFA writes one. */

const crypto = require('crypto');

const COLLECTION = 'chatLearn';
const DAYS_COLLECTION = 'analytics_days';
const LOOK_BACK_DAYS = 30;
const MAX_ANSWER = 700;
const MAX_ALSO = 12;
const MAX_TAUGHT = 400;
const IST_MS = 330 * 60 * 1000;

/* the analytics id of a question: the same hash lib/analytics.js uses */
function idOf(q) { return crypto.createHash('sha256').update(String(q || '')).digest('hex').slice(0, 12); }
function dayOf(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
function daysBack(nowMs, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayOf(nowMs - i * 864e5));
  return out;
}

/* a question, cleaned as the chat's misses are: lower case, no numbers or
   addresses, at most 150 letters */
function cleanQ(q) {
  return String(q || '').replace(/[^\s@]+@[^\s@]+/g, ' ').replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 150);
}
/* a page of the site to read more on, or none: never another site */
const PAGE = /^[a-z0-9-]+\.html(#[A-Za-z0-9_-]{1,60})?$/;

function checkTeach(body) {
  const answer = String(body.answer || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (answer.length < 8) return { ok: false, message: 'Write the answer the chat should give: a sentence or two.' };
  if (answer.length > MAX_ANSWER) return { ok: false, message: `Keep the answer under ${MAX_ANSWER} letters; the page it links to can say the rest.` };
  if (/[\u2013\u2014]/.test(answer)) return { ok: false, message: 'Use a plain hyphen, not a long dash.' };
  const link = String(body.link || '').trim().replace(/^\/+/, '').replace(/^https?:\/\/(www\.)?peopleforanimalsindia\.org\//i, '');
  if (link && !PAGE.test(link)) return { ok: false, message: 'The link must be a page of the site, like donate.html.' };
  const also = (Array.isArray(body.also) ? body.also : String(body.also || '').split('\n'))
    .map(cleanQ).filter((x) => x.length >= 2).filter((x, i, all) => all.indexOf(x) === i).slice(0, MAX_ALSO);
  return { ok: true, answer, link, also };
}

/* what is waiting to be taught, most asked first, and what has been */
async function overview(db, nowMs) {
  const days = daysBack(nowMs, LOOK_BACK_DAYS);
  const col = db.collection(DAYS_COLLECTION);
  const snaps = await Promise.all(days.map((d) => col.doc(`${d}_chat`).get().catch(() => null)));
  const asked = {};
  snaps.forEach((snap, i) => {
    if (!snap || !snap.exists) return;
    Object.entries(snap.data() || {}).forEach(([id, e]) => {
      if (!e || typeof e !== 'object' || !e.q) return;
      const x = asked[id] || (asked[id] = { id, q: String(e.q), n: 0, wrong: 0, last: '' });
      x.n += Number(e.n) || 0;
      x.wrong += Number(e.w) || 0;
      x.last = days[i];
    });
  });
  const kept = await db.collection(COLLECTION).get();
  const taught = [];
  const set = {};
  (kept.docs || []).forEach((d) => {
    const v = d.data() || {};
    /* taught or set aside: off the list; forgotten: back on it */
    if (v.status === 'taught' || v.status === 'ignored') set[d.id] = v.status;
    if (v.status === 'taught') taught.push({ id: d.id, q: v.q, answer: v.answer, link: v.link || '', also: v.also || [], by: v.by || '', at: v.at || '', asked: asked[d.id] ? asked[d.id].n : 0 });
  });
  const open = Object.values(asked).filter((x) => !set[x.id]).sort((a, b) => b.n - a.n || (b.last > a.last ? 1 : -1)).slice(0, 150);
  const ignored = Object.keys(set).filter((k) => set[k] === 'ignored').length;
  taught.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { open, taught, ignored, days: LOOK_BACK_DAYS };
}

async function teach(db, who, body, nowMs) {
  const c = checkTeach(body || {});
  if (!c.ok) return c;
  const q = cleanQ(body.q);
  if (q.length < 2) return { ok: false, message: 'Write the question as a visitor would ask it.' };
  const id = String(body.id || '') && /^[a-f0-9]{12}$/.test(String(body.id)) ? String(body.id) : idOf(q);
  const all = await db.collection(COLLECTION).where('status', '==', 'taught').get();
  if ((all.docs || []).length >= MAX_TAUGHT && !(all.docs || []).some((d) => d.id === id)) return { ok: false, message: `The chat already has ${MAX_TAUGHT} taught answers. Remove some first.` };
  await db.collection(COLLECTION).doc(id).set({ q, status: 'taught', answer: c.answer, link: c.link, also: c.also.filter((x) => x !== q), by: who, at: new Date(nowMs).toISOString() });
  return { ok: true, id, q };
}

async function ignore(db, who, id, nowMs, q) {
  if (!/^[a-f0-9]{12}$/.test(String(id || ''))) return { ok: false, message: 'That question is not on the list.' };
  await db.collection(COLLECTION).doc(id).set({ q: cleanQ(q), status: 'ignored', by: who, at: new Date(nowMs).toISOString() });
  return { ok: true, id };
}

/* a taught answer forgotten, or an ignored question back on the list: the
   record kept, marked so (no stored record is ever deleted) */
async function forget(db, who, id, nowMs) {
  if (!/^[a-f0-9]{12}$/.test(String(id || ''))) return { ok: false, message: 'That answer is not on the list.' };
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, message: 'That answer is not on the list.' };
  await ref.set({ status: 'forgotten', by: who, at: new Date(nowMs).toISOString() }, { merge: true });
  return { ok: true, id };
}

/* what the chat is taught, for every visitor: the question, its other
   wordings, the answer and the page */
async function publicList(db) {
  const snap = await db.collection(COLLECTION).where('status', '==', 'taught').get();
  return (snap.docs || []).map((d) => { const v = d.data() || {}; return { q: v.q, also: v.also || [], answer: v.answer, link: v.link || '' }; }).slice(0, MAX_TAUGHT);
}

module.exports = { COLLECTION, idOf, cleanQ, checkTeach, overview, teach, ignore, forget, publicList, MAX_ANSWER };
