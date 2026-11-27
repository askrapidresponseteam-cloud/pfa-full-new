'use strict';

/* Where the signature sits on the internship certificate (owner, 12 Nov
   2026, with the certificate's own position controls: "fix the bugs. and
   update this certificate with controls").

   One setting for the whole site, siteSettings/certificate in Firestore:
     { sigX, sigY, updatedAt, updatedBy }
   how far the signature is moved from where the design first puts it, in
   the design's pixels: anywhere on the page, across from -1120 to 1120 and
   up or down from -792 to 792 (27 Nov 2026; first 100 and 50). Until it is set, the design's own: 26 to the
   right, 0 down.

   Changed only in the panel (lib/routes/admin/certificates.js, action
   'layout', in the audit log); read by every page that draws a certificate
   (the panel, certificate.html, the internship page's sample) through
   /api/certificate-layout (lib/routes/certificate-layout.js), so every
   certificate drawn, downloaded or emailed has its signature in the one
   place. */

const COLLECTION = 'siteSettings';
const DOC = 'certificate';
/* anywhere on the page (owner, 27 Nov 2026: "there should be more/unlimited
   adjustment in terms of left/right, up down etc.. wherever this feature is"):
   the whole certificate either way, and a fifth to three times its size */
const RANGE = { x: 1120, y: 792 };
const DEFAULT = { x: 26, y: 0, s: 100 };
/* the signature's size, in per cent of where the design first draws it
   (owner, 15 Nov 2026: "there should be option to adjust the size of the
   sign as well not just position"), for the certificate and every card */
const SIZE = { min: 20, max: 300, home: 100 };
function sizeOf(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.max(SIZE.min, Math.min(SIZE.max, n)) : fallback;
}
/* a size asked for: null when none was given (the saved one stays), else
   { error } or the number */
function askedSize(b) {
  if (b.s === undefined || b.s === null || b.s === '') return null;
  const n = Number(b.s);
  if (!Number.isFinite(n) || n < SIZE.min || n > SIZE.max) return { error: `The signature's size is from ${SIZE.min}% to ${SIZE.max}%.` };
  return Math.round(n);
}

function clamp(v, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : fallback;
}

/* What is stored, as the pages are told it: { x, y }. */
function view(data) {
  const d = data && typeof data === 'object' ? data : {};
  return { x: clamp(d.sigX, RANGE.x, DEFAULT.x), y: clamp(d.sigY, RANGE.y, DEFAULT.y), s: sizeOf(d.sigS, SIZE.home) };
}

/* A request's { x, y }, checked. Returns { ok, x, y } or { ok: false, message }. */
function check(body) {
  const b = body && typeof body === 'object' ? body : {};
  /* nothing given is not 0 (review of 27 Nov 2026) */
  const x = b.x == null || b.x === '' ? NaN : Number(b.x);
  const y = b.y == null || b.y === '' ? NaN : Number(b.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, message: 'Give the signature’s position across and up or down.' };
  if (Math.abs(x) > RANGE.x || Math.abs(y) > RANGE.y) return { ok: false, message: `The signature moves up to ${RANGE.x} across and ${RANGE.y} up or down.` };
  const s = askedSize(b);
  if (s && s.error) return { ok: false, message: s.error };
  return { ok: true, x: Math.round(x), y: Math.round(y), s };
}

function ref(db) { return db.collection(COLLECTION).doc(DOC); }

async function read(db) {
  const snap = await ref(db).get();
  const d = snap.exists ? snap.data() || {} : {};
  return Object.assign(view(d), { updatedAt: String(d.updatedAt || ''), updatedBy: String(d.updatedBy || '') });
}

async function write(db, x, y, who, nowMs = Date.now(), s = null) {
  const before = await read(db);
  const at = new Date(nowMs).toISOString();
  const by = (who && (who.email || who.name)) || '';
  const size = s == null ? before.s : s;
  await ref(db).set({ sigX: x, sigY: y, sigS: size, updatedAt: at, updatedBy: by }, { merge: true });
  return { before, after: { x, y, s: size, updatedAt: at, updatedBy: by } };
}

