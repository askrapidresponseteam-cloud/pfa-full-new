'use strict';

/* Where the signature sits on the internship certificate (owner, 12 Nov
   2026, with the certificate's own position controls: "fix the bugs. and
   update this certificate with controls").

   One setting for the whole site, siteSettings/certificate in Firestore:
     { sigX, sigY, updatedAt, updatedBy }
   how far the signature is moved from where the design first puts it, in
   the design's pixels: across from -100 to 100, up or down from -50 to 50,
   the design's own ranges. Until it is set, the design's own: 26 to the
   right, 0 down.

   Changed only in the panel (lib/routes/admin/certificates.js, action
   'layout', in the audit log); read by every page that draws a certificate
   (the panel, certificate.html, the internship page's sample) through
   /api/certificate-layout (lib/routes/certificate-layout.js), so every
   certificate drawn, downloaded or emailed has its signature in the one
   place. */

const COLLECTION = 'siteSettings';
const DOC = 'certificate';
const RANGE = { x: 100, y: 50 };
const DEFAULT = { x: 26, y: 0 };

function clamp(v, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : fallback;
}

/* What is stored, as the pages are told it: { x, y }. */
function view(data) {
  const d = data && typeof data === 'object' ? data : {};
  return { x: clamp(d.sigX, RANGE.x, DEFAULT.x), y: clamp(d.sigY, RANGE.y, DEFAULT.y) };
}

/* A request's { x, y }, checked. Returns { ok, x, y } or { ok: false, message }. */
function check(body) {
  const b = body && typeof body === 'object' ? body : {};
  const x = Number(b.x);
  const y = Number(b.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, message: 'Give the signature’s position across and up or down.' };
  if (Math.abs(x) > RANGE.x || Math.abs(y) > RANGE.y) return { ok: false, message: `The signature moves up to ${RANGE.x} across and ${RANGE.y} up or down.` };
  return { ok: true, x: Math.round(x), y: Math.round(y) };
}

function ref(db) { return db.collection(COLLECTION).doc(DOC); }

async function read(db) {
  const snap = await ref(db).get();
  const d = snap.exists ? snap.data() || {} : {};
  return Object.assign(view(d), { updatedAt: String(d.updatedAt || ''), updatedBy: String(d.updatedBy || '') });
}

async function write(db, x, y, who, nowMs = Date.now()) {
  const before = await read(db);
  const at = new Date(nowMs).toISOString();
  const by = (who && (who.email || who.name)) || '';
  await ref(db).set({ sigX: x, sigY: y, updatedAt: at, updatedBy: by }, { merge: true });
  return { before, after: { x, y, updatedAt: at, updatedBy: by } };
}

module.exports = { COLLECTION, DOC, RANGE, DEFAULT, view, check, read, write };
