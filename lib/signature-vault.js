'use strict';
/* The signature collection, kept behind a password (owner, 22 Nov 2026:
   "add this to signature collection. it should be workable on letter,
   certificates and cards. and color should be changable", then "ensure
   that signature should not be accesable even if one gets the code. it
   should be protected by password", then "there has to be 2 sign vectors.
   1 that has maneka sanjay gandhi text below the sign and the one
   without").

   Nothing of a signature is in the code. A signature is added in the
   panel (Certificates, Signatures), with the password: the server reads
   its vector shapes from the SVG, encrypts them with a key made from the
   password (scrypt, then AES-256-GCM) and keeps only the encrypted copy,
   in signatureVault, which no browser can read (firestore.rules). The
   password is not kept anywhere: the code holds only a one-way check of
   it (scrypt, salted), and a new password, once set in the panel, replaces
   that check in the database.

   To use a signature, an admin gives the password again: the server opens
   the vector for that admin's panel alone, which draws it in the colour
   chosen and sends back the finished picture for one of three places
   (letters, certificates, cards). Only that picture is kept unlocked, for
   the documents to be drawn with; it is what a document shows anyway.

   Five wrong passwords from one admin lock that admin out for 15 minutes,
   twenty from anyone in an hour lock everyone out for an hour; every try,
   right or wrong, is in the audit log (lib/routes/admin/signatures.js). */

const crypto = require('crypto');

const COLLECTION = 'signatureVault';
/* the one-way check of the first password; replaced in the database when
   the password is changed in the panel */
const FIRST_CHECK = { salt: 'VBCXBvjHtJMokcOOXZe6NQ==', hash: 'W4VuF8m8AlGOAziB/6GzYKmJra8CStPU7USgUigBz9g=', N: 65536, r: 8, p: 1 };
const KDF = { N: 65536, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;

/* The three places a signature is drawn, each with the shape of picture it
   takes (the built-in signature's own, so the placing controls stay right)
   and the width it is drawn at, for print. */
const PLACES = {
  letter: { label: 'Letters', aspect: 1374 / 374, width: 2748 },
  certificate: { label: 'Certificates', aspect: 1512 / 438, width: 3024 },
  card: { label: 'Cards', aspect: 1512 / 438, width: 3024 }
};
/* a record holds at most 1 MB: the picture, as text, stays well under it */
const MAX_PICTURE = 700 * 1024;
const MAX_VECTOR = 600 * 1024;
const MAX_SVG = 2 * 1024 * 1024;
const LOCK = { tries: 5, minutes: 15, allTries: 20, allMinutes: 60 };

function keyFrom(password, salt, k) {
  const p = Object.assign({}, KDF, k || {});
  return crypto.scryptSync(String(password || ''), Buffer.from(salt, 'base64'), 32, { N: p.N, r: p.r, p: p.p, maxmem: MAXMEM });
}

function newCheck(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, hash: keyFrom(password, salt).toString('base64'), N: KDF.N, r: KDF.r, p: KDF.p };
}