/* The two cards' signatures (owner, 15 Nov 2026: "Add Maneka Gandhi's
   signature to caregiver and membership cards using the same logic as the
   internship certificate"). The same signature image, drawn above each
   card's signature line, moved from where the card first puts it by the
   panel's Signature position in its card studio, kept for the whole site
   in the same setting: { cgSigX, cgSigY } for the colony caregiver card,
   { mbSigX, mbSigY } for the membership card, in the card's tenths of a
   millimetre, anywhere on the card: up to 860 either way across and 540 up
   or down (27 Nov 2026; first 60 and 30).
   Until it is set, where the card first puts it. */
const CARDS = {
  caregiver: { x: 'cgSigX', y: 'cgSigY', s: 'cgSigS', module: 'caregivers', label: 'colony caregiver card' },
  member: { x: 'mbSigX', y: 'mbSigY', s: 'mbSigS', module: 'membership', label: 'membership card' },
  /* the same two cards online (owner, 15 Nov 2026: "give option to adjust
     the sign position"), each kept apart from its printed card, whose
     layout is not the same; in tenths of a millimetre of a bank card's
     width, so the signature keeps its place at every size */
  caregiverOnline: { x: 'cgDcSigX', y: 'cgDcSigY', s: 'cgDcSigS', module: 'caregivers', label: 'colony caregiver card online' },
  memberOnline: { x: 'mbDcSigX', y: 'mbDcSigY', s: 'mbDcSigS', module: 'membership', label: 'membership card online' }
};
/* on a card, the whole card either way, in tenths of a millimetre (85.6 by
   54 mm), 27 Nov 2026 */
const CARD_RANGE = { x: 860, y: 540 };
const CARD_DEFAULT = { x: 0, y: 0, s: 100 };
function cardView(data, card) {
  const d = data && typeof data === 'object' ? data : {};
  const f = CARDS[card];
  return { x: clamp(d[f.x], CARD_RANGE.x, CARD_DEFAULT.x), y: clamp(d[f.y], CARD_RANGE.y, CARD_DEFAULT.y), s: sizeOf(d[f.s], SIZE.home) };
}
function cardsView(data) { const out = {}; Object.keys(CARDS).forEach((c) => { out[c] = cardView(data, c); }); return out; }
function checkCard(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!Object.prototype.hasOwnProperty.call(CARDS, b.card)) return { ok: false, message: 'Say which card: the colony caregiver card or the membership card, printed or online.' };
  /* nothing given is not 0 (review of 27 Nov 2026) */
  const x = b.x == null || b.x === '' ? NaN : Number(b.x);
  const y = b.y == null || b.y === '' ? NaN : Number(b.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, message: 'Give the signature\u2019s position across and up or down.' };
  if (Math.abs(x) > CARD_RANGE.x || Math.abs(y) > CARD_RANGE.y) return { ok: false, message: `On a card the signature moves up to ${CARD_RANGE.x} across and ${CARD_RANGE.y} up or down.` };
  const s = askedSize(b);
  if (s && s.error) return { ok: false, message: s.error };
  return { ok: true, card: b.card, x: Math.round(x), y: Math.round(y), s };
}
async function readCards(db) {
  const snap = await ref(db).get();
  const d = snap.exists ? snap.data() || {} : {};
  const out = cardsView(d);
  Object.keys(CARDS).forEach((c) => { out[c].updatedAt = String(d[`${CARDS[c].x}At`] || ''); out[c].updatedBy = String(d[`${CARDS[c].x}By`] || ''); });
  return out;
}
async function writeCard(db, card, x, y, who, nowMs = Date.now(), s = null) {
  const before = (await readCards(db))[card];
  const at = new Date(nowMs).toISOString();
  const by = (who && (who.email || who.name)) || '';
  const f = CARDS[card];
  const size = s == null ? before.s : s;
  await ref(db).set({ [f.x]: x, [f.y]: y, [f.s]: size, [`${f.x}At`]: at, [`${f.x}By`]: by }, { merge: true });
  return { before, after: { x, y, s: size, updatedAt: at, updatedBy: by } };
}

module.exports = { COLLECTION, DOC, RANGE, DEFAULT, SIZE, view, check, read, write, CARDS, CARD_RANGE, CARD_DEFAULT, cardView, cardsView, checkCard, readCards, writeCard };