function matches(password, check) {
  if (!check || !check.salt || !check.hash) return false;
  const got = keyFrom(password, check.salt, { N: check.N, r: check.r, p: check.p });
  const want = Buffer.from(check.hash, 'base64');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

function seal(value, password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(password, salt), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return { v: 1, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(box, password) {
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(password, box.salt, { N: box.N, r: box.r, p: box.p }), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const text = Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
  return JSON.parse(text);
}

/* ---- the SVG: its shapes and nothing else --------------------------------
   Only <path d> and its fill rule are read, with the viewBox; colours,
   scripts, links, pictures and anything else in the file are left behind,
   so nothing but shapes is ever kept or drawn. A full white background
   rectangle is not a path and so is not kept. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] != null ? m[2] : m[3]) : null;
}
function shapesOf(svgText) {
  const text = String(svgText || '');
  if (!text.trim()) return { ok: false, message: 'Choose the signature’s SVG file.' };
  if (Buffer.byteLength(text, 'utf8') > MAX_SVG) return { ok: false, message: 'That SVG is larger than 2 MB.' };
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) return { ok: false, message: 'That is not an SVG file.' };
  let box = (attr(root[0], 'viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) {
    const w = parseFloat(attr(root[0], 'width')); const h = parseFloat(attr(root[0], 'height'));
    if (!(w > 0 && h > 0)) return { ok: false, message: 'The SVG has no size (viewBox) to draw it by.' };
    box = [0, 0, w, h];
  }
  const paths = [];
  const re = /<path\b[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const d = (attr(m[0], 'd') || '').trim();
    if (!d) continue;
    if (!PATH_DATA.test(d)) return { ok: false, message: 'The SVG has a shape that could not be read safely.' };
    const rule = /evenodd/i.test(attr(m[0], 'fill-rule') || '') ? 'evenodd' : 'nonzero';
    paths.push({ d, rule });
    if (paths.length > 60) return { ok: false, message: 'That SVG has too many shapes to be a signature.' };
  }
  if (/<(path|g)\b[^>]*\btransform\s*=/i.test(text)) return { ok: false, message: 'Save the SVG with its transforms applied (no transform attributes), then add it.' };
  if (!paths.length) return { ok: false, message: 'The SVG has no shapes (paths) in it.' };
  if (paths.reduce((n, p) => n + p.d.length, 0) > MAX_VECTOR) return { ok: false, message: 'That signature has too much detail to keep; simplify it and add it again.' };
  return { ok: true, vector: { viewBox: box, paths } };
}

/* ---- a finished picture: a PNG of the place's shape ---------------------- */
function pictureOf(dataUrl, place) {
  const P = PLACES[place];
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!P || !m) return { ok: false, message: 'The signature picture did not arrive.' };
  const png = Buffer.from(m[1], 'base64');
  if (png.length > MAX_PICTURE) return { ok: false, message: 'The signature picture is too large.' };
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47 || png.toString('latin1', 12, 16) !== 'IHDR') return { ok: false, message: 'The signature picture is not a PNG.' };
  const w = png.readUInt32BE(16); const h = png.readUInt32BE(20);
  if (Math.abs(w / h - P.aspect) > 0.02 * P.aspect || w < 600 || w > 4000) return { ok: false, message: `The signature picture is not the shape ${P.label.toLowerCase()} take.` };
  return { ok: true, png, w, h };
}

/* ---- the store ------------------------------------------------------------ */
function idOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'signature';
}
const COLOUR = /^#[0-9a-f]{6}$/i;

async function checkOf(db) {
  const snap = await db.collection(COLLECTION).doc('settings').get();
  const d = snap.exists ? snap.data() || {} : {};
  return d.check && d.check.hash ? d.check : FIRST_CHECK;
}

/* who may try now: { ok } or { ok: false, message, until } */
async function guard(db, who, nowMs) {
  const snap = await db.collection(COLLECTION).doc('guard').get();
  const g = snap.exists ? snap.data() || {} : {};
  const mine = (g.by || {})[who] || {};
  if (Number(g.allUntil) > nowMs) return { ok: false, message: 'Too many wrong passwords. The signatures are locked for everyone for up to an hour.', until: Number(g.allUntil) };
  if (Number(mine.until) > nowMs) return { ok: false, message: 'Too many wrong passwords. Try again in 15 minutes.', until: Number(mine.until) };
  return { ok: true };
}
async function noteTry(db, who, right, nowMs) {
  const ref = db.collection(COLLECTION).doc('guard');
  const snap = await ref.get();
  const g = snap.exists ? snap.data() || {} : {};
  const by = Object.assign({}, g.by || {});
  const mine = Object.assign({ count: 0 }, by[who] || {});
  const hour = 60 * 60 * 1000;
  let recent = (Array.isArray(g.recent) ? g.recent : []).filter((t) => nowMs - Number(t) < hour);
  if (right) { mine.count = 0; mine.until = 0; } else {
    mine.count = (Number(mine.count) || 0) + 1;
    if (mine.count >= LOCK.tries) { mine.until = nowMs + LOCK.minutes * 60 * 1000; mine.count = 0; }
    recent = recent.concat(nowMs);
  }
  by[who] = mine;
  const allUntil = recent.length >= LOCK.allTries ? nowMs + LOCK.allMinutes * 60 * 1000 : Number(g.allUntil) || 0;
  await ref.set({ by, recent: recent.slice(-50), allUntil }, { merge: false });
}

/* the password, or the reason it cannot be tried: { ok } | { ok: false, code, message } */
async function admit(db, who, password, nowMs = Date.now()) {
  const g = await guard(db, who, nowMs);
  if (!g.ok) return { ok: false, code: 'LOCKED', message: g.message };
  const right = matches(password, await checkOf(db));
  await noteTry(db, who, right, nowMs);
  return right ? { ok: true } : { ok: false, code: 'WRONG_PASSWORD', message: 'That password is not right.' };
}

async function list(db) {
  const snap = await db.collection(COLLECTION).get();
  const sigs = [];
  const using = {};
  for (const doc of snap.docs || []) {
    const d = doc.data() || {};
    if (doc.id.startsWith('sig-')) sigs.push({ id: doc.id.slice(4), name: String(d.name || ''), addedAt: String(d.addedAt || ''), addedBy: String(d.addedBy || '') });
    if (doc.id.startsWith('use-') && d.id) using[doc.id.slice(4)] = { id: String(d.id || ''), name: String(d.name || ''), colour: String(d.colour || ''), updatedAt: String(d.updatedAt || ''), updatedBy: String(d.updatedBy || '') };
  }
  sigs.sort((a, b) => a.name.localeCompare(b.name));
  return { signatures: sigs, using, places: Object.keys(PLACES).map((k) => ({ id: k, label: PLACES[k].label, aspect: PLACES[k].aspect, width: PLACES[k].width })) };
}

async function add(db, who, password, name, svgText, nowMs = Date.now()) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) return { ok: false, message: 'Name the signature.' };
  const s = shapesOf(svgText);
  if (!s.ok) return s;
  const id = idOf(n);
  const ref = db.collection(COLLECTION).doc(`sig-${id}`);
  if ((await ref.get()).exists) return { ok: false, message: 'There is already a signature by that name.' };
  await ref.set({ name: n, box: seal(s.vector, password), addedAt: new Date(nowMs).toISOString(), addedBy: who });
  return { ok: true, id, name: n, shapes: s.vector.paths.length };
}

async function unlock(db, password, id) {
  const snap = await db.collection(COLLECTION).doc(`sig-${idOf(id)}`).get();
  if (!snap.exists) return { ok: false, message: 'That signature is not in the collection.' };
  const d = snap.data() || {};
  try { return { ok: true, id: idOf(id), name: d.name, vector: open(d.box, password) }; } catch (_) { return { ok: false, message: 'That signature could not be opened with this password.' }; }
}

async function use(db, who, place, id, colour, dataUrl, nowMs = Date.now()) {
  if (!PLACES[place]) return { ok: false, message: 'Say where: letters, certificates or cards.' };
  if (!COLOUR.test(String(colour || ''))) return { ok: false, message: 'Choose the ink colour.' };
  const sig = await db.collection(COLLECTION).doc(`sig-${idOf(id)}`).get();
  if (!sig.exists) return { ok: false, message: 'That signature is not in the collection.' };
  const pic = pictureOf(dataUrl, place);
  if (!pic.ok) return pic;
  const at = new Date(nowMs).toISOString();
  await db.collection(COLLECTION).doc(`use-${place}`).set({ id: idOf(id), name: (sig.data() || {}).name || '', colour: colour.toLowerCase(), png: pic.png.toString('base64'), w: pic.w, h: pic.h, updatedAt: at, updatedBy: who });
  return { ok: true, place, id: idOf(id), colour: colour.toLowerCase(), updatedAt: at };
}

/* back to the built-in signature: the place marked so, nothing deleted */
async function reset(db, who, place, nowMs = Date.now()) {
  if (!PLACES[place]) return { ok: false, message: 'Say where: letters, certificates or cards.' };
  await db.collection(COLLECTION).doc(`use-${place}`).set({ id: '', name: '', colour: '', png: '', builtIn: true, updatedAt: new Date(nowMs).toISOString(), updatedBy: who });
  return { ok: true, place };
}

/* a new password: every signature opened with the old one and sealed again
   with the new, then the new check written; the old one opens nothing */
async function changePassword(db, password, next) {
  const n = String(next || '');
  if (n.length < 8) return { ok: false, message: 'Make the new password at least 8 characters.' };
  const snap = await db.collection(COLLECTION).get();
  const resealed = [];
  for (const doc of snap.docs || []) {
    if (!doc.id.startsWith('sig-')) continue;
    const d = doc.data() || {};
    let v;
    try { v = open(d.box, password); } catch (_) { return { ok: false, message: `${d.name || doc.id} could not be opened with the current password; nothing was changed.` }; }
    resealed.push([doc.id, seal(v, n)]);
  }
  for (const [id, box] of resealed) await db.collection(COLLECTION).doc(id).set({ box }, { merge: true });
  await db.collection(COLLECTION).doc('settings').set({ check: newCheck(n) }, { merge: true });
  return { ok: true, resealed: resealed.length };
}

/* the picture a place is drawn with, or null for the built-in signature */
async function pictureFor(db, place) {
  if (!PLACES[place]) return null;
  const snap = await db.collection(COLLECTION).doc(`use-${place}`).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return d.png ? { png: Buffer.from(d.png, 'base64'), w: d.w, h: d.h, colour: d.colour, updatedAt: d.updatedAt } : null;
}

module.exports = { COLLECTION, PLACES, LOCK, FIRST_CHECK, shapesOf, pictureOf, seal, open, matches, newCheck, admit, list, add, unlock, use, reset, changePassword, pictureFor, idOf };
